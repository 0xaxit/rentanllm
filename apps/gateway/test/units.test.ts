import { priceUsage } from "@rentanllm/core";
import { describe, expect, it } from "vitest";

import { forwardableRequestHeaders } from "../src/headers.ts";
import { isLargeMismatch, makeSseTokenCounter } from "../src/token-estimate.ts";

describe("pricing (@rentanllm/core priceUsage)", () => {
  it("prices per million tokens and rounds up to a whole micro", () => {
    expect(
      priceUsage(
        { cacheReadTokens: 1, inputTokens: 0, outputTokens: 0 },
        {
          cacheReadPerMtok: 300_000n,
          inputPerMtok: 3_000_000n,
          outputPerMtok: 15_000_000n,
        }
      )
    ).toBe(1n);
  });
});

describe("token estimate", () => {
  it("counts generated text across chunk boundaries", () => {
    const counter = makeSseTokenCounter();
    const event = `event: content_block_delta\ndata: ${JSON.stringify({
      delta: { text: "abcdefgh", type: "text_delta" },
      type: "content_block_delta",
    })}\n\n`;
    for (const part of [event.slice(0, 20), event.slice(20), event]) {
      counter.feed(part);
    }
    expect(counter.estimate()).toBe(4);
  });

  it("flags only large mismatches", () => {
    expect(isLargeMismatch(1000, 900)).toBe(false);
    expect(isLargeMismatch(1000, 200)).toBe(true);
    expect(isLargeMismatch(3, 40)).toBe(false);
  });
});

describe("forwardableRequestHeaders", () => {
  it("strips credentials, hop-by-hop and connection-listed headers", () => {
    expect(
      forwardableRequestHeaders({
        "anthropic-beta": "x",
        authorization: "Bearer k",
        connection: "keep-alive, x-custom-hop",
        "content-type": "application/json",
        "keep-alive": "timeout=5",
        "x-api-key": "k",
        "x-custom-hop": "1",
      })
    ).toEqual({ "anthropic-beta": "x", "content-type": "application/json" });
  });
});
