/**
 * OAuth 2.1 for the remote MCP connector (the MCP authorization spec): dynamic client
 * registration, the authorization code flow with PKCE (S256), and refresh tokens.
 *
 * The login is the web app's own wallet sign-in: /oauth/authorize sends the browser to
 * the consent page, where the signed-in user approves; nothing here sees a password or
 * the user's wallet key. Codes and tokens are random and stored only as SHA-256 hashes.
 */
import { createHash, randomBytes } from "node:crypto";

import { NotFound } from "@rentanllm/api-contract";
import { Db } from "@rentanllm/db";
import { oauthClients, oauthGrants, oauthTokens } from "@rentanllm/db/schema";
import { and, eq, gt, isNull } from "drizzle-orm";
import { Effect } from "effect";

import { dieOnDbError } from "../db-errors";

const GRANT_TTL_MS = 10 * 60_000;
const ACCESS_TTL_MS = 24 * 3_600_000;
const REFRESH_TTL_MS = 60 * 24 * 3_600_000;
const SECRET_BYTES = 32;
const MAX_REDIRECTS = 10;
const MAX_NAME = 100;

export const randomToken = (bytes = SECRET_BYTES) =>
  randomBytes(bytes).toString("base64url");
export const sha256Hex = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const s256 = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");

/** An OAuth error answer: RFC 6749 `error` and a description. */
export class OAuthFailure {
  readonly _tag = "OAuthFailure";
  readonly description: string;
  readonly error: string;
  readonly status: number;

  constructor(error: string, description: string, status = 400) {
    this.description = description;
    this.error = error;
    this.status = status;
  }
}

const fail = (error: string, description: string, status = 400) =>
  Effect.fail(new OAuthFailure(error, description, status));

/** Only https redirects, or http on loopback (desktop clients). */
const allowedRedirect = (uri: string) => {
  try {
    const url = new URL(uri);
    if (url.hash !== "") {
      return false;
    }
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return url.protocol === "https:" || (url.protocol === "http:" && loopback);
  } catch {
    return false;
  }
};

/** RFC 7591 dynamic client registration. Public clients only (no secret). */
export const registerClient = Effect.fn("oauth.register")(
  function* registerClientGen(body: unknown) {
    const input = (body ?? {}) as {
      readonly client_name?: unknown;
      readonly redirect_uris?: unknown;
    };
    const uris = Array.isArray(input.redirect_uris)
      ? input.redirect_uris.filter((u): u is string => typeof u === "string")
      : [];
    if (
      uris.length === 0 ||
      uris.length > MAX_REDIRECTS ||
      !uris.every(allowedRedirect)
    ) {
      return yield* fail(
        "invalid_redirect_uri",
        "redirect_uris must be 1-10 https (or loopback http) URLs"
      );
    }
    const name =
      typeof input.client_name === "string" && input.client_name.trim() !== ""
        ? input.client_name.trim().slice(0, MAX_NAME)
        : "MCP client";
    const db = yield* Db;
    const id = `mcp_${randomToken(18)}`;
    yield* db.insert(oauthClients).values({ id, name, redirectUris: uris });
    return {
      client_id: id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name,
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: uris,
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  },
  dieOnDbError
);

/**
 * Validates an authorization request and stores it as a pending grant. Errors about the
 * client or redirect are shown to the user (never redirected to an unchecked URI).
 */
export const startAuthorization = Effect.fn("oauth.authorize")(
  function* startAuthorizationGen(params: URLSearchParams, now: Date) {
    const db = yield* Db;
    const clientId = params.get("client_id") ?? "";
    const redirectUri = params.get("redirect_uri") ?? "";
    const [client] = yield* db
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.id, clientId));
    if (client === undefined) {
      return yield* fail("invalid_client", "Unknown client_id");
    }
    if (!client.redirectUris.includes(redirectUri)) {
      return yield* fail(
        "invalid_request",
        "redirect_uri is not registered for this client"
      );
    }
    const state = params.get("state");
    const back = (error: string, description: string) => {
      const url = new URL(redirectUri);
      url.searchParams.set("error", error);
      url.searchParams.set("error_description", description);
      if (state !== null) {
        url.searchParams.set("state", state);
      }
      return { redirect: url.toString() } as const;
    };
    if (params.get("response_type") !== "code") {
      return back("unsupported_response_type", "Only response_type=code");
    }
    const challenge = params.get("code_challenge") ?? "";
    if (
      params.get("code_challenge_method") !== "S256" ||
      challenge.length < 43
    ) {
      return back("invalid_request", "PKCE with S256 is required");
    }
    const id = randomToken(24);
    yield* db.insert(oauthGrants).values({
      clientId,
      codeChallenge: challenge,
      expiresAt: new Date(now.getTime() + GRANT_TTL_MS),
      id,
      redirectUri,
      resource: params.get("resource"),
      scope: params.get("scope"),
      state,
    });
    return { grantId: id } as const;
  },
  dieOnDbError
);

const pendingGrant = Effect.fn("oauth.pendingGrant")(function* pendingGrantGen(
  grantId: string,
  now: Date
) {
  const db = yield* Db;
  const [row] = yield* db
    .select({ client: oauthClients, grant: oauthGrants })
    .from(oauthGrants)
    .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
    .where(
      and(
        eq(oauthGrants.id, grantId),
        isNull(oauthGrants.approvedAt),
        gt(oauthGrants.expiresAt, now)
      )
    );
  if (row === undefined) {
    return yield* new NotFound({
      message: "This connection request expired or was already answered",
    });
  }
  return row;
});

/** What the consent page shows. */
export const grantInfo = Effect.fn("oauth.grantInfo")(function* grantInfoGen(
  grantId: string,
  now: Date
) {
  const { client, grant } = yield* pendingGrant(grantId, now);
  return {
    clientName: client.name,
    expiresAt: grant.expiresAt,
    redirectHost: new URL(grant.redirectUri).host,
  };
}, dieOnDbError);

const withParams = (base: string, params: Record<string, string | null>) => {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
};

/** The signed-in user approves: the grant gets a one-time code for the client. */
export const approveGrant = Effect.fn("oauth.approve")(
  function* approveGrantGen(userId: string, grantId: string, now: Date) {
    const { grant } = yield* pendingGrant(grantId, now);
    const code = randomToken();
    const db = yield* Db;
    yield* db
      .update(oauthGrants)
      .set({
        approvedAt: now,
        codeHash: sha256Hex(code),
        // The code is good for the rest of the grant's 10 minutes.
        userId,
      })
      .where(and(eq(oauthGrants.id, grantId), isNull(oauthGrants.approvedAt)));
    return {
      redirectUrl: withParams(grant.redirectUri, { code, state: grant.state }),
    };
  },
  dieOnDbError
);

export const denyGrant = Effect.fn("oauth.deny")(function* denyGrantGen(
  grantId: string,
  now: Date
) {
  const { grant } = yield* pendingGrant(grantId, now);
  const db = yield* Db;
  yield* db
    .update(oauthGrants)
    .set({ approvedAt: now, usedAt: now })
    .where(eq(oauthGrants.id, grantId));
  return {
    redirectUrl: withParams(grant.redirectUri, {
      error: "access_denied",
      error_description: "The user declined the connection",
      state: grant.state,
    }),
  };
}, dieOnDbError);

const issueTokens = Effect.fn("oauth.issueTokens")(function* issueTokensGen(
  clientId: string,
  userId: string,
  now: Date
) {
  const db = yield* Db;
  const access = randomToken();
  const refresh = randomToken();
  yield* db.insert(oauthTokens).values({
    accessExpiresAt: new Date(now.getTime() + ACCESS_TTL_MS),
    accessHash: sha256Hex(access),
    clientId,
    refreshExpiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
    refreshHash: sha256Hex(refresh),
    userId,
  });
  return {
    access_token: access,
    expires_in: ACCESS_TTL_MS / 1000,
    refresh_token: refresh,
    scope: "market",
    token_type: "Bearer",
  };
});

/** The token endpoint: authorization_code (with PKCE) and refresh_token grants. */
export const exchangeToken = Effect.fn("oauth.token")(
  function* exchangeTokenGen(form: URLSearchParams, now: Date) {
    const db = yield* Db;
    const clientId = form.get("client_id") ?? "";
    const grantType = form.get("grant_type");
    if (grantType === "authorization_code") {
      const code = form.get("code") ?? "";
      const verifier = form.get("code_verifier") ?? "";
      const [grant] = yield* db
        .select()
        .from(oauthGrants)
        .where(eq(oauthGrants.codeHash, sha256Hex(code)));
      if (
        grant === undefined ||
        grant.usedAt !== null ||
        grant.userId === null ||
        grant.expiresAt <= now
      ) {
        return yield* fail("invalid_grant", "Unknown, used or expired code");
      }
      if (grant.clientId !== clientId) {
        return yield* fail(
          "invalid_grant",
          "The code was issued to another client"
        );
      }
      if (
        (form.get("redirect_uri") ?? grant.redirectUri) !== grant.redirectUri
      ) {
        return yield* fail("invalid_grant", "redirect_uri does not match");
      }
      if (s256(verifier) !== grant.codeChallenge) {
        return yield* fail("invalid_grant", "PKCE verification failed");
      }
      const used = yield* db
        .update(oauthGrants)
        .set({ usedAt: now })
        .where(and(eq(oauthGrants.id, grant.id), isNull(oauthGrants.usedAt)))
        .returning({ id: oauthGrants.id });
      if (used.length === 0) {
        return yield* fail("invalid_grant", "The code was already used");
      }
      return yield* issueTokens(grant.clientId, grant.userId, now);
    }
    if (grantType === "refresh_token") {
      const refresh = form.get("refresh_token") ?? "";
      const revoked = yield* db
        .update(oauthTokens)
        .set({ revokedAt: now })
        .where(
          and(
            eq(oauthTokens.refreshHash, sha256Hex(refresh)),
            isNull(oauthTokens.revokedAt),
            gt(oauthTokens.refreshExpiresAt, now)
          )
        )
        .returning({
          clientId: oauthTokens.clientId,
          userId: oauthTokens.userId,
        });
      const [row] = revoked;
      if (row === undefined || row.clientId !== clientId) {
        return yield* fail(
          "invalid_grant",
          "Unknown, used or expired refresh token"
        );
      }
      return yield* issueTokens(row.clientId, row.userId, now);
    }
    return yield* fail(
      "unsupported_grant_type",
      "Use authorization_code or refresh_token"
    );
  },
  dieOnDbError
);

/** The user behind a bearer access token; null when it is unknown, expired or revoked. */
export const userForAccessToken = Effect.fn("oauth.userForToken")(
  function* userForAccessTokenGen(token: string, now: Date) {
    const db = yield* Db;
    const [row] = yield* db
      .select({ userId: oauthTokens.userId })
      .from(oauthTokens)
      .where(
        and(
          eq(oauthTokens.accessHash, sha256Hex(token)),
          isNull(oauthTokens.revokedAt),
          gt(oauthTokens.accessExpiresAt, now)
        )
      );
    return row?.userId ?? null;
  },
  dieOnDbError
);
