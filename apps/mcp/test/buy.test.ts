import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { PaymentPayload } from "@x402/core/types";
import { describe, expect, it } from "vitest";

import { approvalReason, buyInference } from "../src/buy.ts";
import type { BuyParts } from "../src/buy.ts";
import {
  ConfigError,
  formatUsdc,
  loadConfig,
  usdcToMicros,
} from "../src/config.ts";
import type { ChatRequest, Quote } from "../src/market.ts";
import { PayerError } from "../src/payer.ts";
import {
  appendSpend,
  capRefusal,
  readSpends,
  spentLastDay,
} from "../src/spend.ts";
import type { SpendEntry } from "../src/spend.ts";

const NOW = new Date(0);
const HOUR_MS = 3_600_000;
const CAPS = { maxPerDayMicros: 1_000_000n, maxPerRequestMicros: 50_000n };
const REQUEST: ChatRequest = {
  maxTokens: 256,
  messages: [{ content: "Hi", role: "user" }],
  model: "llama3.1:8b",
};

const quoteOf = (amount: bigint): Quote => ({
  paymentRequired: {
    accepts: [],
    resource: { description: "", mimeType: "application/json", url: "" },
    x402Version: 2,
  },
  terms: {
    amount: amount.toString(),
    asset: "0.0.429274",
    extra: { feePayer: "0.0.9185802" },
    maxTimeoutSeconds: 300,
    network: "hedera:testnet",
    payTo: "0.0.4242",
    scheme: "exact",
  },
});

const spend = (amountMicros: bigint, hoursAgo: number): SpendEntry => ({
  amountMicros,
  at: new Date(NOW.getTime() - hoursAgo * HOUR_MS),
  model: "llama3.1:8b",
  network: "hedera:testnet",
  payTo: "0.0.4242",
  requestId: null,
  tx: null,
});

/** Parts that record what ran, with a fixed quote and history. */
const fakeParts = (
  amount: bigint,
  history: readonly SpendEntry[] = [],
  approve: BuyParts["approve"] = () => Promise.resolve("key")
) => {
  const ran: string[] = [];
  const logged: SpendEntry[] = [];
  const parts: BuyParts = {
    approve: async (reason) => {
      ran.push(`approve: ${reason}`);
      return await approve(reason);
    },
    call: (payment) => {
      ran.push("call");
      expect(payment.x402Version).toBe(2);
      return Promise.resolve({
        content: "Hello",
        error: null,
        inputTokens: 9,
        listingId: "l1",
        outputTokens: 2,
        requestId: "req_1",
        tx: "0.0.777@1730000000.1",
      });
    },
    caps: CAPS,
    log: (entry) => {
      logged.push(entry);
    },
    now: () => NOW,
    quote: () => {
      ran.push("quote");
      return Promise.resolve(quoteOf(amount));
    },
    sign: (key, quote) => {
      ran.push(`sign with ${key}`);
      return Promise.resolve({
        accepted: quote.terms,
        payload: {},
        x402Version: 2,
      } as PaymentPayload);
    },
    spends: () => history,
  };
  return { logged, parts, ran };
};

describe("caps", () => {
  it("counts only the last 24 hours", () => {
    expect(
      spentLastDay([spend(300n, 1), spend(500n, 23), spend(900n, 25)], NOW)
    ).toBe(800n);
  });

  it("refuses above the caller's limit, the per-request cap and the daily cap", () => {
    expect(capRefusal(20_000n, CAPS, 0n, 10_000n)).toContain("you allowed");
    expect(capRefusal(60_000n, CAPS, 0n, null)).toContain("per-request cap");
    expect(capRefusal(40_000n, CAPS, 980_000n, null)).toContain("daily cap");
    expect(capRefusal(40_000n, CAPS, 900_000n, null)).toBeNull();
  });
});

describe("buying", () => {
  it("quotes, asks for approval, signs, calls and logs, in that order", async () => {
    const { logged, parts, ran } = fakeParts(751n);
    const result = await buyInference(parts, REQUEST, null);
    expect(ran).toEqual([
      "quote",
      `approve: ${approvalReason(quoteOf(751n), REQUEST, 0n, CAPS)}`,
      "sign with key",
      "call",
    ]);
    expect(result).toMatchObject({ kind: "paid", paidMicros: 751n });
    expect(logged).toEqual([
      expect.objectContaining({
        amountMicros: 751n,
        payTo: "0.0.4242",
        tx: "0.0.777@1730000000.1",
      }),
    ]);
  });

  it("names the amount, recipient and network in the approval prompt", () => {
    expect(approvalReason(quoteOf(751n), REQUEST, 20_000n, CAPS)).toBe(
      "pay 0.000751 USDC to 0.0.4242 on Hedera testnet for one llama3.1:8b answer of up to 256 tokens. Spent in the last 24h: 0.02 of 1 USDC."
    );
  });

  it("never asks for approval or signs when a cap refuses", async () => {
    const { logged, parts, ran } = fakeParts(60_000n);
    const result = await buyInference(parts, REQUEST, null);
    expect(result.kind).toBe("refused");
    expect(ran).toEqual(["quote"]);
    expect(logged).toEqual([]);
  });

  it("signs nothing when the person denies the payment", async () => {
    const { logged, parts, ran } = fakeParts(751n, [], () =>
      Promise.reject(
        new PayerError("not_approved", "the payment was not approved")
      )
    );
    await expect(buyInference(parts, REQUEST, null)).rejects.toThrow(
      "not approved"
    );
    expect(ran.filter((step) => !step.startsWith("approve"))).toEqual([
      "quote",
    ]);
    expect(logged).toEqual([]);
  });
});

describe("spend log", () => {
  it("round-trips entries and skips a torn last line", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rentanllm-mcp-"));
    appendSpend(dir, spend(751n, 0));
    appendSpend(dir, spend(20n, 2));
    appendFileSync(path.join(dir, "spend.jsonl"), '{"amountMicros":"9');
    expect(readSpends(dir).map((s) => s.amountMicros)).toEqual([751n, 20n]);
    expect(readSpends(path.join(dir, "missing"))).toEqual([]);
  });
});

describe("config", () => {
  it("parses USDC amounts exactly", () => {
    expect(usdcToMicros("0.05")).toBe(50_000n);
    expect(usdcToMicros("1")).toBe(1_000_000n);
    expect(formatUsdc(751n)).toBe("0.000751");
    expect(() => usdcToMicros("0.0000001")).toThrow(ConfigError);
  });

  it("needs a Hedera account to pay on Hedera", () => {
    expect(() =>
      loadConfig({
        RENTANLLM_MCP_APPROVAL: "none",
        RENTANLLM_MCP_PRIVATE_KEY: "k",
      })
    ).toThrow("RENTANLLM_MCP_ACCOUNT");
  });

  it("reads the payer key from a key file when approval is off", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rentanllm-key-"));
    const jsonFile = path.join(dir, "buyer.json");
    writeFileSync(jsonFile, JSON.stringify({ privateKeyHex: " 0xabc " }));
    const rawFile = path.join(dir, "raw.key");
    writeFileSync(rawFile, "0xdef\n");
    const base = {
      RENTANLLM_MCP_ACCOUNT: "0.0.1",
      RENTANLLM_MCP_APPROVAL: "none",
    };
    expect(
      loadConfig({ ...base, RENTANLLM_MCP_KEY_FILE: jsonFile }).insecureKey
    ).toBe("0xabc");
    expect(
      loadConfig({ ...base, RENTANLLM_MCP_KEY_FILE: rawFile }).insecureKey
    ).toBe("0xdef");
  });

  it("only turns approval off with an explicit development key", () => {
    expect(() =>
      loadConfig({
        RENTANLLM_MCP_ACCOUNT: "0.0.1",
        RENTANLLM_MCP_APPROVAL: "none",
      })
    ).toThrow("RENTANLLM_MCP_PRIVATE_KEY");
    const config = loadConfig({
      RENTANLLM_GATEWAY_URL: "https://gw.example/v1/",
      RENTANLLM_MCP_ACCOUNT: "0.0.1",
    });
    expect(config.approval).toBe("touchid");
    expect(config.gatewayUrl).toBe("https://gw.example");
    expect(config.insecureKey).toBeNull();
  });
});
