import { describe, expect, it } from "vitest";

import type { BuyerPolicy } from "../src/domain.ts";
import { policyRefusal } from "../src/market/buyer-policy.ts";

const OPEN: BuyerPolicy = {
  allowedSellers: null,
  dailyBudgetMicros: null,
  maxPerRequestMicros: null,
  paused: false,
  perSellerDailyMicros: null,
};
const NOTHING_SPENT = { toSellerMicros: 0n, totalMicros: 0n };

describe("buyer policy", () => {
  it("allows anything when no limit is set", () => {
    expect(policyRefusal(OPEN, NOTHING_SPENT, "0.0.1", 10_000_000n)).toBeNull();
  });

  it("counts the payment itself against the 24-hour budget", () => {
    const policy = { ...OPEN, dailyBudgetMicros: 1000n };
    const spent = { toSellerMicros: 0n, totalMicros: 900n };
    expect(policyRefusal(policy, spent, "0.0.1", 100n)).toBeNull();
    expect(policyRefusal(policy, spent, "0.0.1", 101n)).toContain(
      "24-hour budget of 0.001000 USDC"
    );
  });

  it("limits each seller separately from the total", () => {
    const policy = { ...OPEN, perSellerDailyMicros: 500n };
    expect(
      policyRefusal(
        policy,
        { toSellerMicros: 450n, totalMicros: 5000n },
        "0.0.7",
        50n
      )
    ).toBeNull();
    expect(
      policyRefusal(
        policy,
        { toSellerMicros: 450n, totalMicros: 450n },
        "0.0.7",
        51n
      )
    ).toContain("for seller 0.0.7");
  });

  it("checks pause first, then the allowlist, then the per-request limit", () => {
    const strict = {
      ...OPEN,
      allowedSellers: ["0.0.2"],
      maxPerRequestMicros: 10n,
      paused: true,
    };
    expect(policyRefusal(strict, NOTHING_SPENT, "0.0.1", 99n)).toContain(
      "paused"
    );
    expect(
      policyRefusal({ ...strict, paused: false }, NOTHING_SPENT, "0.0.1", 99n)
    ).toContain("allowlist");
    expect(
      policyRefusal({ ...strict, paused: false }, NOTHING_SPENT, "0.0.2", 99n)
    ).toContain("limit per request");
  });
});
