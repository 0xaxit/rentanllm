import { eq } from "drizzle-orm";
/**
 * Runs against a real Postgres when DATABASE_URL is set:
 *   bun run db:up && bun run test:integration && bun run db:down
 */
import { Effect, Layer, Redacted } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { describe, expect, it } from "vitest";

import { Db, layer } from "../src/index";
import {
  apiPriceRefs,
  listings,
  nodes,
  providerAccounts,
  users,
} from "../src/schema";
import { pushSchema, seedPrices } from "../src/sync";

const url = process.env.DATABASE_URL;

const run = <A, E>(program: Effect.Effect<A, E, Db | SqlClient>) =>
  Effect.runPromise(
    program.pipe(
      Effect.provide(
        layer({ maxConnections: 2, url: Redacted.make(url ?? "") }).pipe(
          Layer.orDie
        )
      )
    )
  );

describe.runIf(url !== undefined)("db integration", () => {
  it("syncs from scratch, seeds prices and applies listing defaults", async () => {
    const result = await run(
      Effect.gen(function* integration() {
        const sql = yield* SqlClient;
        yield* sql`drop schema if exists public cascade`;
        yield* sql`drop schema if exists drizzle cascade`;
        yield* sql`create schema public`;
        yield* Effect.sync(() => {
          pushSchema(url ?? "");
        });
        yield* seedPrices;

        const db = yield* Db;
        const prices = yield* db
          .select()
          .from(apiPriceRefs)
          .where(eq(apiPriceRefs.model, "claude-opus-5-5"));

        const [owner] = yield* db
          .insert(users)
          .values({ email: "owner@example.test", isOwner: true })
          .returning();
        const [node] = yield* db
          .insert(nodes)
          .values({ mode: "owner_hosted", ownerId: owner?.id ?? "" })
          .returning();
        const [account] = yield* db
          .insert(providerAccounts)
          .values({
            authKind: "api_key",
            nodeId: node?.id ?? "",
            planTier: "llama3.1:8b",
            provider: "ollama",
          })
          .returning();
        const [listing] = yield* db
          .insert(listings)
          .values({
            models: ["llama3.1:8b"],
            priceInPerMtokUsdc: 1_600_000n,
            priceOutPerMtokUsdc: 8_000_000n,
            providerAccountId: account?.id ?? "",
          })
          .returning();

        return { listing, prices };
      })
    );

    expect(result.prices).toHaveLength(1);
    expect(result.prices[0]?.inputPerMtokUsdc).toBe(4_000_000n);
    expect(result.prices[0]?.cacheReadPerMtokUsdc).toBe(200_000n);
    expect(result.listing?.sessionCutoffPct).toBe(90);
    expect(result.listing?.weeklyCutoffPct).toBe(50);
  });
});
