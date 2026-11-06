import { CurrentUser, RentAnLlmApi } from "@rentanllm/api-contract";
import type { Db } from "@rentanllm/db";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { currentDate } from "../../clock";
import { approveGrant, denyGrant, grantInfo } from "../../services/oauth";
import { captureServices } from "../app-services";

export const OAuthHandlers = HttpApiBuilder.group(
  RentAnLlmApi,
  "oauth",
  Effect.fn(function* oauthHandlers(handlers) {
    const provide = yield* captureServices<Db>();
    const signedIn = <A, E, R>(
      f: (userId: string, now: Date) => Effect.Effect<A, E, R>
    ) =>
      provide(
        Effect.gen(function* signedInGen() {
          const user = yield* Effect.service(CurrentUser);
          return yield* f(user.id, yield* currentDate);
        })
      );
    return handlers
      .handle("grant", ({ params }) =>
        signedIn((_userId, now) => grantInfo(params.grantId, now))
      )
      .handle("approve", ({ params }) =>
        signedIn((userId, now) => approveGrant(userId, params.grantId, now))
      )
      .handle("deny", ({ params }) =>
        signedIn((_userId, now) => denyGrant(params.grantId, now))
      );
  })
);
