/**
 * In-memory implementations of every store, seeded from a JSON fixture. Good for local
 * development and tests; state is lost on restart and not shared between processes.
 */
import { readFileSync } from "node:fs";

import { ProviderSchema } from "@rentanllm/protocol";
import { Effect, Layer, Schema } from "effect";

import type {
  MarketOffer,
  MeterReading,
  NodeRecord,
  PaidRequestRecord,
} from "../domain.ts";
import { sha256Hex } from "../hash.ts";
import { MarketStore } from "./market-store.ts";
import { NodeRegistry } from "./node-registry.ts";
import { RateLimiter } from "./rate-limiter.ts";

/** Seed prices are plain integers (micros per million tokens). */
const PriceSheetSchema = Schema.Struct({
  cacheReadPerMTokMicros: Schema.Int,
  /** Ignored: @rentanllm/core prices cache writes at the input rate. */
  cacheWritePerMTokMicros: Schema.optionalKey(Schema.Int),
  inputPerMTokMicros: Schema.Int,
  outputPerMTokMicros: Schema.Int,
});

const AvailabilitySchema = Schema.Struct({
  open: Schema.Boolean,
  sessionCutoffPct: Schema.Finite,
  weeklyCutoffPct: Schema.Finite,
});

/**
 * Seed fixture. Node tokens may be given in plain text (`token`, for local dev only) or
 * pre-hashed (`tokenHash`: SHA-256 hex).
 */
export const SeedSchema = Schema.Struct({
  nodes: Schema.Array(
    Schema.Struct({
      availability: Schema.optionalKey(Schema.NullOr(AvailabilitySchema)),
      nodeId: Schema.String,
      token: Schema.optionalKey(Schema.String),
      tokenHash: Schema.optionalKey(Schema.String),
    })
  ),
  /** Live listings sold pay-per-request on the market route. */
  offers: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        listingId: Schema.String,
        maxConcurrency: Schema.Int,
        models: Schema.Array(Schema.String),
        nodeId: Schema.String,
        ownerId: Schema.String,
        ownerWallet: Schema.String,
        prices: PriceSheetSchema,
        provider: ProviderSchema,
      })
    )
  ),
});
export type Seed = typeof SeedSchema.Type;

/** All mutable state behind the in-memory stores. Exposed so tests can inspect it. */
export interface MemoryState {
  /** Requests in flight per slot key. */
  readonly inFlight: Map<string, number>;
  /** Keyed by `${nodeId}:${provider}`. */
  readonly meters: Map<string, MeterReading>;
  /** Keyed by token hash. */
  readonly nodes: Map<string, NodeRecord>;
  readonly offers: MarketOffer[];
  readonly paid: PaidRequestRecord[];
}

const pickHash = (
  plain: string | undefined,
  hashed: string | undefined,
  what: string
): string => {
  if (hashed !== undefined) {
    return hashed.toLowerCase();
  }
  if (plain !== undefined) {
    return sha256Hex(plain);
  }
  throw new TypeError(`Seed: ${what} needs a plain value or a hash`);
};

export const makeMemoryState = (seed: Seed): MemoryState => {
  const nodes = new Map<string, NodeRecord>();
  for (const n of seed.nodes) {
    const tokenHash = pickHash(n.token, n.tokenHash, `node ${n.nodeId}`);
    nodes.set(tokenHash, {
      availability: n.availability ?? null,
      nodeId: n.nodeId,
      tokenHash,
    });
  }
  return {
    inFlight: new Map(),
    meters: new Map(),
    nodes,
    offers: (seed.offers ?? []).map((o) => ({
      listingId: o.listingId,
      maxConcurrency: o.maxConcurrency,
      models: o.models,
      nodeId: o.nodeId,
      ownerId: o.ownerId,
      ownerWallet: o.ownerWallet,
      prices: {
        cacheReadPerMtok: BigInt(o.prices.cacheReadPerMTokMicros),
        inputPerMtok: BigInt(o.prices.inputPerMTokMicros),
        outputPerMtok: BigInt(o.prices.outputPerMTokMicros),
      },
      provider: o.provider,
    })),
    paid: [],
  };
};

export const loadSeedFile = (path: string): Seed =>
  Schema.decodeUnknownSync(SeedSchema)(JSON.parse(readFileSync(path, "utf-8")));

/** In-memory `RateLimiter`: concurrency slots per key. */
export const memoryRateLimiterLayer = (state: MemoryState) =>
  Layer.succeed(RateLimiter)({
    acquireSlot: (key, limit) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const current = state.inFlight.get(key) ?? 0;
          if (current >= limit) {
            return false;
          }
          state.inFlight.set(key, current + 1);
          return true;
        }),
        (acquired) =>
          Effect.sync(() => {
            if (acquired) {
              state.inFlight.set(
                key,
                Math.max(0, (state.inFlight.get(key) ?? 1) - 1)
              );
            }
          })
      ),
  });

/** Builds every store layer over one shared `MemoryState`. */
export const memoryStoresLayer = (state: MemoryState) =>
  Layer.mergeAll(
    Layer.succeed(MarketStore)({
      catalog: Effect.sync(() =>
        state.offers.toSorted((a, b) =>
          a.prices.outputPerMtok < b.prices.outputPerMtok ? -1 : 1
        )
      ),
      offers: (model) =>
        Effect.sync(() =>
          state.offers
            .filter((offer) => offer.models.includes(model))
            .toSorted((a, b) =>
              a.prices.outputPerMtok < b.prices.outputPerMtok ? -1 : 1
            )
        ),
      recordPaid: (record) =>
        Effect.sync(() => {
          const duplicate = state.paid.some(
            (r) =>
              r.requestId === record.requestId ||
              r.paymentTx === record.paymentTx
          );
          if (duplicate) {
            return false;
          }
          state.paid.push(record);
          return true;
        }),
    }),
    memoryRateLimiterLayer(state),
    Layer.succeed(NodeRegistry)({
      availability: (nodeId) =>
        Effect.sync(() => {
          for (const node of state.nodes.values()) {
            if (node.nodeId === nodeId) {
              return node.availability;
            }
          }
          return null;
        }),
      findByTokenHash: (tokenHash) =>
        Effect.sync(() => state.nodes.get(tokenHash.toLowerCase()) ?? null),
      latestMeters: (nodeId, provider) =>
        Effect.sync(() => state.meters.get(`${nodeId}:${provider}`) ?? null),
      recordConnect: () => Effect.succeed(null),
      recordDisconnect: () => Effect.void,
      recordMeters: (nodeId, readings) =>
        Effect.sync(() => {
          for (const reading of readings) {
            state.meters.set(`${nodeId}:${reading.provider}`, reading);
          }
        }),
      recordRegion: () => Effect.void,
      recordSessionEnd: () => Effect.void,
    })
  );
