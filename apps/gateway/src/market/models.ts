/**
 * GET /v1/models: what the market sells right now, in the OpenAI list shape agents and SDKs
 * already read, plus per-model market facts: how many sellers are online and the cheapest
 * online prices (USDC per million tokens). Models with no seller online are listed with
 * `sellers_online: 0` so an agent can tell "not sold" from "sold, but nobody is up".
 */
import { formatUsdc } from "@rentanllm/core";
import type { Micros } from "@rentanllm/core";
import { ALLOWED_PATHS } from "@rentanllm/protocol";
import { Effect } from "effect";
import { HttpServerResponse } from "effect/http";

import { Settings } from "../config.ts";
import { NotFound } from "../errors.ts";
import { MarketStore } from "../services/market-store.ts";
import { TunnelHub } from "../tunnel/tunnel-hub.ts";
import { CHAT_COMPLETIONS_PATH } from "./route.ts";

interface ModelEntry {
  cheapestInput: Micros | null;
  cheapestOutput: Micros | null;
  online: number;
  sellers: number;
}

const lower = (current: Micros | null, candidate: Micros) =>
  current === null || candidate < current ? candidate : current;

export const handleListModels = Effect.gen(function* listModels() {
  const { market } = yield* Settings;
  if (market === null) {
    return yield* new NotFound({
      message: "The pay-per-request market is not enabled on this gateway.",
    });
  }
  const offers = yield* (yield* MarketStore).catalog;
  const hub = yield* TunnelHub;
  const models = new Map<string, ModelEntry>();
  for (const offer of offers) {
    if (!ALLOWED_PATHS[offer.provider].includes(CHAT_COMPLETIONS_PATH)) {
      continue;
    }
    const online = yield* hub.isOnline(offer.nodeId, offer.provider);
    for (const model of offer.models) {
      const entry = models.get(model) ?? {
        cheapestInput: null,
        cheapestOutput: null,
        online: 0,
        sellers: 0,
      };
      entry.sellers += 1;
      if (online) {
        entry.online += 1;
        entry.cheapestInput = lower(
          entry.cheapestInput,
          offer.prices.inputPerMtok
        );
        entry.cheapestOutput = lower(
          entry.cheapestOutput,
          offer.prices.outputPerMtok
        );
      }
      models.set(model, entry);
    }
  }
  const data = [...models.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([id, entry]) => ({
      cheapest_input_usdc_per_mtok:
        entry.cheapestInput === null ? null : formatUsdc(entry.cheapestInput),
      cheapest_output_usdc_per_mtok:
        entry.cheapestOutput === null ? null : formatUsdc(entry.cheapestOutput),
      id,
      object: "model" as const,
      owned_by: "rentanllm-market",
      sellers: entry.sellers,
      sellers_online: entry.online,
    }));
  return HttpServerResponse.jsonUnsafe(
    { chain: market.chain.network, data, object: "list" },
    { headers: { "cache-control": "no-store" } }
  );
});
