/**
 * Integration tests run when DATABASE_URL points at a disposable Postgres, e.g.
 *   bun run --cwd packages/db db:up
 *   DATABASE_URL=postgres://rentanllm:rentanllm@localhost:54329/rentanllm bun run --cwd apps/api test
 * Each test file gets its own freshly synced database (`<db>_api_<name>`), so files
 * can run in parallel and never touch the database DATABASE_URL names.
 */
import { layer } from "@rentanllm/db";
import { pushSchema, seedPrices } from "@rentanllm/db/sync";
import { Effect, Layer, Redacted } from "effect";
import { SqlClient } from "effect/sql/SqlClient";

export const baseUrl = process.env.DATABASE_URL;

const SAFE_NAME = /^[a-z0-9_]+$/u;

export const freshDatabase = async (name: string): Promise<string> => {
  if (baseUrl === undefined) {
    throw new Error("DATABASE_URL is not set");
  }
  const url = new URL(baseUrl);
  const database = `${url.pathname.slice(1)}_api_${name}`;
  if (!SAFE_NAME.test(database)) {
    throw new Error(`unsafe database name ${database}`);
  }
  await Effect.runPromise(
    Effect.gen(function* recreateDatabase() {
      const sql = yield* SqlClient;
      yield* sql.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      yield* sql.unsafe(`CREATE DATABASE ${database}`);
    }).pipe(
      Effect.provide(
        layer({ maxConnections: 1, url: Redacted.make(baseUrl) }).pipe(
          Layer.orDie
        )
      )
    )
  );
  url.pathname = `/${database}`;
  const target = url.toString();
  await pushSchema(target);
  await Effect.runPromise(
    seedPrices.pipe(
      Effect.provide(
        layer({ maxConnections: 1, url: Redacted.make(target) }).pipe(
          Layer.orDie
        )
      )
    )
  );
  return target;
};
