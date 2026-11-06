/** Stub API payloads for the e2e run, in the contract's JSON encoding (micros as strings). */

const SELLER_WALLET = "0x1111111111111111111111111111111111111111";
const LISTING_ID = "11110000-0000-4000-8000-000000000001";

export const MODEL = "llama3.1:8b";

export const marketOffers = () => [
  {
    agent: null,
    listingId: LISTING_ID,
    maxConcurrency: 2,
    models: [MODEL],
    nodeId: "33330000-0000-4000-8000-000000000003",
    nodeStatus: "online",
    priceInPerMtokUsdc: "200000",
    priceOutPerMtokUsdc: "600000",
    provider: "ollama",
    reputation: {
      requests24h: 3,
      successPct: 100,
      ttfbMs: 412,
      uptimePct: 99.5,
    },
    sellerWallet: SELLER_WALLET,
  },
];

export const paidRequests = () => [
  {
    createdAt: new Date(0).toISOString(),
    httpStatus: 200,
    inputTokens: 18,
    latencyMs: 940,
    listingId: LISTING_ID,
    maxTokens: 256,
    model: MODEL,
    network: "hedera:testnet",
    outputTokens: 64,
    paidUsdc: "157",
    payTo: "0.0.4242",
    payer: "0.0.5151",
    paymentTx: "0.0.5151@1.000000000",
    requestId: "req_e2e_0001",
    status: "ok",
    usedUsdc: "42",
  },
];
