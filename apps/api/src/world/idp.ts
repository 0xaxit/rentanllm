/**
 * World ID Agent Pass, which is World IdP: an OpenID Connect provider at
 * https://auth.world.org (sandbox: https://sandbox.auth.world.org, fake identities).
 *
 * The backend uses the OAuth device authorization grant (RFC 8628):
 *
 *   POST /api/v1/device_authorization   -> device_code (kept here), user_code + link (shown)
 *   POST /api/v1/token (device_code)    -> authorization_pending | slow_down | access_denied
 *                                          | expired_token | an ID token
 *
 * The ID token is never trusted as returned: it is verified against World's JWKS (RS256),
 * and its issuer, audience, expiry, auth_time (fresh for this attempt), proof-of-human
 * method and, when the payer is linked to a person, subject are all checked.
 *
 * The client secret only ever leaves this process to World's token endpoints.
 */
import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from "jose";
import type { JWTPayload, JWTVerifyGetKey } from "jose";

export interface WorldIdpOptions {
  /** Accepted `acr` values; empty accepts any class World issues. */
  readonly acceptedAcr: readonly string[];
  readonly clientId: string;
  readonly clientSecret: string;
  /** For tests: a fetch to World. */
  readonly fetch?: typeof fetch;
  /** `https://auth.world.org` or `https://sandbox.auth.world.org`, no trailing slash. */
  readonly issuer: string;
  /** For tests: the signing keys, instead of `<issuer>/.well-known/jwks.json`. */
  readonly jwks?: JWTVerifyGetKey;
}

export interface DeviceAuthorization {
  readonly deviceCode: string;
  readonly expiresInSeconds: number;
  readonly intervalSeconds: number;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly verificationUriComplete: string | null;
}

/** A validated World approval. */
export interface ApprovedIdentity {
  readonly acr: string | null;
  readonly amr: readonly string[];
  readonly authTime: Date;
  readonly subject: string;
}

export type PollResult =
  | { readonly kind: "pending" }
  | { readonly kind: "slow_down" }
  | { readonly kind: "denied" }
  | { readonly kind: "expired" }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly identity: ApprovedIdentity; readonly kind: "approved" };

/** World could not be reached, or answered with something unusable. Nothing was decided. */
export class WorldUnavailableError extends Error {
  override readonly name = "WorldUnavailableError";
}

const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const DEFAULT_INTERVAL_SECONDS = 5;
/** Tolerated clock difference between World and this server. */
const CLOCK_SKEW_SECONDS = 60;
const MS_PER_SECOND = 1000;
const HTTP_SERVER_ERROR = 500;
/** A World ID proof of human; a passkey alone adds "mfa" (see World's ID token docs). */
const PROOF_OF_HUMAN_AMR = "pop";

const stringField = (body: Record<string, unknown>, key: string) => {
  const value = body[key];
  return typeof value === "string" && value.length > 0 ? value : null;
};

const numberField = (body: Record<string, unknown>, key: string) => {
  const value = body[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const readJson = async (
  response: Response
): Promise<Record<string, unknown>> => {
  try {
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

/** Claims that require World to authenticate exactly this subject (OIDC `claims`). */
const subjectClaims = (subject: string) =>
  JSON.stringify({ id_token: { sub: { essential: true, value: subject } } });

const describeJoseError = (error: unknown): string => {
  if (error instanceof joseErrors.JWTExpired) {
    return "the ID token has expired";
  }
  if (error instanceof joseErrors.JWTClaimValidationFailed) {
    return `the ID token's ${error.claim} claim is wrong`;
  }
  if (error instanceof joseErrors.JWSSignatureVerificationFailed) {
    return "the ID token's signature does not verify";
  }
  if (error instanceof joseErrors.JWKSNoMatchingKey) {
    return "the ID token is not signed with one of World's keys";
  }
  if (error instanceof Error) {
    return `the ID token is invalid (${error.message})`;
  }
  return "the ID token is invalid";
};

export interface ValidationContext {
  /** The person must have authenticated for this attempt: not before it started. */
  readonly attemptStartedAt: Date;
  readonly expectedSubject: string | null;
  readonly now: Date;
}

export const makeWorldIdp = (options: WorldIdpOptions) => {
  const doFetch = options.fetch ?? fetch;
  const jwks =
    options.jwks ??
    createRemoteJWKSet(new URL(`${options.issuer}/.well-known/jwks.json`));

  const post = async (
    path: string,
    form: Record<string, string>
  ): Promise<{ body: Record<string, unknown>; status: number }> => {
    let response: Response;
    try {
      response = await doFetch(`${options.issuer}${path}`, {
        body: new URLSearchParams({
          client_id: options.clientId,
          client_secret: options.clientSecret,
          ...form,
        }),
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        method: "POST",
      });
    } catch (error) {
      throw new WorldUnavailableError(
        `World ID is not reachable: ${String(error)}`
      );
    }
    return { body: await readJson(response), status: response.status };
  };

  /** Starts one approval attempt. */
  const startDeviceAuthorization = async (input: {
    readonly expectedSubject: string | null;
  }): Promise<DeviceAuthorization> => {
    const form: Record<string, string> = { scope: "openid" };
    if (input.expectedSubject !== null) {
      form.claims = subjectClaims(input.expectedSubject);
    }
    const { body, status } = await post("/api/v1/device_authorization", form);
    const deviceCode = stringField(body, "device_code");
    const userCode = stringField(body, "user_code");
    const verificationUri = stringField(body, "verification_uri");
    const expiresIn = numberField(body, "expires_in");
    if (
      status !== 200 ||
      deviceCode === null ||
      userCode === null ||
      verificationUri === null ||
      expiresIn === null
    ) {
      const error = stringField(body, "error") ?? `HTTP ${status}`;
      const detail = stringField(body, "error_description");
      throw new WorldUnavailableError(
        `World ID refused to start an approval: ${error}${detail === null ? "" : ` (${detail})`}`
      );
    }
    return {
      deviceCode,
      expiresInSeconds: expiresIn,
      intervalSeconds:
        numberField(body, "interval") ?? DEFAULT_INTERVAL_SECONDS,
      userCode,
      verificationUri,
      verificationUriComplete: stringField(body, "verification_uri_complete"),
    };
  };

  /** Checks World's signed ID token; returns the identity or why it is not acceptable. */
  const validateIdToken = async (
    idToken: string,
    context: ValidationContext
  ): Promise<ApprovedIdentity | string> => {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(idToken, jwks, {
        algorithms: ["RS256"],
        audience: options.clientId,
        clockTolerance: CLOCK_SKEW_SECONDS,
        currentDate: context.now,
        issuer: options.issuer,
        requiredClaims: ["sub", "exp", "iat", "auth_time"],
      }));
    } catch (error) {
      return describeJoseError(error);
    }
    const { sub } = payload;
    const authTime = payload.auth_time;
    if (typeof sub !== "string" || sub.length === 0) {
      return "the ID token has no subject";
    }
    if (typeof authTime !== "number") {
      return "the ID token has no auth_time";
    }
    const authTimeMs = authTime * MS_PER_SECOND;
    const skewMs = CLOCK_SKEW_SECONDS * MS_PER_SECOND;
    if (authTimeMs < context.attemptStartedAt.getTime() - skewMs) {
      return "the person authenticated before this approval was requested";
    }
    if (authTimeMs > context.now.getTime() + skewMs) {
      return "the ID token's auth_time is in the future";
    }
    const amr = Array.isArray(payload.amr)
      ? payload.amr.filter(
          (value): value is string => typeof value === "string"
        )
      : [];
    if (!amr.includes(PROOF_OF_HUMAN_AMR)) {
      return 'World ID did not prove a unique human (no "pop" in amr)';
    }
    const acr = typeof payload.acr === "string" ? payload.acr : null;
    if (
      options.acceptedAcr.length > 0 &&
      (acr === null || !options.acceptedAcr.includes(acr))
    ) {
      return `World ID assurance ${acr ?? "(none)"} is not one this server accepts`;
    }
    if (context.expectedSubject !== null && sub !== context.expectedSubject) {
      return "a different person approved than the one linked to this payer";
    }
    return { acr, amr, authTime: new Date(authTimeMs), subject: sub };
  };

  /** One poll of the token endpoint; an ID token is validated before it counts. */
  const poll = async (
    deviceCode: string,
    context: ValidationContext
  ): Promise<PollResult> => {
    const { body, status } = await post("/api/v1/token", {
      device_code: deviceCode,
      grant_type: DEVICE_GRANT,
    });
    if (status >= HTTP_SERVER_ERROR) {
      // World's docs: a 5xx is never an approval; end the attempt.
      return { kind: "failed", reason: `World ID answered HTTP ${status}` };
    }
    if (status === 200) {
      const idToken = stringField(body, "id_token");
      if (idToken === null) {
        return { kind: "failed", reason: "World ID returned no ID token" };
      }
      const identity = await validateIdToken(idToken, context);
      return typeof identity === "string"
        ? { kind: "failed", reason: identity }
        : { identity, kind: "approved" };
    }
    const error = stringField(body, "error");
    switch (error) {
      case "authorization_pending": {
        return { kind: "pending" };
      }
      case "slow_down": {
        return { kind: "slow_down" };
      }
      case "access_denied": {
        return { kind: "denied" };
      }
      case "expired_token": {
        return { kind: "expired" };
      }
      default: {
        const detail = stringField(body, "error_description");
        return {
          kind: "failed",
          reason: `World ID: ${error ?? `HTTP ${status}`}${detail === null ? "" : ` (${detail})`}`,
        };
      }
    }
  };

  return { poll, startDeviceAuthorization, validateIdToken };
};

export type WorldIdp = ReturnType<typeof makeWorldIdp>;
