import { describe, expect, it } from "vitest";

import { purchaseText } from "../src/mcp/server";
import type { Purchase } from "../src/mcp/server";

const BASE: Purchase = {
  answer: "I am Llama.",
  max_tokens: 64,
  model: "llama3.1:8b",
  payment: {
    amount_usdc: "0.000014",
    from: "0.0.11333445",
    network: "hedera:testnet",
    to: "0.0.11331176",
    transaction: "0.0.9185802@1.2",
    url: "https://hashscan.io/testnet/transaction/0.0.9185802%401.2",
  },
  prompt: [{ content: "Which model are you?", role: "user" }],
  seller_error: null,
  tokens: { input: 15, output: 5 },
  truncated: false,
};

describe("buy_inference text result", () => {
  it("shows the exact prompt, the verbatim answer and one payment block", () => {
    expect(purchaseText(BASE)).toBe(
      [
        "MODEL",
        "llama3.1:8b",
        "",
        "PROMPT (user)",
        "Which model are you?",
        "",
        "ANSWER (verbatim)",
        "I am Llama.",
        "",
        "PAYMENT",
        "0.000014 USDC from 0.0.11333445 to 0.0.11331176 on hedera:testnet",
        "https://hashscan.io/testnet/transaction/0.0.9185802%401.2",
        "tokens: 15 in, 5 out",
      ].join("\n")
    );
  });

  it("says when the answer stopped at max_tokens", () => {
    expect(
      purchaseText({
        ...BASE,
        tokens: { input: 15, output: 64 },
        truncated: true,
      })
    ).toContain("ANSWER (verbatim, cut off at max_tokens 64)");
  });
});
