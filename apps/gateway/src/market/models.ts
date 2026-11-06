/**
 * GET /v1/models: what the market sells right now, in the OpenAI list shape agents and SDKs
 * already read, plus per-model market facts: how many sellers are online and the cheapest
 * online prices (USDC per million tokens). Models with no seller online are listed with
 * `sellers_online: 0` so an agent can tell "not sold" from "sold, but nobody is up".
 *
 * The list is read from the public Arkiv board (the gateway's own `rentanllm.offer`
 * entities), so it is the same data anyone can check on chain; `source` says so. When
 * Arkiv does not answer it comes from the database instead.
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
import { ArkivMirror } from "./arkiv-mirror.ts";
import type { ArkivBoard } from "./arkiv-mirror.ts";
import { CHAT_COMPLETIONS_PATH } from "./route.ts";

interface ModelEntry {
  /** The Arkiv entities this model was read from; empty when read from the database. */
  entities: string[];
  cheapestInput: Micros | null;
  /** "image": sold on POST /v1/images/generations, cheapestOutput is per image. */
  kind: "chat" | "image";
  cheapestOutput: Micros | null;
  online: number;
  sellers: number;
}

const lower = (current: Micros | null, candidate: Micros) =>
  current === null || candidate < current ? candidate : current;

const emptyEntry = (kind: ModelEntry["kind"]): ModelEntry => ({
  cheapestInput: null,
  cheapestOutput: null,
  entities: [],
  kind,
  online: 0,
  sellers: 0,
});

/** The market as the public Arkiv board shows it, one entity per listing and model. */
const fromBoard = (board: ArkivBoard): Map<string, ModelEntry> => {
  const models = new Map<string, ModelEntry>();
  for (const offer of board.offers) {
    const entry = models.get(offer.model) ?? emptyEntry(offer.kind);
    entry.sellers += 1;
    entry.entities.push(offer.key);
    if (offer.online) {
      entry.online += 1;
      entry.cheapestInput = lower(entry.cheapestInput, offer.priceIn);
      entry.cheapestOutput = lower(entry.cheapestOutput, offer.priceOut);
    }
    models.set(offer.model, entry);
  }
  return models;
};

/** The market from the database, with live online state: the fallback when Arkiv is slow. */
const fromDatabase = Effect.gen(function* modelsFromDatabase() {
  const offers = yield* (yield* MarketStore).catalog;
  const hub = yield* TunnelHub;
  const models = new Map<string, ModelEntry>();
  for (const offer of offers) {
    if (!ALLOWED_PATHS[offer.provider].includes(CHAT_COMPLETIONS_PATH)) {
      continue;
    }
    const online = yield* hub.isOnline(offer.nodeId, offer.provider);
    for (const model of offer.models) {
      const entry = models.get(model) ?? emptyEntry(offer.kind);
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
  return models;
});

export const handleListModels = Effect.gen(function* listModels() {
  const { market } = yield* Settings;
  if (market === null) {
    return yield* new NotFound({
      message: "The pay-per-request market is not enabled on this gateway.",
    });
  }
  const board = yield* (yield* ArkivMirror).board;
  const models = board === null ? yield* fromDatabase : fromBoard(board);
  const data = [...models.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([id, entry]) => ({
      arkiv_entities: entry.entities,
      cheapest_input_usdc_per_mtok:
        entry.cheapestInput === null ? null : formatUsdc(entry.cheapestInput),
      cheapest_output_usdc_per_mtok:
        entry.cheapestOutput === null ? null : formatUsdc(entry.cheapestOutput),
      id,
      kind: entry.kind,
      object: "model" as const,
      owned_by: "rentanllm-market",
      sellers: entry.sellers,
      sellers_online: entry.online,
    }));
  return HttpServerResponse.jsonUnsafe(
    {
      arkiv_writer: board?.writer ?? null,
      chain: market.chain.network,
      data,
      object: "list",
      source: board === null ? "database" : "arkiv",
    },
    { headers: { "cache-control": "no-store" } }
  );
});
