import { RentAnLlmApi } from "@rentanllm/api-contract";
import type { Db } from "@rentanllm/db";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { marketOffers, recentPaidRequests } from "../../services/market";
import { captureServices } from "../app-services";

export const MarketHandlers = HttpApiBuilder.group(
  RentAnLlmApi,
  "market",
  Effect.fn(function* marketHandlers(handlers) {
    const provide = yield* captureServices<Db>();
    return handlers
      .handle("offers", () => provide(marketOffers()))
      .handle("requests", ({ query }) => provide(recentPaidRequests(query)));
  })
);
