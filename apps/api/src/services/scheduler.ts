/**
 * Per-minute scheduler (cron -> GET /cron/tick): marks nodes offline whose heartbeat has
 * gone stale. A plain conditional UPDATE (`WHERE status = 'online'`), so a repeated or
 * concurrent run changes nothing twice.
 */
import { Db } from "@rentanllm/db";
import { nodes } from "@rentanllm/db/schema";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { Effect } from "effect";

import { ApiConfig } from "../config";
import { dieOnDbError } from "../db-errors";

export const markStaleNodesOffline = Effect.fn("scheduler.markStaleNodes")(
  function* markStaleNodesOfflineGen(now: Date) {
    const db = yield* Db;
    const config = yield* ApiConfig;
    const staleBefore = new Date(now.getTime() - config.nodeStaleMs);
    const rows = yield* db
      .update(nodes)
      .set({ status: "offline" })
      .where(
        and(
          eq(nodes.status, "online"),
          or(
            isNull(nodes.lastHeartbeatAt),
            lt(nodes.lastHeartbeatAt, staleBefore)
          )
        )
      )
      .returning({ id: nodes.id });
    return rows.length;
  }
);

/** One scheduler run. `now` is passed in so tests can pin the clock. */
export const runTick = Effect.fn("scheduler.tick")(function* runTickGen(
  now: Date
) {
  const result = { nodesMarkedOffline: yield* markStaleNodesOffline(now) };
  yield* Effect.annotateCurrentSpan(result);
  return result;
}, dieOnDbError);
