/**
 * Effect access to Postgres.
 *
 * Built on `drizzle-orm/effect-postgres` (drizzle-orm 1.0 RC), which runs Drizzle queries
 * on top of `@effect/sql-pg` 4.x. Drizzle queries are Effects: `yield* db.select()...`.
 * `PgClient` / `SqlClient` from effect are provided too, for raw `sql` template queries.
 *
 * `@effect/sql-pg` speaks the Postgres wire protocol itself over `node:net`, so this works
 * in Node and in Vercel Node.js functions, not in edge runtimes.
 */
import { PgClient } from "@effect/sql-pg";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { Config, Context, Duration, Effect, Layer } from "effect";
import type { Redacted } from "effect";
import type { SqlClient } from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

export type Database = Effect.Success<
  ReturnType<typeof PgDrizzle.makeWithDefaults>
>;

/** The Drizzle database. `const db = yield* Db` then `yield* db.select().from(users)`. */
export class Db extends Context.Service<Db, Database>()("@rentanllm/db/Db") {}

/** Builds `Db` from a `PgClient` already in context. */
export const DbFromPgClient: Layer.Layer<Db, never, PgClient.PgClient> =
  Layer.effect(Db, PgDrizzle.makeWithDefaults());

export interface DbOptions {
  /** Pool size. Keep it small (1-3) in serverless functions. */
  readonly maxConnections?: number;
  readonly url: Redacted.Redacted;
}

const DEFAULT_MAX_CONNECTIONS = 5;
const IDLE_TIMEOUT = Duration.seconds(10);

/** `Db` plus `PgClient` and `SqlClient`, connecting to `options.url`. */
export const layer = (
  options: DbOptions
): Layer.Layer<Db | PgClient.PgClient | SqlClient, SqlError> =>
  DbFromPgClient.pipe(
    Layer.provideMerge(
      PgClient.layer({
        idleTimeout: IDLE_TIMEOUT,
        maxConnections: options.maxConnections ?? DEFAULT_MAX_CONNECTIONS,
        url: options.url,
      })
    )
  );

/** Same as `layer`, reading `DATABASE_URL` and optional `DB_MAX_CONNECTIONS` from config. */
export const layerFromEnv: Layer.Layer<
  Db | PgClient.PgClient | SqlClient,
  SqlError | Config.ConfigError
> = Layer.unwrap(
  Effect.gen(function* layerFromEnvGen() {
    const url = yield* Config.Redacted("DATABASE_URL");
    const maxConnections = yield* Config.Int("DB_MAX_CONNECTIONS").pipe(
      Config.withDefault(DEFAULT_MAX_CONNECTIONS)
    );
    return layer({ maxConnections, url });
  })
);
