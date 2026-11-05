import { describe, expect, it } from "vitest";

import { API_PRICE_SEED } from "../src/index";

describe("API_PRICE_SEED", () => {
  it("has one row per provider and model", () => {
    const keys = API_PRICE_SEED.map((row) => `${row.provider}:${row.model}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(API_PRICE_SEED.length).toBeGreaterThan(0);
  });

  it("stores positive list prices", () => {
    for (const row of API_PRICE_SEED) {
      expect(row.inputPerMtokUsdc > 0n).toBe(true);
      expect(row.outputPerMtokUsdc > 0n).toBe(true);
      expect(row.cacheReadPerMtokUsdc > 0n).toBe(true);
      expect(row.sourceUrl.startsWith("https://")).toBe(true);
    }
  });
});
