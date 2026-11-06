import { describe, expect, it } from "vitest";

import { HOLD_TTL_MS, HeldPayments, needsPerson } from "../src/approval.ts";
import { loadConfig } from "../src/config.ts";
import type { McpConfig } from "../src/config.ts";
import type { ChatRequest, Quote } from "../src/market.ts";

const REQUEST: ChatRequest = {
  maxTokens: 64,
  messages: [{ content: "Hi", role: "user" }],
  model: "llama3.1:8b",
};

const quoteOf = (amount: bigint, payTo = "0.0.4242"): Quote => ({
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
    payTo,
    scheme: "exact",
  },
});

const thresholdConfig = (extra: Record<string, string> = {}): McpConfig =>
  loadConfig({
    RENTANLLM_MCP_ACCOUNT: "0.0.1",
    RENTANLLM_MCP_APPROVAL: "threshold",
    RENTANLLM_MCP_PRIVATE_KEY: "k",
    ...extra,
  });

describe("approval threshold", () => {
  it("pays up to the threshold on its own and asks the person above it", () => {
    const config = thresholdConfig({
      RENTANLLM_MCP_AUTO_APPROVE_USDC: "0.001",
    });
    expect(config.autoApproveMicros).toBe(1000n);
    expect(needsPerson(config, 1000n)).toBe(false);
    expect(needsPerson(config, 1001n)).toBe(true);
  });

  it("defaults the threshold to 0.001 USDC and needs a key", () => {
    expect(thresholdConfig().autoApproveMicros).toBe(1000n);
    expect(() =>
      loadConfig({
        RENTANLLM_MCP_ACCOUNT: "0.0.1",
        RENTANLLM_MCP_APPROVAL: "threshold",
      })
    ).toThrow("RENTANLLM_MCP_APPROVAL=threshold needs");
    expect(() =>
      loadConfig({
        RENTANLLM_MCP_ACCOUNT: "0.0.1",
        RENTANLLM_MCP_APPROVAL: "yes",
      })
    ).toThrow("must be touchid, threshold, world or none");
  });

  it("never asks the person in the other modes", () => {
    const none = loadConfig({
      RENTANLLM_MCP_ACCOUNT: "0.0.1",
      RENTANLLM_MCP_APPROVAL: "none",
      RENTANLLM_MCP_PRIVATE_KEY: "k",
    });
    expect(needsPerson(none, 10_000_000n)).toBe(false);
  });
});

describe("held payments", () => {
  it("releases a held payment once, only for the exact amount and recipient", () => {
    const held = new HeldPayments();
    const payment = held.hold(REQUEST, quoteOf(5000n));
    expect(held.take(payment.id, 4999n, "0.0.4242")).toContain(
      "not 0.004999 USDC"
    );
    expect(held.take(payment.id, 5000n, "0.0.9999")).toContain("to 0.0.4242");
    const taken = held.take(payment.id, 5000n, "0.0.4242");
    expect(typeof taken === "string" ? taken : taken.request).toBe(REQUEST);
    expect(held.take(payment.id, 5000n, "0.0.4242")).toContain("no payment");
  });

  it("forgets held payments after the hold expires", () => {
    let now = new Date(0);
    const held = new HeldPayments(() => now);
    const payment = held.hold(REQUEST, quoteOf(5000n));
    now = new Date(HOLD_TTL_MS);
    expect(held.take(payment.id, 5000n, "0.0.4242")).toContain("no payment");
  });
});
