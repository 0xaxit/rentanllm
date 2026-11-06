import { InvalidRequest } from "@rentanllm/api-contract";
import type {
  MarketOffer,
  OwnerSales,
  PaidRequest,
} from "@rentanllm/api-contract";
import { Db } from "@rentanllm/db";
import {
  listings,
  nodes,
  paidRequests,
  providerAccounts,
  users,
} from "@rentanllm/db/schema";
import {
  and,
  asc,
  desc,
  eq,
  isNotNull,
  gte,
  ne,
  notInArray,
  sql,
} from "drizzle-orm";
import { Effect } from "effect";

import { dieOnDbError } from "../db-errors";

const HOUR_MS = 3_600_000;

/**
 * Live open-model listings sold pay-per-request: what the gateway's market route quotes
 * from. Subscription plans are never sold here.
 */
export const marketOffers = Effect.fn("market.offers")(function* offersGen() {
  const db = yield* Db;
  const rows = yield* db
    .select({
      listing: listings,
      nodeId: nodes.id,
      nodeStatus: nodes.status,
      provider: providerAccounts.provider,
      sellerWallet: users.walletAddress,
    })
    .from(listings)
    .innerJoin(
      providerAccounts,
      eq(providerAccounts.id, listings.providerAccountId)
    )
    .innerJoin(nodes, eq(nodes.id, providerAccounts.nodeId))
    .innerJoin(users, eq(users.id, nodes.ownerId))
    .where(
      and(
        eq(listings.status, "live"),
        ne(nodes.status, "disabled"),
        notInArray(providerAccounts.status, ["banned", "revoked"]),
        eq(providerAccounts.provider, "ollama"),
        isNotNull(users.walletAddress)
      )
    )
    .orderBy(asc(listings.priceOutPerMtokUsdc), asc(listings.id));
  return rows.flatMap(
    ({ listing, nodeId, nodeStatus, provider, sellerWallet }) =>
      sellerWallet === null
        ? []
        : [
            {
              listingId: listing.id,
              maxConcurrency: listing.maxConcurrency,
              models: listing.models,
              nodeId,
              nodeStatus,
              priceInPerMtokUsdc: listing.priceInPerMtokUsdc,
              priceOutPerMtokUsdc: listing.priceOutPerMtokUsdc,
              provider,
              sellerWallet,
            } satisfies MarketOffer,
          ]
  );
}, dieOnDbError);

type PaidRow = typeof paidRequests.$inferSelect;

export const toPaidRequest = (row: PaidRow): PaidRequest => ({
  auditSequence: row.auditSequence,
  createdAt: row.createdAt,
  httpStatus: row.httpStatus,
  inputTokens: row.inputTokens,
  latencyMs: row.latencyMs,
  listingId: row.listingId,
  maxTokens: row.maxTokens,
  model: row.model,
  network: row.network,
  outputTokens: row.outputTokens,
  paidUsdc: row.paidUsdcMicros,
  payTo: row.payTo,
  payer: row.payer,
  paymentTx: row.paymentTx,
  requestId: row.requestId,
  status: row.status,
  usedUsdc: row.usedUsdcMicros,
});

const DEFAULT_PAID_LIMIT = 25;
const MAX_PAID_LIMIT = 100;

/** The latest paid market requests, newest first. Public, like their payments. */
export const recentPaidRequests = Effect.fn("market.paidRequests")(
  function* paidRequestsGen(query: { readonly limit?: number }) {
    const limit = query.limit ?? DEFAULT_PAID_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAID_LIMIT) {
      return yield* new InvalidRequest({
        message: `limit must be an integer from 1 to ${MAX_PAID_LIMIT}`,
      });
    }
    const db = yield* Db;
    const rows = yield* db
      .select()
      .from(paidRequests)
      .orderBy(desc(paidRequests.createdAt), desc(paidRequests.id))
      .limit(limit);
    return rows.map(toPaidRequest);
  },
  dieOnDbError
);

const DAY_MS = 24 * HOUR_MS;
const RECENT_SALES = 50;

/** Requests, tokens and USDC over the owner's paid requests matching `where`. */
const salesTotals = Effect.fn("market.salesTotals")(function* salesTotalsGen(
  ownerId: string,
  since: Date | null
) {
  const db = yield* Db;
  const [row] = yield* db
    .select({
      inputTokens: sql<string>`coalesce(sum(${paidRequests.inputTokens}), 0)::text`,
      outputTokens: sql<string>`coalesce(sum(${paidRequests.outputTokens}), 0)::text`,
      paid: sql<string>`coalesce(sum(${paidRequests.paidUsdcMicros}), 0)::text`,
      requests: sql<string>`count(*)::text`,
    })
    .from(paidRequests)
    .where(
      since === null
        ? eq(paidRequests.ownerId, ownerId)
        : and(
            eq(paidRequests.ownerId, ownerId),
            gte(paidRequests.createdAt, since)
          )
    );
  return {
    inputTokens: Number(row?.inputTokens ?? 0),
    outputTokens: Number(row?.outputTokens ?? 0),
    paidUsdc: BigInt(row?.paid ?? 0),
    requests: Number(row?.requests ?? 0),
  };
});

/** What the owner's listings have sold on the market. */
export const ownerSales = Effect.fn("market.ownerSales")(
  function* ownerSalesGen(ownerId: string, now: Date) {
    const db = yield* Db;
    const [lifetime, last24h, recent] = yield* Effect.all(
      [
        salesTotals(ownerId, null),
        salesTotals(ownerId, new Date(now.getTime() - DAY_MS)),
        db
          .select()
          .from(paidRequests)
          .where(eq(paidRequests.ownerId, ownerId))
          .orderBy(desc(paidRequests.createdAt), desc(paidRequests.id))
          .limit(RECENT_SALES),
      ],
      { concurrency: "unbounded" }
    );
    return {
      last24h,
      lifetime,
      recent: recent.map(toPaidRequest),
    } satisfies OwnerSales;
  },
  dieOnDbError
);
