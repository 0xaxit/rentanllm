/**
 * The gateway on real Postgres + Redis (Docker, see setup.ts). Run with
 * `bun run test:integration` from apps/gateway.
 */
import { setTimeout as sleep } from "node:timers/promises";

import { NodeRedis } from "@effect/platform-node";
import { layer as dbLayer } from "@rentanllm/db";
import { Effect, Layer, ManagedRuntime, Redacted } from "effect";
import { Redis } from "effect/persistence/Redis";
import { SqlClient } from "effect/sql/SqlClient";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defaultSettings, Settings } from "../../src/config.ts";
import type { GatewaySettings } from "../../src/config.ts";
import { sha256Hex } from "../../src/hash.ts";
import { RateLimiter } from "../../src/services/rate-limiter.ts";
import { postgresStoresLayer } from "../../src/stores.ts";
import {
  cannedResponder,
  connectFakeNode,
  freshMeters,
  startGatewayWith,
  testLogger,
} from "../harness.ts";
import type { FakeNode, RunningGateway } from "../harness.ts";
import {
  integrationEnabled,
  TEST_DATABASE_URL,
  TEST_REDIS_URL,
} from "./env.ts";

const ids = {
  listing: "00000000-0000-4000-8000-0000000000e1",
  node: "00000000-0000-4000-8000-0000000000d1",
  owner: "00000000-0000-4000-8000-0000000000a1",
  providerAccount: "00000000-0000-4000-8000-0000000000f1",
} as const;

const NODE_TOKEN = "nt_pg_node_local_only";
const settings: GatewaySettings = { ...defaultSettings };

const infra = Layer.mergeAll(
  dbLayer({ maxConnections: 4, url: Redacted.make(TEST_DATABASE_URL) }),
  NodeRedis.layer({ url: TEST_REDIS_URL })
).pipe(Layer.orDie);

const settingsLayer = Layer.succeed(Settings)(settings);

/** Stores over fresh connections, like one gateway process. */
const storesLayer = postgresStoresLayer.pipe(Layer.provide(infra));

/** Direct access to the stores plus SQL and Redis, for assertions. */
const makeRuntime = () =>
  ManagedRuntime.make(
    postgresStoresLayer.pipe(
      Layer.provideMerge(infra),
      Layer.provideMerge(settingsLayer),
      Layer.provide(testLogger)
    )
  );

type TestRuntime = ReturnType<typeof makeRuntime>;

let runtime: TestRuntime;
let otherRuntime: TestRuntime;
let gw: RunningGateway<null>;
let node: FakeNode;

const query = <A extends object>(
  run: (sql: SqlClient) => Effect.Effect<readonly A[], unknown>
) =>
  runtime.runPromise(
    Effect.gen(function* runQuery() {
      return yield* run(yield* SqlClient);
    })
  );

const OWNER_WALLET = "0x00000000000000000000000000000000000000aa";

const seed = (sql: SqlClient) =>
  Effect.gen(function* seedDatabase() {
    yield* sql`
      insert into users (id, email, is_owner, wallet_address)
      values (${ids.owner}, 'owner@example.test', true, ${OWNER_WALLET})
    `;
    yield* sql`
      insert into nodes (id, owner_id, mode, node_token_hash)
      values (${ids.node}, ${ids.owner}, 'owner_hosted', ${sha256Hex(NODE_TOKEN)})
    `;
    yield* sql`
      insert into provider_accounts (id, node_id, provider, auth_kind, plan_tier)
      values (${ids.providerAccount}, ${ids.node}, 'ollama', 'api_key', 'not detected yet')
    `;
    yield* sql`
      insert into listings
        (id, provider_account_id, status, models, max_concurrency,
         price_in_per_mtok_usdc, price_out_per_mtok_usdc,
         session_cutoff_pct, weekly_cutoff_pct)
      values
        (${ids.listing}, ${ids.providerAccount}, 'live', ${["llama3.1:8b"]}, 4,
         50000, 200000, 90, 80)
    `;
  });

const eventually = async <A>(
  read: () => Promise<A>,
  accept: (value: A) => boolean,
  timeoutMs = 5000
): Promise<A> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- polling
    const value = await read();
    if (accept(value) || Date.now() > deadline) {
      return value;
    }
    // oxlint-disable-next-line no-await-in-loop -- polling
    await sleep(50);
  }
};

/** Sets the session cut-off on every listing of the seeded plan. */
const setSessionCutoff = (pct: number) =>
  query(
    (sql) => sql`
      update listings set session_cutoff_pct = ${pct}
      where provider_account_id = ${ids.providerAccount}
    `
  );

const hold = (rt: TestRuntime) =>
  rt.runPromise(
    Effect.scoped(
      Effect.gen(function* holdSlot() {
        const acquired = yield* (yield* RateLimiter).acquireSlot(
          "listing_atomic",
          3
        );
        yield* Effect.sleep(200);
        return acquired;
      })
    )
  );

describe.runIf(integrationEnabled)("gateway on Postgres + Redis", () => {
  beforeAll(async () => {
    runtime = makeRuntime();
    otherRuntime = makeRuntime();
    await runtime.runPromise(
      Effect.gen(function* reset() {
        const sql = yield* SqlClient;
        yield* sql`
          truncate paid_requests, listings, provider_accounts, nodes, users cascade
        `;
        yield* (yield* Redis).send("FLUSHALL");
        yield* seed(sql);
      })
    );
    gw = await startGatewayWith(storesLayer, null, settings);
    node = await connectFakeNode({
      meters: {
        ...freshMeters(10),
        plan: "Open models · self-hosted",
        source: "api_rate_limit",
      },
      nodeId: ids.node,
      onProxy: cannedResponder,
      providers: ["ollama"],
      token: NODE_TOKEN,
      url: gw.tunnelUrl,
    });
  });

  afterAll(async () => {
    await node?.close();
    await gw?.close();
    await runtime?.dispose();
    await otherRuntime?.dispose();
  });

  it("authenticates nodes by node_token_hash and persists heartbeats and meters", async () => {
    await expect(
      connectFakeNode({
        nodeId: ids.node,
        token: "nt_wrong",
        url: gw.tunnelUrl,
      })
    ).rejects.toThrow("unexpected response 401");
    expect(node.received.find((m) => m._tag === "SetAvailability")).toEqual({
      _tag: "SetAvailability",
      open: true,
      sessionCutoffPct: 90,
      weeklyCutoffPct: 80,
    });
    const [persisted] = await eventually(
      () =>
        query<{
          readonly auth_kind: string;
          readonly detected_plans: Record<string, string>;
          readonly last_heartbeat_at: Date | null;
          readonly plan_tier: string;
          readonly session_used_pct: number | null;
          readonly status: string;
          readonly usage_read_at: Date | null;
        }>(
          (sql) => sql`
            select n.status, n.last_heartbeat_at, n.detected_plans,
                   pa.session_used_pct, pa.usage_read_at, pa.plan_tier, pa.auth_kind
            from nodes n join provider_accounts pa on pa.node_id = n.id
            where n.id = ${ids.node}
          `
        ),
      (rows) => rows[0]?.status === "online" && rows[0]?.session_used_pct === 10
    );
    expect(persisted?.status).toBe("online");
    expect(persisted?.session_used_pct).toBe(10);
    expect(persisted?.last_heartbeat_at).not.toBe(null);
    expect(persisted?.usage_read_at).not.toBe(null);
    // The plan the node read from the provider replaces the tier the owner was seeded with.
    expect(persisted?.detected_plans).toEqual({
      ollama: "Open models · self-hosted",
    });
    expect(persisted?.plan_tier).toBe("Open models · self-hosted");
    expect(persisted?.auth_kind).toBe("api_key");
  });

  it("resends availability to a connected node when its listings change", async () => {
    await setSessionCutoff(70);
    try {
      node.sendHeartbeat(freshMeters(10));
      await expect(
        node.waitFor(
          (m) => m._tag === "SetAvailability" && m.sessionCutoffPct === 70
        )
      ).resolves.toEqual({
        _tag: "SetAvailability",
        open: true,
        sessionCutoffPct: 70,
        weeklyCutoffPct: 80,
      });
    } finally {
      await setSessionCutoff(90);
      node.sendHeartbeat(freshMeters(10));
      await node.waitFor(
        (m) => m._tag === "SetAvailability" && m.sessionCutoffPct === 90
      );
    }
  });

  it("limits concurrency atomically across processes", async () => {
    const held = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        hold(i % 2 === 0 ? runtime : otherRuntime)
      )
    );
    expect(held.filter(Boolean)).toHaveLength(3);
    // Every slot was released when its scope closed.
    expect(await hold(otherRuntime)).toBe(true);
  });

  it("marks the node offline when its tunnel closes", async () => {
    await node.close();
    const rows = await eventually(
      () =>
        query<{ readonly status: string }>(
          (sql) => sql`select status from nodes where id = ${ids.node}`
        ),
      (r) => r[0]?.status === "offline"
    );
    expect(rows[0]?.status).toBe("offline");
  });
});
