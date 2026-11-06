import { CurrentUser, RentAnLlmApi } from "@rentanllm/api-contract";
import type { Db } from "@rentanllm/db";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { currentDate } from "../../clock";
import type { AgentWalletChain } from "../../hedera/agent-wallets";
import type { HederaMirror } from "../../hedera/mirror";
import { agentWalletOf, createAgentWallet } from "../../services/agent-wallet";
import { buyerOverview, updateBuyerPolicy } from "../../services/buyer";
import { captureServices } from "../app-services";

export const BuyerHandlers = HttpApiBuilder.group(
  RentAnLlmApi,
  "buyer",
  Effect.fn(function* buyerHandlers(handlers) {
    const provide = yield* captureServices<
      AgentWalletChain | Db | HederaMirror
    >();
    /** Runs `f` with the signed-in buyer's id and the app services. */
    const asBuyer = <A, E, R>(
      f: (userId: string, now: Date) => Effect.Effect<A, E, R>
    ) =>
      provide(
        Effect.gen(function* asBuyerGen() {
          const user = yield* Effect.service(CurrentUser);
          return yield* f(user.id, yield* currentDate);
        })
      );
    return handlers
      .handle("overview", () => asBuyer(buyerOverview))
      .handle("updatePolicy", ({ payload }) =>
        asBuyer((userId, now) => updateBuyerPolicy(userId, payload, now))
      )
      .handle("agentWallet", () => asBuyer(agentWalletOf))
      .handle("createAgentWallet", () => asBuyer(createAgentWallet));
  })
);
