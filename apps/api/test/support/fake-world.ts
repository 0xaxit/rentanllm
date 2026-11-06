/**
 * A stand-in for World IdP's device flow: real RS256-signed ID tokens from a local key,
 * and scripted token-endpoint answers per approval attempt.
 */
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import type { JWTPayload } from "jose";

import { makeWorldIdp } from "../../src/world/idp";

export const ISSUER = "https://sandbox.auth.world.test";
export const CLIENT_ID = "app_test_client";
export const CLIENT_SECRET = "worldidp_client_secret_test";
export const SUBJECT = "subject-alice";
const KID = "test-key";

/** What the token endpoint answers to one poll. */
export type Answer =
  | { readonly error: string }
  | { readonly status: number }
  /** An ID token for SUBJECT, signed by World's key, with these claims changed. */
  | { readonly claims: JWTPayload }
  /** An ID token signed with some other key. */
  | { readonly forged: true };

const SECOND_MS = 1000;
const nowSeconds = () => Math.floor(Date.now() / SECOND_MS);

const json = (status: number, body: unknown) => Response.json(body, { status });

export const makeFakeWorld = async () => {
  const world = await generateKeyPair("RS256");
  const stranger = await generateKeyPair("RS256");
  const publicJwk = {
    ...(await exportJWK(world.publicKey)),
    alg: "RS256",
    kid: KID,
  };
  const jwks = createLocalJWKSet({ keys: [publicJwk] });

  /** Device code -> the answers its polls get, in order (the last one repeats). */
  const scripts = new Map<string, Answer[]>();
  let nextScript: Answer[] = [{ error: "authorization_pending" }];
  const deviceForms: URLSearchParams[] = [];
  const device = { expiresIn: 1200, interval: 0 };
  let counter = 0;

  const idToken = async (claims: JWTPayload, forged: boolean) => {
    const now = nowSeconds();
    return await new SignJWT({
      acr: "https://world.org/oidc/acr/orb",
      amr: ["pop"],
      auth_time: now,
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256", kid: KID })
      .setIssuer(typeof claims.iss === "string" ? claims.iss : ISSUER)
      .setAudience(claims.aud ?? CLIENT_ID)
      .setSubject(typeof claims.sub === "string" ? claims.sub : SUBJECT)
      .setIssuedAt(now)
      .setExpirationTime(
        typeof claims.exp === "number" ? claims.exp : now + 300
      )
      .sign(forged ? stranger.privateKey : world.privateKey);
  };

  const answer = async (step: Answer): Promise<Response> => {
    if ("error" in step) {
      return json(400, { error: step.error });
    }
    if ("status" in step) {
      return json(step.status, {});
    }
    const token =
      "forged" in step
        ? await idToken({}, true)
        : await idToken(step.claims, false);
    return json(200, {
      access_token: "opaque",
      expires_in: 300,
      id_token: token,
      token_type: "Bearer",
    });
  };

  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const form = new URLSearchParams(String(init?.body ?? ""));
    if (
      form.get("client_id") !== CLIENT_ID ||
      form.get("client_secret") !== CLIENT_SECRET
    ) {
      return json(400, { error: "invalid_client" });
    }
    if (url === `${ISSUER}/api/v1/device_authorization`) {
      deviceForms.push(form);
      counter += 1;
      const deviceCode = `device-${counter}`;
      scripts.set(deviceCode, nextScript);
      nextScript = [{ error: "authorization_pending" }];
      return json(200, {
        device_code: deviceCode,
        expires_in: device.expiresIn,
        interval: device.interval,
        user_code: `CODE-${counter}`,
        verification_uri: `${ISSUER}/device`,
        verification_uri_complete: `${ISSUER}/device?user_code=CODE-${counter}`,
      });
    }
    if (url === `${ISSUER}/api/v1/token`) {
      const script = scripts.get(form.get("device_code") ?? "");
      if (script === undefined) {
        return json(400, { error: "invalid_grant" });
      }
      const step = script.length > 1 ? script.shift() : script[0];
      return await answer(step ?? { error: "authorization_pending" });
    }
    return json(404, {});
  };

  const idp = makeWorldIdp({
    acceptedAcr: [],
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    fetch: fakeFetch,
    issuer: ISSUER,
    jwks,
  });

  return {
    /** Device-authorization settings for the next attempts. */
    device,
    deviceForms,
    fetch: fakeFetch,
    idToken,
    idp,
    jwks,
    /** The token-endpoint answers for the next approval attempt. */
    script: (answers: Answer[]) => {
      nextScript = answers;
    },
  };
};

export type FakeWorld = Awaited<ReturnType<typeof makeFakeWorld>>;
