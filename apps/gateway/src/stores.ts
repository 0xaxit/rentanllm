/**
 * Store selection. STORE=memory (default) seeds every store from a JSON fixture;
 * STORE=postgres uses Postgres (DATABASE_URL) for nodes, listings and paid market requests,
 * and Redis (REDIS_URL) for per-listing concurrency slots.
 */
import { fileURLToPath } from "node:url";

import { NodeRedis } from "@effect/platform-node";
import { layerFromEnv as dbLayerFromEnv } from "@rentanllm/db";
import { Config, Effect, Layer } from "effect";

import type { StoreServices } from "./app.ts";
import type { Settings } from "./config.ts";
import {
  loadSeedFile,
  makeMemoryState,
  memoryStoresLayer,
} from "./services/memory.ts";
import { PostgresMarketStore } from "./services/postgres-market.ts";
import { PostgresNodeRegistry } from "./services/postgres-nodes.ts";
import { RedisRateLimiter } from "./services/redis-rate-limiter.ts";

const DEFAULT_SEED = fileURLToPath(
  new URL("../fixtures/dev-seed.json", import.meta.url)
);

/** Postgres + Redis stores over a `SqlClient` and a `Redis` already in context. */
export const postgresStoresLayer = Layer.mergeAll(
  PostgresMarketStore,
  PostgresNodeRegistry,
  RedisRateLimiter
);

export const redisLayerFromEnv = NodeRedis.layerConfig({
  url: Config.String("REDIS_URL"),
});

export const StoresFromEnv: Layer.Layer<StoreServices, unknown, Settings> =
  Layer.unwrap(
    Effect.gen(function* chooseStores() {
      const store = yield* Config.Literals(
        ["memory", "postgres"],
        "STORE"
      ).pipe(Config.withDefault("memory"));
      if (store === "postgres") {
        yield* Effect.logInfo("using Postgres + Redis stores");
        return postgresStoresLayer.pipe(
          Layer.provide(dbLayerFromEnv),
          Layer.provide(redisLayerFromEnv)
        );
      }
      const seedFile = yield* Config.String("GATEWAY_SEED_FILE").pipe(
        Config.withDefault(DEFAULT_SEED)
      );
      yield* Effect.logInfo("using in-memory stores").pipe(
        Effect.annotateLogs({ seedFile })
      );
      return memoryStoresLayer(makeMemoryState(loadSeedFile(seedFile)));
    })
  );
