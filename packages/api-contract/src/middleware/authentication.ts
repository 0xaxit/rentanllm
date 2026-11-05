import { HttpApiMiddleware, HttpApiSecurity } from "effect/http-api";

import type { CurrentUser } from "../current-user";
import { Unauthorized } from "../errors/unauthorized";

export const SESSION_COOKIE = "rentanllm_session";

/** Session cookie set by POST /auth/verify (httpOnly, secure, sameSite=lax). */
export const sessionCookie = HttpApiSecurity.apiKey({
  in: "cookie",
  key: SESSION_COOKIE,
});

/**
 * Resolves the session cookie to the signed-in user. Browsers send the cookie
 * themselves, so clients do not need to implement this middleware.
 */
export class Authentication extends HttpApiMiddleware.Service<
  Authentication,
  { provides: CurrentUser; requires: never }
>()("@rentanllm/api-contract/Authentication", {
  error: Unauthorized,
  security: { session: sessionCookie },
}) {}
