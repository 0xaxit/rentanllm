import {
  Authentication,
  CurrentUser,
  Unauthorized,
} from "@rentanllm/api-contract";
import { Effect, Layer, Redacted } from "effect";

import { AuthStore } from "../auth/auth-store";
import { sessionTokenHash } from "../auth/session-token";
import { currentDate } from "../clock";
import { ApiConfig } from "../config";

/** Resolves the session cookie to the signed-in user (sessions table, unexpired). */
export const AuthenticationLive = Layer.effect(Authentication)(
  Effect.gen(function* makeAuthentication() {
    const store = yield* AuthStore;
    const config = yield* ApiConfig;
    return Authentication.of({
      session: Effect.fn("auth.session")(function* sessionGen(
        httpEffect,
        { credential }
      ) {
        const token = Redacted.value(credential);
        if (token.length === 0) {
          return yield* new Unauthorized({ message: "Not signed in" });
        }
        const user = yield* store.findSessionUser(
          sessionTokenHash(config, token),
          yield* currentDate
        );
        if (user === undefined) {
          return yield* new Unauthorized({
            message: "Session expired or unknown",
          });
        }
        yield* Effect.annotateCurrentSpan({ "user.id": user.id });
        return yield* Effect.provideService(httpEffect, CurrentUser, user);
      }),
    });
  })
);
