/**
 * Buyer spending limits, checked after the facilitator verifies a payment and before it
 * settles, so a payment over a limit is refused and nothing moves. Pure: the route loads
 * the policy and the last 24 hours of spend, this decides.
 *
 * Spend counts payments already recorded in `paid_requests`, which are written when a
 * request finishes. Requests still running are not counted yet, so parallel requests can
 * go slightly over a budget.
 */
import { formatUsdc } from "@rentanllm/core";
import type { Micros } from "@rentanllm/core";

import type { BuyerPolicy, BuyerSpend } from "../domain.ts";

/** Why `policy` refuses paying `amount` to `payTo`, or null when it allows it. */
export const policyRefusal = (
  policy: BuyerPolicy,
  spend: BuyerSpend,
  payTo: string,
  amount: Micros
): string | null => {
  if (policy.paused) {
    return "this buyer has paused all payments";
  }
  if (
    policy.allowedSellers !== null &&
    !policy.allowedSellers.includes(payTo)
  ) {
    return `seller ${payTo} is not on this buyer's allowlist`;
  }
  if (
    policy.maxPerRequestMicros !== null &&
    amount > policy.maxPerRequestMicros
  ) {
    return `${formatUsdc(amount)} USDC is above this buyer's ${formatUsdc(policy.maxPerRequestMicros)} USDC limit per request`;
  }
  if (
    policy.dailyBudgetMicros !== null &&
    spend.totalMicros + amount > policy.dailyBudgetMicros
  ) {
    return `this buyer's 24-hour budget of ${formatUsdc(policy.dailyBudgetMicros)} USDC would be exceeded (${formatUsdc(spend.totalMicros)} USDC spent)`;
  }
  if (
    policy.perSellerDailyMicros !== null &&
    spend.toSellerMicros + amount > policy.perSellerDailyMicros
  ) {
    return `this buyer's 24-hour limit of ${formatUsdc(policy.perSellerDailyMicros)} USDC for seller ${payTo} would be exceeded (${formatUsdc(spend.toSellerMicros)} USDC paid to it)`;
  }
  return null;
};
