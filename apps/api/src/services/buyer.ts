/**
 * Buyer spending limits. The gateway enforces them on every payment from the buyer's
 * Hedera account (after verify, before settle); here a signed-in buyer reads and saves
 * them, and sees what the account paid in the last 24 hours.
 *
 * The account is the one behind the buyer's sign-in wallet (its EVM alias), resolved on
 * the mirror node, so only the wallet's owner can set limits for it.
 */
import { InvalidRequest } from "@rentanllm/api-contract";
import type { BuyerOverview, BuyerPolicy } from "@rentanllm/api-contract";
import { Db } from "@rentanllm/db";
import { buyerPolicies, paidRequests, users } from "@rentanllm/db/schema";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { Effect } from "effect";

import { dieOnDbError } from "../db-errors";
import { HederaMirror } from "../hedera/mirror";
import { toPaidRequest } from "./market";
import { DAY_MS } from "./uptime";

const RECENT_PAYMENTS = 25;

type PolicyRow = typeof buyerPolicies.$inferSelect;

/** Biggest spend first. */
const byPaidDesc = (
  a: { readonly paidUsdc: bigint },
  b: { readonly paidUsdc: bigint }
): number => {
  if (a.paidUsdc === b.paidUsdc) {
    return 0;
  }
  return a.paidUsdc > b.paidUsdc ? -1 : 1;
};

const toPolicy = (row: PolicyRow): BuyerPolicy => ({
  allowedSellers: row.allowedSellers,
  dailyBudgetUsdc: row.dailyBudgetMicros,
  maxPerRequestUsdc: row.maxPerRequestMicros,
  paused: row.paused,
  perSellerDailyUsdc: row.perSellerDailyMicros,
});

/** The Hedera account behind the user's sign-in wallet; null when it has none. */
const accountOf = Effect.fn("buyer.accountOf")(function* accountOfGen(
  userId: string
) {
  const db = yield* Db;
  const [user] = yield* db
    .select({ wallet: users.walletAddress })
    .from(users)
    .where(eq(users.id, userId));
  if (user?.wallet === null || user?.wallet === undefined) {
    return null;
  }
  return yield* (yield* HederaMirror).accountFor(user.wallet);
}, dieOnDbError);

export const buyerOverview = Effect.fn("buyer.overview")(
  function* buyerOverviewGen(userId: string, now: Date) {
    const db = yield* Db;
    const account = yield* accountOf(userId);
    const [policyRow] = yield* db
      .select()
      .from(buyerPolicies)
      .where(eq(buyerPolicies.userId, userId));
    if (account === null) {
      return {
        account: null,
        bySeller: [],
        policy: policyRow === undefined ? null : toPolicy(policyRow),
        recent: [],
        spentLast24hUsdc: 0n,
      } satisfies BuyerOverview;
    }
    const since = new Date(now.getTime() - DAY_MS);
    const [bySeller, recent] = yield* Effect.all(
      [
        db
          .select({
            paidUsdc: sql<string>`coalesce(sum(${paidRequests.paidUsdcMicros}), 0)`,
            payTo: paidRequests.payTo,
            requests: sql<number>`count(*)::int`,
          })
          .from(paidRequests)
          .where(
            and(
              eq(paidRequests.payer, account),
              gt(paidRequests.createdAt, since)
            )
          )
          .groupBy(paidRequests.payTo),
        db
          .select()
          .from(paidRequests)
          .where(eq(paidRequests.payer, account))
          .orderBy(desc(paidRequests.createdAt), desc(paidRequests.id))
          .limit(RECENT_PAYMENTS),
      ],
      { concurrency: "unbounded" }
    );
    const sellers = bySeller
      .map((row) => ({
        paidUsdc: BigInt(row.paidUsdc),
        payTo: row.payTo,
        requests: row.requests,
      }))
      .toSorted(byPaidDesc);
    return {
      account,
      bySeller: sellers,
      policy: policyRow === undefined ? null : toPolicy(policyRow),
      recent: recent.map(toPaidRequest),
      spentLast24hUsdc: sellers.reduce((sum, row) => sum + row.paidUsdc, 0n),
    } satisfies BuyerOverview;
  },
  dieOnDbError
);

export const updateBuyerPolicy = Effect.fn("buyer.updatePolicy")(
  function* updateBuyerPolicyGen(
    userId: string,
    input: BuyerPolicy,
    now: Date
  ) {
    const db = yield* Db;
    const account = yield* accountOf(userId);
    if (account === null) {
      return yield* new InvalidRequest({
        message:
          "Your sign-in wallet has no Hedera account yet. Fund it once on Hedera testnet, then save your limits.",
      });
    }
    const values = {
      allowedSellers:
        input.allowedSellers === null
          ? null
          : [...new Set(input.allowedSellers)],
      dailyBudgetMicros: input.dailyBudgetUsdc,
      maxPerRequestMicros: input.maxPerRequestUsdc,
      paused: input.paused,
      payerAccount: account,
      perSellerDailyMicros: input.perSellerDailyUsdc,
      updatedAt: now,
    };
    const [row] = yield* db
      .insert(buyerPolicies)
      .values({ ...values, userId })
      .onConflictDoUpdate({ set: values, target: buyerPolicies.userId })
      .returning();
    if (row === undefined) {
      return yield* Effect.die(
        new Error("buyer policy upsert returned no row")
      );
    }
    yield* Effect.annotateCurrentSpan({ "buyer.account": account });
    return toPolicy(row);
  },
  dieOnDbError
);
