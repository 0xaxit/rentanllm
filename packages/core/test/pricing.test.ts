import { describe, expect, it } from "vitest";

import {
  priceRatio,
  priceUsage,
  priceVerdict,
  suggestPrices,
  usdc,
} from "../src/index";

const API = {
  cacheReadPerMtok: usdc("0.20"),
  inputPerMtok: usdc("4"),
  outputPerMtok: usdc("20"),
};

const at = (inputPct: number, outputPct: number) => ({
  inputPerMtok: (API.inputPerMtok * BigInt(inputPct)) / 100n,
  outputPerMtok: (API.outputPerMtok * BigInt(outputPct)) / 100n,
});

describe("priceUsage", () => {
  it("prices cache writes at 1.25x input by default", () => {
    const prices = {
      cacheReadPerMtok: 0n,
      inputPerMtok: usdc("1"),
      outputPerMtok: 0n,
    };
    expect(
      priceUsage(
        {
          cacheReadTokens: 0,
          cacheWriteTokens: 500_000,
          inputTokens: 500_000,
          outputTokens: 0,
        },
        prices
      )
    ).toBe(usdc("1.125"));
  });

  it("rounds a fractional micro up", () => {
    const prices = {
      cacheReadPerMtok: 0n,
      inputPerMtok: usdc("1"),
      outputPerMtok: 0n,
    };
    expect(
      priceUsage(
        { cacheReadTokens: 0, inputTokens: 1, outputTokens: 0 },
        prices
      )
    ).toBe(1n);
  });

  it("rejects negative or fractional token counts", () => {
    expect(() =>
      priceUsage({ cacheReadTokens: 0, inputTokens: -1, outputTokens: 0 }, API)
    ).toThrow();
    expect(() =>
      priceUsage({ cacheReadTokens: 0.5, inputTokens: 0, outputTokens: 0 }, API)
    ).toThrow();
  });
});

describe("suggestPrices", () => {
  it("suggests 40% with a 30-50% band", () => {
    const suggestion = suggestPrices(API);
    expect(suggestion.suggested).toEqual({
      cacheReadPerMtok: usdc("0.08"),
      cacheWritePerMtok: usdc("2"),
      inputPerMtok: usdc("1.60"),
      outputPerMtok: usdc("8"),
    });
    expect(suggestion.min.inputPerMtok).toBe(usdc("1.20"));
    expect(suggestion.max.outputPerMtok).toBe(usdc("10"));
  });
});

describe("priceVerdict", () => {
  it.each([
    [29, 29, "underpriced"],
    [30, 30, "fair"],
    [40, 40, "fair"],
    [50, 50, "fair"],
    [51, 51, "pricey"],
    [99, 99, "pricey"],
    [100, 100, "above_api"],
    [250, 250, "above_api"],
    [20, 40, "fair"],
    [10, 49, "underpriced"],
  ] as const)("in %i%% / out %i%% is %s", (inputPct, outputPct, verdict) => {
    expect(priceVerdict(at(inputPct, outputPct), API)).toBe(verdict);
  });

  it("reports the averaged ratio", () => {
    expect(priceRatio(at(20, 40), API)).toBeCloseTo(0.3);
  });

  it("never caps the price", () => {
    expect(priceVerdict(at(100_000, 100_000), API)).toBe("above_api");
  });
});
