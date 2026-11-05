/**
 * `bun run db:sync` — push schema.ts, then upsert API list prices.
 * DATABASE_URL defaults to the local docker-compose Postgres.
 */
import { Effect, Layer, Redacted } from "effect";

import { layer } from "./client";
import { pushSchema, seedPrices } from "./sync";

const DEFAULT_URL = "postgres://rentanllm:rentanllm@localhost:54329/rentanllm";

const url = process.env.DATABASE_URL ?? DEFAULT_URL;

pushSchema(url);
await Effect.runPromise(
  seedPrices.pipe(
    Effect.provide(layer({ url: Redacted.make(url) }).pipe(Layer.orDie))
  )
);
