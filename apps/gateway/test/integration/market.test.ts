/**
 * The Postgres market store (Docker, see setup.ts). Run with `bun run test:integration`
 * from apps/gateway.
 */
import { layer as dbLayer } from "@rentanllm/db";
import { Effect, Layer, ManagedRuntime, Redacted } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defaultSettings, Settings } from "../../src/config.ts";
import type { PaidRequestRecord } from "../../src/domain.ts";
import { MarketStore } from "../../src/services/market-store.ts";
import { PostgresMarketStore } from "../../src/services/postgres-market.ts";
import { testLogger } from "../harness.ts";
import { integrationEnabled, TEST_DATABASE_URL } from "./env.ts";

const ids = {
  disabledAccount: "00000000-0000-4000-8000-0000000001f2",
  disabledListing: "00000000-0000-4000-8000-0000000001e3",
  disabledNode: "00000000-0000-4000-8000-0000000001d2",
  draftListing: "00000000-0000-4000-8000-0000000001e2",
  liveListing: "00000000-0000-4000-8000-0000000001e1",
  node: "00000000-0000-4000-8000-0000000001d1",
  owner: "00000000-0000-4000-8000-0000000001a1",
  providerAccount: "00000000-0000-4000-8000-0000000001f1",
} as const;

const OWNER_WALLET = "0x00000000000000000000000000000000000000bb";
const MODEL = "llama3.1:8b";

const infra = dbLayer({
  maxConnections: 2,
  url: Redacted.make(TEST_DATABASE_URL),
}).pipe(Layer.orDie);

const runtime = ManagedRuntime.make(
  PostgresMarketStore.pipe(
    Layer.provideMerge(infra),
    // A zero TTL so every read sees the rows as they are now.
    Layer.provide(
      Layer.succeed(Settings)({ ...defaultSettings, authCacheTtlMs: 0 })
    ),
    Layer.provide(testLogger)
  )
);

const withStore = <A, E>(
  use: (store: MarketStore["Service"]) => Effect.Effect<A, E>
) => Effect.flatMap(MarketStore.use(Effect.succeed), use);

const seed = (sql: SqlClient) =>
  Effect.gen(function* seedMarket() {
    yield* sql`
      insert into users (id, email, is_owner, wallet_address)
      values (${ids.owner}, 'seller@example.test', true, ${OWNER_WALLET})
    `;
    yield* sql`
      insert into nodes (id, owner_id, mode, status) values
        (${ids.node}, ${ids.owner}, 'owner_hosted', 'online'),
        (${ids.disabledNode}, ${ids.owner}, 'owner_hosted', 'disabled')
    `;
    yield* sql`
      insert into provider_accounts (id, node_id, provider, auth_kind, plan_tier) values
        (${ids.providerAccount}, ${ids.node}, 'ollama', 'api_key', 'Open models · self-hosted'),
        (${ids.disabledAccount}, ${ids.disabledNode}, 'ollama', 'api_key', 'Open models · self-hosted')
    `;
    for (const [listing, account, status] of [
      [ids.liveListing, ids.providerAccount, "live"],
      [ids.draftListing, ids.providerAccount, "draft"],
      [ids.disabledListing, ids.disabledAccount, "live"],
    ] as const) {
      yield* sql`
        insert into listings
          (id, provider_account_id, status, models, max_concurrency,
           price_in_per_mtok_usdc, price_out_per_mtok_usdc)
        values (${listing}, ${account}, ${status}, ${[MODEL, "qwen2.5:7b"]}, 3,
                100000, 200000)
      `;
    }
  });

const paid = (requestId: string, paymentTx: string): PaidRequestRecord => ({
  finishedAt: new Date(),
  httpStatus: 200,
  latencyMs: 420,
  listingId: ids.liveListing,
  maxTokens: 100,
  model: MODEL,
  network: "hedera:testnet",
  nodeId: ids.node,
  ownerId: ids.owner,
  paidMicros: 22n,
  payTo: "0.0.4242",
  payer: "0.0.777",
  paymentTx,
  prices: {
    cacheReadPerMtok: 0n,
    inputPerMtok: 100_000n,
    outputPerMtok: 200_000n,
  },
  requestId,
  status: "ok",
  ttfbMs: 80,
  usage: {
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    inputTokens: 9,
    model: MODEL,
    outputTokens: 2,
  },
  usedMicros: 2n,
});

describe.runIf(integrationEnabled)("market store on Postgres", () => {
  beforeAll(async () => {
    await runtime.runPromise(
      Effect.gen(function* reset() {
        const sql = yield* SqlClient;
        yield* sql`
          truncate paid_requests, listings, provider_accounts, nodes, users cascade
        `;
        yield* seed(sql);
      })
    );
  });

  afterAll(async () => {
    await runtime.dispose();
  });

  it("offers only live listings on usable nodes, with the seller's wallet", async () => {
    const offers = await runtime.runPromise(
      withStore((store) => store.offers(MODEL))
    );
    expect(offers).toEqual([
      {
        listingId: ids.liveListing,
        maxConcurrency: 3,
        models: [MODEL, "qwen2.5:7b"],
        nodeId: ids.node,
        ownerId: ids.owner,
        ownerWallet: OWNER_WALLET,
        prices: expect.objectContaining({
          inputPerMtok: 100_000n,
          outputPerMtok: 200_000n,
        }),
        provider: "ollama",
      },
    ]);
    const none = await runtime.runPromise(
      withStore((store) => store.offers("gpt-9"))
    );
    expect(none).toEqual([]);
  });

  it("lists the same live listings in the catalog", async () => {
    const catalog = await runtime.runPromise(
      withStore((store) => store.catalog)
    );
    expect(catalog.map((offer) => offer.listingId)).toEqual([ids.liveListing]);
  });

  it("records a paid request once, by request id and by payment", async () => {
    const results = await runtime.runPromise(
      Effect.gen(function* recordTwice() {
        const store = yield* MarketStore;
        return [
          yield* store.recordPaid(paid("req_pg_1", "0.0.777@1730000000.1")),
          yield* store.recordPaid(paid("req_pg_1", "0.0.777@1730000000.2")),
          yield* store.recordPaid(paid("req_pg_2", "0.0.777@1730000000.1")),
        ] as const;
      })
    );
    expect(results).toEqual([true, false, false]);
    const rows = await runtime.runPromise(
      Effect.gen(function* readBack() {
        const sql = yield* SqlClient;
        return yield* sql<{
          readonly paid_usdc_micros: bigint;
          readonly pay_to: string;
          readonly used_usdc_micros: bigint;
        }>`select paid_usdc_micros, pay_to, used_usdc_micros from paid_requests`;
      })
    );
    expect(rows).toEqual([
      { paid_usdc_micros: 22n, pay_to: "0.0.4242", used_usdc_micros: 2n },
    ]);
  });
});
