/** Seller nodes as ERC-8004 agents: registration file, linking, reputation posts. */
import { Db } from "@rentanllm/db";
import { nodeSessions, paidRequests } from "@rentanllm/db/schema";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hederaMirrorStub } from "../src/hedera/mirror";
import { erc8004Stub } from "../src/reputation/erc8004";
import type { Feedback } from "../src/reputation/erc8004";
import { baseUrl, freshDatabase } from "./support/database";
import { makeTestApp } from "./support/test-app";
import type { TestApp } from "./support/test-app";

const HOUR_MS = 3_600_000;
const UAID =
  /^uaid:aid:[1-9A-HJ-NP-Za-km-z]+;uid=7;registry=erc-8004;proto=x402;nativeId=eip155:296:0x[0-9a-f]{40}$/u;

const agents = new Map<bigint, { owner: string; uri: string }>();
const posted: { agentId: bigint; feedback: Feedback }[] = [];

const seller = async (target: TestApp) => {
  const owner = await target.signIn();
  const node = await target.call("POST", "/owner/nodes", {
    body: {},
    cookie: owner.cookie,
  });
  const account = await target.call(
    "POST",
    `/owner/nodes/${node.json.node.id}/accounts`,
    { body: { provider: "ollama" }, cookie: owner.cookie }
  );
  const listing = await target.call("POST", "/owner/listings", {
    body: {
      models: ["llama3.1:8b"],
      priceInPerMtokUsdc: "50000",
      priceOutPerMtokUsdc: "200000",
      providerAccountId: account.json.id,
      status: "live",
    },
    cookie: owner.cookie,
  });
  return {
    listingId: listing.json.id as string,
    nodeId: node.json.node.id as string,
    owner,
  };
};

describe.runIf(baseUrl !== undefined)("agent identity", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = makeTestApp(
      await freshDatabase("agents"),
      {},
      hederaMirrorStub(),
      erc8004Stub(agents, posted)
    );
  }, 90_000);

  afterAll(async () => {
    await app?.dispose();
  });

  it("serves a registration file and links an agent the owner holds", async () => {
    const { nodeId, owner } = await seller(app);
    const before = await app.call("GET", `/owner/nodes/${nodeId}/identity`, {
      cookie: owner.cookie,
    });
    expect(before.status).toBe(200);
    expect(before.json.agent).toBeNull();
    expect(before.json.registrationUrl).toBe(
      `http://api.test/agents/${nodeId}/registration.json`
    );

    const file = await app.call("GET", `/agents/${nodeId}/registration.json`);
    expect(file.status).toBe(200);
    expect(file.json).toMatchObject({
      active: true,
      registrations: [],
      services: [
        { endpoint: "http://gateway.test/v1/chat/completions", name: "x402" },
        { name: "web" },
      ],
      supportedTrust: ["reputation"],
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      x402Support: true,
    });

    agents.set(7n, { owner: owner.address, uri: before.json.registrationUrl });
    const linked = await app.call("PUT", `/owner/nodes/${nodeId}/identity`, {
      body: { agentId: "7" },
      cookie: owner.cookie,
    });
    expect(linked.status).toBe(200);
    expect(linked.json.agent.agentId).toBe("7");
    expect(linked.json.agent.uaid).toMatch(UAID);

    const after = await app.call("GET", `/agents/${nodeId}/registration.json`);
    expect(after.json.registrations).toEqual([
      {
        agentId: 7,
        agentRegistry: "eip155:296:0x8004A818BFB912233c491871b3d84c89A494BD9e",
      },
    ]);
    expect(after.json.uaid).toBe(linked.json.agent.uaid);
  });

  it("refuses an agent the owner does not hold or that points elsewhere", async () => {
    const { nodeId, owner } = await seller(app);
    agents.set(8n, {
      owner: "0x0000000000000000000000000000000000000001",
      uri: `http://api.test/agents/${nodeId}/registration.json`,
    });
    agents.set(9n, {
      owner: owner.address,
      uri: "https://elsewhere.test/a.json",
    });
    const link = (agentId: string) =>
      app.call("PUT", `/owner/nodes/${nodeId}/identity`, {
        body: { agentId },
        cookie: owner.cookie,
      });
    const notOwned = await link("8");
    const wrongUri = await link("9");
    const missing = await link("404");
    const garbage = await link("abc");
    expect(notOwned.status).toBe(422);
    expect(notOwned.json.message).toContain("owned by");
    expect(wrongUri.status).toBe(422);
    expect(wrongUri.json.message).toContain(
      "not this node's registration file"
    );
    expect(missing.status).toBe(422);
    expect(garbage.status).toBe(422);
  });

  it("posts measured uptime, time to first byte and success rate, then waits", async () => {
    const { listingId, nodeId, owner } = await seller(app);
    agents.set(10n, {
      owner: owner.address,
      uri: `http://api.test/agents/${nodeId}/registration.json`,
    });
    await app.call("PUT", `/owner/nodes/${nodeId}/identity`, {
      body: { agentId: "10" },
      cookie: owner.cookie,
    });
    const now = Date.now();
    const request = (n: number, ttfbMs: number, ok: boolean) => ({
      createdAt: new Date(now - n * 60_000),
      finishedAt: new Date(now - n * 60_000),
      httpStatus: ok ? 200 : 502,
      listingId,
      maxTokens: 64,
      model: "llama3.1:8b",
      network: "hedera:testnet",
      nodeId,
      ownerId: owner.user.id as string,
      paidUsdcMicros: 100n,
      payTo: "0.0.2002",
      payer: "0.0.1001",
      paymentTx: `0.0.9185802@${now}.rep${n}`,
      priceInPerMtokUsdc: 50_000n,
      priceOutPerMtokUsdc: 200_000n,
      requestId: `req_rep_${n}`,
      status: ok ? ("ok" as const) : ("error" as const),
      ttfbMs,
      usedUsdcMicros: 100n,
    });
    await app.run(
      Effect.gen(function* seed() {
        const db = yield* Db;
        yield* db
          .insert(paidRequests)
          .values([
            request(1, 100, true),
            request(2, 300, true),
            request(3, 200, true),
            request(4, 900, false),
          ]);
        // Connected 12 hours ago, still connected: 100% of the time it has been tracked.
        yield* db
          .insert(nodeSessions)
          .values({ connectedAt: new Date(now - 12 * HOUR_MS), nodeId });
      })
    );

    const offers = await app.call("GET", "/market/offers");
    const offer = offers.json.find(
      (o: { nodeId: string }) => o.nodeId === nodeId
    );
    expect(offer.agent.agentId).toBe("10");
    expect(offer.reputation).toMatchObject({
      requests24h: 4,
      successPct: 75,
      ttfbMs: 250,
    });

    const cron = { bearer: "test-cron-secret-0123456789abcdef0123" };
    const first = await app.call("GET", "/cron/reputation", cron);
    expect(first.status).toBe(200);
    const mine = first.json.reported.find(
      (r: { agentId: string }) => r.agentId === "10"
    );
    expect(mine.transactions).toHaveLength(3);
    const forTen = posted
      .filter((p) => p.agentId === 10n)
      .map((p) => [p.feedback.tag1, p.feedback.value, p.feedback.decimals]);
    expect(forTen).toEqual([
      ["uptime", expect.any(BigInt), 2],
      ["ttfbMs", 250n, 0],
      ["successRate", 7500n, 2],
    ]);

    const second = await app.call("GET", "/cron/reputation", cron);
    expect(second.json.reported).toEqual([]);
    const unauthorized = await app.call("GET", "/cron/reputation");
    expect(unauthorized.status).toBe(401);
  });
});
