import { RentAnLlmApi } from "@rentanllm/api-contract";
import type { Db } from "@rentanllm/db";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { listModels, priceSuggestion } from "../../services/pricing";
import { captureServices } from "../app-services";

export const PricingHandlers = HttpApiBuilder.group(
  RentAnLlmApi,
  "pricing",
  Effect.fn(function* pricingHandlers(handlers) {
    const provide = yield* captureServices<Db>();
    return handlers
      .handle("suggestion", ({ query }) => provide(priceSuggestion(query)))
      .handle("models", () => provide(listModels()));
  })
);
