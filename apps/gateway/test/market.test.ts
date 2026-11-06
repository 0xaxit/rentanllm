import { once } from "node:events";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";

import type { PaymentRequirements } from "@x402/core/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { MarketSettings } from "../src/config.ts";
import type { BuyerPolicy } from "../src/domain.ts";
import { quotedInputTokens, quotePrice } from "../src/market/quote.ts";
import type { Seed } from "../src/services/memory.ts";
import { HEDERA_TESTNET } from "../src/x402/chains.ts";
import {
  FAKE_HEDERA_FEE_PAYER,
  FAKE_PAYER,
  fakeTxHash,
  payFor,
  paymentRequiredOf,
} from "./fake-facilitator.ts";
import { connectFakeNode, startGateway, waitUntil } from "./harness.ts";
import type { FakeNode, ProxyHandler, RunningGateway } from "./harness.ts";

const CHEAP_WALLET = "0x00000000000000000000000000000000000c4ea9";
const DEAR_WALLET = "0x0000000000000000000000000000000000000dea";
const OFFLINE_WALLET = "0x00000000000000000000000000000000000000ff";
/** Online and cheapest, but with no Hedera account behind the wallet. */
const NO_ACCOUNT_WALLET = "0x0000000000000000000000000000000000000a0a";
/** The mirror node's answer for each seller wallet. */
const HEDERA_ACCOUNTS: Readonly<Record<string, string>> = {
  [CHEAP_WALLET]: "0.0.4242",
  [DEAR_WALLET]: "0.0.5353",
};
const CHEAP_ACCOUNT = "0.0.4242";
const DEAR_ACCOUNT = "0.0.5353";
const MODEL = "llama3.1:8b";
/** The fake node fails every request for this model, like an Ollama that cannot load it. */
const BROKEN_MODEL = "broken:1b";
const CHEAP = { in: 100_000, out: 200_000 };
const DEAR = { in: 300_000, out: 900_000 };

const offer = (
  listingId: string,
  nodeId: string,
  ownerWallet: string,
  prices: { in: number; out: number },
  models: readonly string[] = [MODEL]
) => ({
  listingId,
  maxConcurrency: 2,
  models,
  nodeId,
  ownerId: `owner_${listingId}`,
  ownerWallet,
  prices: {
    cacheReadPerMTokMicros: 0,
    inputPerMTokMicros: prices.in,
    outputPerMTokMicros: prices.out,
  },
  provider: "ollama" as const,
});

const CHEAPEST = { in: 10_000, out: 20_000 };

const SEED: Seed = {
  nodes: [
    { nodeId: "node_cheap", token: "nt_cheap" },
    { nodeId: "node_dear", token: "nt_dear" },
    { nodeId: "node_off", token: "nt_off" },
    { nodeId: "node_noacct", token: "nt_noacct" },
  ],
  offers: [
    offer("l_cheap", "node_cheap", CHEAP_WALLET, CHEAP),
    offer("l_dear", "node_dear", DEAR_WALLET, DEAR),
    offer("l_off", "node_off", OFFLINE_WALLET, CHEAP, ["qwen2.5:7b"]),
    offer("l_broken", "node_cheap", CHEAP_WALLET, CHEAP, [BROKEN_MODEL]),
    offer("l_noacct", "node_noacct", NO_ACCOUNT_WALLET, CHEAPEST),
  ],
};

const market = (hederaMirrorUrl: string): MarketSettings => ({
  arkiv: null,
  audit: null,
  chain: HEDERA_TESTNET,
  defaultMaxTokens: 256,
  hederaMirrorUrl,
  maxQuotedOffers: 3,
  maxTimeoutSeconds: 300,
  maxTokensCeiling: 4096,
  resourceUrl: "https://gateway.test/v1/chat/completions",
});

const chunk = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;

/** Answers like Ollama's OpenAI-compatible endpoint, with usage in the last chunk. */
const ollamaResponder: ProxyHandler = (request, node) => {
  const { requestId } = request;
  if ((JSON.parse(request.body) as { model?: string }).model === BROKEN_MODEL) {
    node.send({
      _tag: "ResponseError",
      code: "provider_error",
      message: "llama runner process has terminated",
      requestId,
    });
    return;
  }
  node.send({
    _tag: "ResponseHead",
    headers: { "content-type": "text/event-stream" },
    requestId,
    status: 200,
  });
  for (const data of [
    chunk({ choices: [{ delta: { content: "Hello" } }], model: MODEL }),
    chunk({ choices: [{ delta: { content: " world" } }], model: MODEL }),
    "data: [DONE]\n\n",
  ]) {
    node.send({ _tag: "ResponseChunk", data, requestId });
  }
  node.send({
    _tag: "ResponseEnd",
    requestId,
    usage: {
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      inputTokens: 9,
      model: MODEL,
      outputTokens: 2,
    },
  });
};

const MESSAGES = [{ content: "Hi there", role: "user" }];

const chat = (
  gw: RunningGateway,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
) =>
  fetch(`${gw.baseUrl}/v1/chat/completions`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
    method: "POST",
  });

const expectedPrice = (
  prices: { in: number; out: number },
  maxTokens: number
) =>
  quotePrice(
    {
      cacheReadPerMtok: 0n,
      inputPerMtok: BigInt(prices.in),
      outputPerMtok: BigInt(prices.out),
    },
    quotedInputTokens(MESSAGES),
    maxTokens
  );

const termsOf = (response: Response) =>
  paymentRequiredOf(response).accepts as PaymentRequirements[];

/** A mirror node stub that knows the Hedera account behind some seller wallets. */
const startMirror = async () => {
  const mirror = createServer((request, response) => {
    const wallet = request.url?.replace("/api/v1/accounts/", "") ?? "";
    const account = HEDERA_ACCOUNTS[wallet];
    response.writeHead(account === undefined ? 404 : 200, {
      "content-type": "application/json",
    });
    response.end(JSON.stringify(account === undefined ? {} : { account }));
  });
  mirror.listen(0, "127.0.0.1");
  await once(mirror, "listening");
  const address = mirror.address();
  if (address === null || typeof address === "string") {
    throw new Error("mirror stub has no port");
  }
  return { mirror, url: `http://127.0.0.1:${address.port}` };
};

const NO_LIMITS: BuyerPolicy = {
  allowedSellers: null,
  dailyBudgetMicros: null,
  maxPerRequestMicros: null,
  paused: false,
  perSellerDailyMicros: null,
};

/** Quotes, pays the cheapest seller under `policy`, and reports what happened. */
const payUnder = async (
  gw: RunningGateway,
  policy: BuyerPolicy,
  nonce: string
) => {
  gw.state.buyerPolicies.set(FAKE_PAYER, policy);
  try {
    const quoted = await chat(gw, {
      max_tokens: 64,
      messages: MESSAGES,
      model: MODEL,
    });
    const [cheapest] = termsOf(quoted);
    if (cheapest === undefined) {
      throw new Error("no terms");
    }
    const settledBefore = gw.facilitator.calls.settle;
    const response = await chat(
      gw,
      { max_tokens: 64, messages: MESSAGES, model: MODEL },
      { "payment-signature": payFor(cheapest, nonce) }
    );
    const text = await response.text();
    return {
      amount: BigInt(cheapest.amount),
      settled: gw.facilitator.calls.settle - settledBefore,
      status: response.status,
      text,
    };
  } finally {
    gw.state.buyerPolicies.delete(FAKE_PAYER);
  }
};

describe("market on Hedera testnet", () => {
  let gw: RunningGateway;
  let mirror: Server;
  let cheap: FakeNode;
  let dear: FakeNode;
  let noAccount: FakeNode;

  beforeAll(async () => {
    const stub = await startMirror();
    ({ mirror } = stub);
    gw = await startGateway(SEED, { market: market(stub.url) });
    const connect = (nodeId: string, token: string) =>
      connectFakeNode({
        nodeId,
        onProxy: ollamaResponder,
        providers: ["ollama"],
        token,
        url: gw.tunnelUrl,
      });
    cheap = await connect("node_cheap", "nt_cheap");
    dear = await connect("node_dear", "nt_dear");
    noAccount = await connect("node_noacct", "nt_noacct");
  });

  afterAll(async () => {
    await cheap.close();
    await dear.close();
    await noAccount.close();
    await gw.close();
    mirror.close();
    await once(mirror, "close");
  });

  it("lists what is for sale and how many sellers are online", async () => {
    const response = await fetch(`${gw.baseUrl}/v1/models`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { id: string; sellers: number; sellers_online: number }[];
    };
    expect(body.data).toEqual([
      expect.objectContaining({ id: BROKEN_MODEL, sellers_online: 1 }),
      expect.objectContaining({
        cheapest_output_usdc_per_mtok: "0.020000",
        id: MODEL,
        sellers: 3,
        sellers_online: 3,
      }),
      expect.objectContaining({ id: "qwen2.5:7b", sellers_online: 0 }),
    ]);
  });

  it("answers 404 for a model nobody sells", async () => {
    const response = await chat(gw, { messages: MESSAGES, model: "gpt-9" });
    expect(response.status).toBe(404);
  });

  it("answers 503 when every seller of the model is offline", async () => {
    const response = await chat(gw, {
      messages: MESSAGES,
      model: "qwen2.5:7b",
    });
    expect(response.status).toBe(503);
  });

  it("quotes the online sellers cheapest first, paid to each seller's Hedera account", async () => {
    const response = await chat(gw, {
      max_tokens: 100,
      messages: MESSAGES,
      model: MODEL,
    });
    expect(response.status).toBe(402);
    const terms = termsOf(response);
    // The cheapest seller has no Hedera account behind their wallet, so is left out.
    expect(terms.map((t) => [t.payTo, t.amount])).toEqual([
      [CHEAP_ACCOUNT, expectedPrice(CHEAP, 100).toString()],
      [DEAR_ACCOUNT, expectedPrice(DEAR, 100).toString()],
    ]);
    expect(terms[0]).toEqual({
      amount: expectedPrice(CHEAP, 100).toString(),
      asset: HEDERA_TESTNET.assetAddress,
      extra: { feePayer: FAKE_HEDERA_FEE_PAYER },
      maxTimeoutSeconds: 300,
      network: "hedera:testnet",
      payTo: CHEAP_ACCOUNT,
      scheme: "exact",
    });
    expect(gw.facilitator.calls.settle).toBe(0);
  });

  it("settles the payment, forwards with the paid-for cap and records the purchase", async () => {
    const quoted = await chat(gw, {
      max_tokens: 100,
      messages: MESSAGES,
      model: MODEL,
      stream: true,
    });
    const [cheapest] = termsOf(quoted);
    if (cheapest === undefined) {
      throw new Error("no terms");
    }
    const response = await chat(
      gw,
      { max_tokens: 100, messages: MESSAGES, model: MODEL, stream: true },
      { "payment-signature": payFor(cheapest, "nonce-paid-1") }
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("payment-response")).not.toBeNull();
    expect(response.headers.get("x-rentanllm-listing")).toBe("l_cheap");
    const text = await response.text();
    expect(text).toContain("Hello");
    expect(text).toContain(" world");

    const forwarded = cheap.received.find((m) => m._tag === "ProxyRequest");
    expect(forwarded).toMatchObject({
      path: "/v1/chat/completions",
      provider: "ollama",
    });
    if (forwarded?._tag !== "ProxyRequest") {
      throw new Error("no request reached the cheap node");
    }
    expect(JSON.parse(forwarded.body)).toMatchObject({ max_tokens: 100 });
    expect(forwarded.headers["payment-signature"]).toBeUndefined();

    await waitUntil(() => gw.state.paid.length === 1);
    const [paid] = gw.state.paid;
    expect(paid).toMatchObject({
      listingId: "l_cheap",
      network: "hedera:testnet",
      paidMicros: expectedPrice(CHEAP, 100),
      payTo: CHEAP_ACCOUNT,
      paymentTx: fakeTxHash("nonce-paid-1"),
      status: "ok",
      usage: expect.objectContaining({ inputTokens: 9, outputTokens: 2 }),
    });
    // 9 in at 0.1 + 2 out at 0.2 per million tokens rounds up to 2 micro-USDC.
    expect(paid?.usedMicros).toBe(2n);
  });

  it("enforces the default cap when the buyer sets none", async () => {
    const quoted = await chat(gw, { messages: MESSAGES, model: MODEL });
    const [cheapest] = termsOf(quoted);
    expect(cheapest?.amount).toBe(expectedPrice(CHEAP, 256).toString());
  });

  it("refuses a payment for a different amount and charges nothing", async () => {
    const quoted = await chat(gw, {
      max_tokens: 100,
      messages: MESSAGES,
      model: MODEL,
    });
    const [cheapest] = termsOf(quoted);
    if (cheapest === undefined) {
      throw new Error("no terms");
    }
    const settledBefore = gw.facilitator.calls.settle;
    const response = await chat(
      gw,
      { max_tokens: 2000, messages: MESSAGES, model: MODEL },
      { "payment-signature": payFor(cheapest, "nonce-wrong-amount") }
    );
    expect(response.status).toBe(402);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain("does not match any current offer");
    expect(gw.facilitator.calls.settle).toBe(settledBefore);
  });

  describe("buyer spending limits", () => {
    it("refuses a paused buyer before anything settles", async () => {
      const result = await payUnder(
        gw,
        { ...NO_LIMITS, paused: true },
        "n-paused"
      );
      expect(result.status).toBe(402);
      expect(result.text).toContain("paused all payments");
      expect(result.settled).toBe(0);
    });

    it("refuses a seller that is not on the buyer's allowlist", async () => {
      const result = await payUnder(
        gw,
        { ...NO_LIMITS, allowedSellers: [DEAR_ACCOUNT] },
        "n-allowlist"
      );
      expect(result.status).toBe(402);
      expect(result.text).toContain(`seller ${CHEAP_ACCOUNT} is not on`);
      expect(result.settled).toBe(0);
    });

    it("refuses a payment above the buyer's per-request limit", async () => {
      const result = await payUnder(
        gw,
        { ...NO_LIMITS, maxPerRequestMicros: 1n },
        "n-per-request"
      );
      expect(result.status).toBe(402);
      expect(result.text).toContain("limit per request");
      expect(result.settled).toBe(0);
    });

    it("pays inside every limit, then stops at the 24-hour budget", async () => {
      const first = await payUnder(
        gw,
        { ...NO_LIMITS, allowedSellers: [CHEAP_ACCOUNT] },
        "n-inside"
      );
      expect(first.status).toBe(200);
      expect(first.settled).toBe(1);
      // The purchase is recorded when the answer ends.
      await waitUntil(() => gw.state.paid.some((r) => r.payer === FAKE_PAYER));
      const spent = gw.state.paid
        .filter((r) => r.payer === FAKE_PAYER)
        .reduce((sum, r) => sum + r.paidMicros, 0n);
      const overBudget = await payUnder(
        gw,
        { ...NO_LIMITS, dailyBudgetMicros: spent + first.amount - 1n },
        "n-budget"
      );
      expect(overBudget.status).toBe(402);
      expect(overBudget.text).toContain("24-hour budget");
      expect(overBudget.settled).toBe(0);
      const spentToCheap = gw.state.paid
        .filter((r) => r.payer === FAKE_PAYER && r.payTo === CHEAP_ACCOUNT)
        .reduce((sum, r) => sum + r.paidMicros, 0n);
      const overSeller = await payUnder(
        gw,
        { ...NO_LIMITS, perSellerDailyMicros: spentToCheap },
        "n-seller"
      );
      expect(overSeller.status).toBe(402);
      expect(overSeller.text).toContain(`for seller ${CHEAP_ACCOUNT}`);
      expect(overSeller.settled).toBe(0);
    });
  });

  it("refuses a payment the facilitator rejects", async () => {
    const quoted = await chat(gw, {
      max_tokens: 100,
      messages: MESSAGES,
      model: MODEL,
    });
    const [cheapest] = termsOf(quoted);
    if (cheapest === undefined) {
      throw new Error("no terms");
    }
    const response = await chat(
      gw,
      { max_tokens: 100, messages: MESSAGES, model: MODEL },
      { "payment-signature": payFor(cheapest, "nonce-bad", "0xbad") }
    );
    expect(response.status).toBe(402);
    expect(
      gw.state.paid.some((p) => p.paymentTx === fakeTxHash("nonce-bad"))
    ).toBe(false);
  });

  it("charges nothing when the seller fails before answering", async () => {
    const request = { max_tokens: 50, messages: MESSAGES, model: BROKEN_MODEL };
    const [terms] = termsOf(await chat(gw, request));
    if (terms === undefined) {
      throw new Error("no terms");
    }
    const response = await chat(gw, request, {
      "payment-signature": payFor(terms, "nonce-broken"),
    });
    expect(response.status).toBe(502);
    expect(response.headers.get("payment-response")).toBeNull();
    expect(response.headers.get("x-rentanllm-paid-usdc")).toBeNull();
    expect(await response.text()).toContain("Nothing was charged");
    // Give a stray recording time to land, then check none did.
    await sleep(200);
    expect(
      gw.state.paid.some((p) => p.paymentTx === fakeTxHash("nonce-broken"))
    ).toBe(false);
  });

  it("rejects a max_tokens above the market ceiling before quoting", async () => {
    const response = await chat(gw, {
      max_tokens: 10_000,
      messages: MESSAGES,
      model: MODEL,
    });
    expect(response.status).toBe(400);
  });
});
