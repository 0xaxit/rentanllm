/**
 * What the platform measures about a seller node over the last 24 hours: the share of time
 * its tunnel was up, the median time to first byte of its paid requests, and the share of
 * them that finished ok. Shown on the market and posted on chain as ERC-8004 feedback.
 */
import type { SellerReputation } from "@rentanllm/api-contract";
import { Db } from "@rentanllm/db";
import { nodes, paidRequests } from "@rentanllm/db/schema";
import { and, gte, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";

import { dieOnDbError } from "../db-errors";
import { uptimeOf } from "../services/owner";

const DAY_MS = 86_400_000;
const PERCENT = 100;
/** Two decimals, as the feedback is posted (value 9987, decimals 2 = 99.87%). */
const CENTI = 100;

const pct = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * PERCENT * CENTI) / CENTI : null;

/** Reputation per node id; every id asked for gets an entry. */
export const nodeReputation = Effect.fn("reputation.nodes")(
  function* nodeReputationGen(
    nodeIds: readonly string[],
    now: Date,
    staleMs: number
  ) {
    const result = new Map<string, SellerReputation>();
    if (nodeIds.length === 0) {
      return result;
    }
    const db = yield* Db;
    const since = new Date(now.getTime() - DAY_MS);
    const [requestRows, nodeRows] = yield* Effect.all(
      [
        db
          .select({
            nodeId: paidRequests.nodeId,
            ok: sql<string>`count(*) filter (where ${paidRequests.status} = 'ok')::text`,
            requests: sql<string>`count(*)::text`,
            ttfbMs: sql<
              string | null
            >`(percentile_cont(0.5) within group (order by ${paidRequests.ttfbMs}))::text`,
          })
          .from(paidRequests)
          .where(
            and(
              inArray(paidRequests.nodeId, [...nodeIds]),
              gte(paidRequests.createdAt, since)
            )
          )
          .groupBy(paidRequests.nodeId),
        db
          .select()
          .from(nodes)
          .where(inArray(nodes.id, [...nodeIds])),
      ],
      { concurrency: "unbounded" }
    );
    const uptimes = yield* Effect.forEach(
      nodeRows,
      (node) =>
        Effect.map(uptimeOf(node, now, staleMs), (uptime) => ({
          nodeId: node.id,
          window: uptime.last24h,
        })),
      { concurrency: 4 }
    );
    const byNode = new Map(requestRows.map((row) => [row.nodeId, row]));
    const uptimeByNode = new Map(uptimes.map((u) => [u.nodeId, u.window]));
    for (const nodeId of nodeIds) {
      const row = byNode.get(nodeId);
      const requests = Number(row?.requests ?? 0);
      const window = uptimeByNode.get(nodeId);
      result.set(nodeId, {
        requests24h: requests,
        successPct: pct(Number(row?.ok ?? 0), requests),
        ttfbMs:
          row?.ttfbMs === null || row?.ttfbMs === undefined
            ? null
            : Math.round(Number(row.ttfbMs)),
        uptimePct:
          window === undefined ? null : pct(window.onlineMs, window.trackedMs),
      });
    }
    return result;
  },
  dieOnDbError
);
