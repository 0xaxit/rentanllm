import {
  CurrentUser,
  RentAnLlmApi,
  SESSION_COOKIE,
  sessionCookie,
} from "@rentanllm/api-contract";
import type { Db } from "@rentanllm/db";
import { Duration, Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { HttpServerRequest } from "effect/http/HttpServerRequest";

import { AuthStore } from "../../auth/auth-store";
import { sessionTokenHash } from "../../auth/session-token";
import { issueNonce, verifySignIn } from "../../auth/sign-in";
import type { SignatureVerifier } from "../../auth/signature-verifier";
import { ApiConfig } from "../../config";
import type { ApiConfigShape } from "../../config";
import { captureServices } from "../app-services";

const cookieOptions = (config: ApiConfigShape, maxAgeMs: number) => ({
  ...(config.cookieDomain === undefined ? {} : { domain: config.cookieDomain }),
  httpOnly: true,
  maxAge: Duration.millis(maxAgeMs),
  path: "/",
  sameSite: "lax" as const,
  secure: true,
});

export const AuthHandlers = HttpApiBuilder.group(
  RentAnLlmApi,
  "auth",
  Effect.fn(function* authHandlers(handlers) {
    const config = yield* ApiConfig;
    const store = yield* AuthStore;
    const provide = yield* captureServices<
      ApiConfig | AuthStore | Db | SignatureVerifier
    >();
    return handlers
      .handle("nonce", ({ payload }) => provide(issueNonce(payload.address)))
      .handle("verify", ({ payload }) =>
        Effect.gen(function* verifyHandler() {
          const result = yield* provide(verifySignIn(payload));
          yield* HttpApiBuilder.securitySetCookie(
            sessionCookie,
            result.token,
            cookieOptions(config, config.sessionTtlMs)
          );
          return { expiresAt: result.expiresAt, user: result.user };
        })
      )
      .handle("logout", () =>
        Effect.gen(function* logoutHandler() {
          const request = yield* HttpServerRequest;
          const token = request.cookies[SESSION_COOKIE];
          if (token !== undefined && token.length > 0) {
            yield* store.deleteSession(sessionTokenHash(config, token));
          }
          yield* HttpApiBuilder.securitySetCookie(sessionCookie, "", {
            ...cookieOptions(config, 0),
            expires: new Date(0),
          });
        })
      )
      .handle("me", () => Effect.service(CurrentUser));
  })
);
