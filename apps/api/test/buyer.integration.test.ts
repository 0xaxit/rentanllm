/** Buyer spending limits and the seller USDC check, end to end over a real Postgres. */
import { Db } from "@rentanllm/db";
import { buyerPolicies, paidRequests } from "@rentanllm/db/schema";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hederaMirrorStub } from "../src/hedera/mirror";
import { baseUrl, freshDatabase } from "./support/database";
import { makeTestApp } from "./support/test-app";
import type { TestApp } from "./support/test-app";

const BUYER_ACCOUNT = "0.0.1001";
const SELLER = "0.0.2002";
const OTHER_SELLER = "0.0.3003";

const LIMITS = {
  allowedSellers: [SELLER, SELLER],
  dailyBudgetUsdc: "1000000",
  maxPerRequestUsdc: "50000",
  paused: false,
  perSellerDailyUsdc: "250000",
  worldApprovalAboveUsdc: "1000",
};

/** A seller with one live open-models listing, to hang paid requests off. */
const sellerListing = async (target: TestApp) => {
  const owner = await target.signIn();
  const node = await target.call("POST", "/owner/nodes", {
    body: {},
    cookie: owner.cookie,
  });
  const account = await target.call(
    "POST",
    `/owner/nodes/${node.json.node.id}/accounts`,
    {
      body: { provider: "ollama" },
      cookie: owner.cookie,
    }
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
  return { account, listing, node, owner };
};

describe.runIf(baseUrl !== undefined)("buyer limits", () => {
  let app: TestApp;
  let noAccount: TestApp;
  let noUsdc: TestApp;

  beforeAll(async () => {
    app = makeTestApp(
      await freshDatabase("buyer"),
      {},
      hederaMirrorStub({ account: BUYER_ACCOUNT })
    );
    noAccount = makeTestApp(
      await freshDatabase("buyer_noacct"),
      {},
      hederaMirrorStub({ account: null })
    );
    noUsdc = makeTestApp(
      await freshDatabase("buyer_nousdc"),
      {},
      hederaMirrorStub({ canReceive: false })
    );
  }, 90_000);

  afterAll(async () => {
    await app?.dispose();
    await noAccount?.dispose();
    await noUsdc?.dispose();
  });

  it("shows the linked account and no limits before any are saved", async () => {
    const buyer = await app.signIn();
    const overview = await app.call("GET", "/buyer/overview", {
      cookie: buyer.cookie,
    });
    expect(overview.status).toBe(200);
    expect(overview.json).toMatchObject({
      account: BUYER_ACCOUNT,
      bySeller: [],
      policy: null,
      recent: [],
      spentLast24hUsdc: "0",
    });
  });

  it("saves limits for the account behind the sign-in wallet", async () => {
    const buyer = await app.signIn();
    const saved = await app.call("PUT", "/buyer/policy", {
      body: LIMITS,
      cookie: buyer.cookie,
    });
    expect(saved.status).toBe(200);
    // The allowlist is stored once per seller.
    expect(saved.json).toEqual({ ...LIMITS, allowedSellers: [SELLER] });
    const [row] = await app.run(
      Effect.gen(function* readPolicy() {
        const db = yield* Db;
        return yield* db
          .select()
          .from(buyerPolicies)
          .where(eq(buyerPolicies.userId, buyer.user.id));
      })
    );
    expect(row?.payerAccount).toBe(BUYER_ACCOUNT);
    expect(row?.perSellerDailyMicros).toBe(250_000n);
    expect(row?.worldApprovalAboveMicros).toBe(1000n);
    const overview = await app.call("GET", "/buyer/overview", {
      cookie: buyer.cookie,
    });
    expect(overview.json.policy).toEqual({
      ...LIMITS,
      allowedSellers: [SELLER],
    });

    // Saving again replaces the limits. A save without the World ID limit keeps it.
    const cleared = await app.call("PUT", "/buyer/policy", {
      body: {
        allowedSellers: null,
        dailyBudgetUsdc: null,
        maxPerRequestUsdc: null,
        paused: true,
        perSellerDailyUsdc: null,
      },
      cookie: buyer.cookie,
    });
    expect(cleared.json).toMatchObject({
      allowedSellers: null,
      paused: true,
      worldApprovalAboveUsdc: "1000",
    });
    const noWorld = await app.call("PUT", "/buyer/policy", {
      body: { ...LIMITS, worldApprovalAboveUsdc: null },
      cookie: buyer.cookie,
    });
    expect(noWorld.json.worldApprovalAboveUsdc).toBeNull();
  });

  it("rejects limits that are zero and sellers that are not Hedera accounts", async () => {
    const buyer = await app.signIn();
    const zero = await app.call("PUT", "/buyer/policy", {
      body: { ...LIMITS, dailyBudgetUsdc: "0" },
      cookie: buyer.cookie,
    });
    expect(zero.status).toBe(400);
    const badSeller = await app.call("PUT", "/buyer/policy", {
      body: { ...LIMITS, allowedSellers: ["0x53e8"] },
      cookie: buyer.cookie,
    });
    expect(badSeller.status).toBe(400);
  });

  it("needs a sign-in", async () => {
    const overview = await app.call("GET", "/buyer/overview");
    const saved = await app.call("PUT", "/buyer/policy", { body: LIMITS });
    expect(overview.status).toBe(401);
    expect(saved.status).toBe(401);
  });

  it("totals the last 24 hours per seller from the account's payments", async () => {
    const buyer = await app.signIn();
    const { listing, node, owner } = await sellerListing(app);
    const now = Date.now();
    const paid = (
      payTo: string,
      micros: bigint,
      hoursAgo: number,
      n: number
    ) => ({
      createdAt: new Date(now - hoursAgo * 3_600_000),
      finishedAt: new Date(now - hoursAgo * 3_600_000),
      httpStatus: 200,
      listingId: listing.json.id as string,
      maxTokens: 64,
      model: "llama3.1:8b",
      network: "hedera:testnet",
      nodeId: node.json.node.id as string,
      ownerId: owner.user.id as string,
      paidUsdcMicros: micros,
      payTo,
      payer: BUYER_ACCOUNT,
      paymentTx: `0.0.9185802@${now}.${n}`,
      priceInPerMtokUsdc: 50_000n,
      priceOutPerMtokUsdc: 200_000n,
      requestId: `req_buyer_${n}`,
      status: "ok" as const,
      usedUsdcMicros: micros,
    });
    await app.run(
      Effect.gen(function* insertPayments() {
        const db = yield* Db;
        yield* db.insert(paidRequests).values([
          paid(SELLER, 300n, 1, 1),
          paid(SELLER, 200n, 2, 2),
          paid(OTHER_SELLER, 1000n, 3, 3),
          // Older than 24 hours: listed under recent, not counted.
          paid(SELLER, 9999n, 30, 4),
        ]);
      })
    );
    const overview = await app.call("GET", "/buyer/overview", {
      cookie: buyer.cookie,
    });
    expect(overview.json.spentLast24hUsdc).toBe("1500");
    expect(overview.json.bySeller).toEqual([
      { paidUsdc: "1000", payTo: OTHER_SELLER, requests: 1 },
      { paidUsdc: "500", payTo: SELLER, requests: 2 },
    ]);
    expect(overview.json.recent).toHaveLength(4);
  });

  it("refuses limits when the sign-in wallet has no Hedera account", async () => {
    const buyer = await noAccount.signIn();
    const saved = await noAccount.call("PUT", "/buyer/policy", {
      body: LIMITS,
      cookie: buyer.cookie,
    });
    expect(saved.status).toBe(422);
    expect(saved.json.message).toContain("no Hedera account");
  });

  it("refuses to list a seller live when their account cannot receive USDC", async () => {
    const owner = await noUsdc.signIn();
    const node = await noUsdc.call("POST", "/owner/nodes", {
      body: {},
      cookie: owner.cookie,
    });
    const account = await noUsdc.call(
      "POST",
      `/owner/nodes/${node.json.node.id}/accounts`,
      {
        body: { provider: "ollama" },
        cookie: owner.cookie,
      }
    );
    const body = {
      models: ["llama3.1:8b"],
      priceInPerMtokUsdc: "50000",
      priceOutPerMtokUsdc: "200000",
      providerAccountId: account.json.id,
    };
    const live = await noUsdc.call("POST", "/owner/listings", {
      body: { ...body, status: "live" },
      cookie: owner.cookie,
    });
    expect(live.status).toBe(422);
    expect(live.json.message).toContain("cannot receive USDC");
    // A draft is fine; going live later is checked again.
    const draft = await noUsdc.call("POST", "/owner/listings", {
      body,
      cookie: owner.cookie,
    });
    expect(draft.status).toBe(201);
    const goLive = await noUsdc.call(
      "PATCH",
      `/owner/listings/${draft.json.id}`,
      {
        body: { status: "live" },
        cookie: owner.cookie,
      }
    );
    expect(goLive.status).toBe(422);
  });
});
