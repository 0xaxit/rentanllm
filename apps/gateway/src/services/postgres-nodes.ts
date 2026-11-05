/**
 * Postgres `NodeRegistry` (packages/db schema).
 *
 * - Tunnel auth: `nodes.node_token_hash` (SHA-256 hex of the node token, unique).
 *   Disabled nodes are refused. The node must send its `nodes.id` as NodeHello.nodeId.
 * - Availability sent to the node: open when any of its listings is live; cut-offs are
 *   the strictest across its listings.
 * - Meters: the latest reading per provider is kept in process (the node's tunnel ends
 *   at this process, so this is where requests for it are admitted) and written to
 *   provider_accounts, with nodes.last_heartbeat_at and status, at most once per
 *   `meterPersistIntervalMs` per node, off the frame-handling path.
 */
import type { Provider } from "@rentanllm/protocol";
import { Clock, Effect, Layer } from "effect";
import { SqlClient } from "effect/sql/SqlClient";

import { Settings } from "../config.ts";
import type { MeterReading, NodeAvailability } from "../domain.ts";
import { NODE_STALE_AFTER_MS } from "../tunnel/tunnel-hub.ts";
import { NodeRegistry } from "./node-registry.ts";
import { isUuid } from "./rows.ts";
import { StoreError } from "./store-error.ts";

interface AvailabilityRow {
  readonly open: boolean | null;
  readonly session_cutoff_pct: number | null;
  readonly weekly_cutoff_pct: number | null;
}

const parseInstant = (value: string | null): Date | null => {
  if (value === null) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const MS_PER_SECOND = 1000;

const storeError = (cause: unknown) =>
  new StoreError({ cause, store: "NodeRegistry" });

export const PostgresNodeRegistry = Layer.effect(NodeRegistry)(
  Effect.gen(function* makePostgresNodeRegistry() {
    const sql = yield* SqlClient;
    const { meterPersistIntervalMs } = yield* Settings;
    const scope = yield* Effect.scope;
    const meters = new Map<string, MeterReading>();
    const lastPersistedAtMs = new Map<string, number>();
    /** Last plan label persisted per `${nodeId}:${provider}`; a change skips the throttle. */
    const persistedPlans = new Map<string, string>();

    const availabilityOf = (nodeId: string) =>
      sql<AvailabilityRow>`
        select bool_or(l.status = 'live') as open,
               min(l.session_cutoff_pct)::int as session_cutoff_pct,
               min(l.weekly_cutoff_pct)::int as weekly_cutoff_pct
        from listings l
        join provider_accounts pa on pa.id = l.provider_account_id
        where pa.node_id = ${nodeId} and l.status <> 'draft'
      `.pipe(
        Effect.map((rows): NodeAvailability | null => {
          const [row] = rows;
          if (
            row === undefined ||
            row.session_cutoff_pct === null ||
            row.weekly_cutoff_pct === null
          ) {
            return null;
          }
          return {
            open: row.open === true,
            sessionCutoffPct: row.session_cutoff_pct,
            weeklyCutoffPct: row.weekly_cutoff_pct,
          };
        })
      );

    /**
     * The plan label the agent read from the provider's headers: kept on the node for the
     * Add plan sheet, and written over whatever tier the plan row has, so it can't be faked.
     */
    const recordPlan = (
      nodeId: string,
      provider: MeterReading["provider"],
      reading: MeterReading["meters"]
    ) =>
      Effect.gen(function* recordDetectedPlan() {
        const plan = reading.plan ?? "";
        const authKind = reading.source === "plan" ? "oauth" : "api_key";
        yield* sql`
          update nodes
          set detected_plans = detected_plans || jsonb_build_object(${provider}::text, ${plan}::text)
          where id = ${nodeId}
        `;
        yield* sql`
          update provider_accounts
          set plan_tier = ${plan}, auth_kind = ${authKind}
          where node_id = ${nodeId} and provider = ${provider}
        `;
        persistedPlans.set(`${nodeId}:${provider}`, plan);
      });

    const persist = (
      nodeId: string,
      readings: readonly MeterReading[],
      now: Date
    ) =>
      Effect.gen(function* persistMeters() {
        yield* sql`
          update nodes set last_heartbeat_at = ${now}, status = 'online'
          where id = ${nodeId} and status <> 'disabled'
        `;
        for (const reading of readings) {
          const m = reading.meters;
          yield* sql`
            update provider_accounts
            set session_used_pct = ${m.sessionUsedPct},
                weekly_used_pct = ${m.weeklyUsedPct},
                session_resets_at = ${parseInstant(m.sessionResetsAt)},
                weekly_resets_at = ${parseInstant(m.weeklyResetsAt)},
                usage_read_at = ${parseInstant(m.readAt) ?? reading.receivedAt}
            where node_id = ${nodeId} and provider = ${reading.provider}
          `;
          if (m.plan !== undefined) {
            yield* recordPlan(nodeId, reading.provider, m);
          }
        }
      }).pipe(
        Effect.matchCauseEffect({
          onFailure: (cause) =>
            Effect.logError("failed to persist node meters", cause),
          onSuccess: () => Effect.void,
        }),
        Effect.annotateLogs({ nodeId })
      );

    return {
      availability: (nodeId) =>
        isUuid(nodeId)
          ? availabilityOf(nodeId).pipe(Effect.mapError(storeError))
          : Effect.succeed(null),
      findByTokenHash: (tokenHash) =>
        Effect.gen(function* findNode() {
          const rows = yield* sql<{ readonly id: string }>`
            select id from nodes
            where node_token_hash = ${tokenHash.toLowerCase()}
              and status <> 'disabled'
            limit 1
          `;
          const [row] = rows;
          if (row === undefined) {
            return null;
          }
          return {
            availability: yield* availabilityOf(row.id),
            nodeId: row.id,
            tokenHash: tokenHash.toLowerCase(),
          };
        }).pipe(Effect.mapError(storeError)),
      latestMeters: (nodeId: string, provider: Provider) =>
        Effect.sync(() => meters.get(`${nodeId}:${provider}`) ?? null),
      recordConnect: (nodeId, agentVersion) =>
        Effect.gen(function* markConnected() {
          if (!isUuid(nodeId)) {
            return null;
          }
          const now = new Date(yield* Clock.currentTimeMillis);
          // Sessions still open here outlived a gateway restart. Close them at
          // the last sign of life plus the stale window, never later than now.
          yield* sql`
            update node_sessions s
            set end_reason = 'lost',
                disconnected_at = least(
                  ${now}::timestamptz,
                  greatest(s.connected_at, coalesce(n.last_heartbeat_at, s.connected_at))
                    + make_interval(secs => ${NODE_STALE_AFTER_MS / MS_PER_SECOND})
                )
            from nodes n
            where n.id = s.node_id and s.node_id = ${nodeId}
              and s.disconnected_at is null
          `;
          const [session] = yield* sql<{ readonly id: string }>`
            insert into node_sessions (node_id, connected_at)
            values (${nodeId}, ${now})
            returning id
          `;
          yield* sql`
            update nodes
            set status = 'online', connected_at = ${now},
                last_heartbeat_at = ${now}, version = ${agentVersion}
            where id = ${nodeId} and status <> 'disabled'
          `;
          return session?.id ?? null;
        }).pipe(sql.withTransaction, Effect.mapError(storeError)),
      recordDisconnect: (nodeId) =>
        Effect.gen(function* markOffline() {
          lastPersistedAtMs.delete(nodeId);
          if (!isUuid(nodeId)) {
            return;
          }
          yield* sql`
            update nodes set status = 'offline'
            where id = ${nodeId} and status = 'online'
          `;
        }).pipe(Effect.mapError(storeError)),
      recordMeters: (nodeId, readings) =>
        Effect.gen(function* recordNodeMeters() {
          for (const reading of readings) {
            meters.set(`${nodeId}:${reading.provider}`, reading);
          }
          const nowMs = yield* Clock.currentTimeMillis;
          const last = lastPersistedAtMs.get(nodeId);
          const planChanged = readings.some(
            ({ meters: m, provider }) =>
              m.plan !== undefined &&
              persistedPlans.get(`${nodeId}:${provider}`) !== m.plan
          );
          if (
            !isUuid(nodeId) ||
            (!planChanged &&
              last !== undefined &&
              nowMs - last < meterPersistIntervalMs)
          ) {
            return;
          }
          lastPersistedAtMs.set(nodeId, nowMs);
          yield* persist(nodeId, readings, new Date(nowMs)).pipe(
            Effect.forkIn(scope)
          );
        }),
      recordRegion: (nodeId, region) =>
        Effect.gen(function* setRegion() {
          if (!isUuid(nodeId)) {
            return;
          }
          yield* sql`update nodes set region = ${region} where id = ${nodeId}`;
        }).pipe(Effect.mapError(storeError)),
      recordSessionEnd: (sessionId, reason) =>
        Effect.gen(function* endSession() {
          const now = new Date(yield* Clock.currentTimeMillis);
          yield* sql`
            update node_sessions
            set disconnected_at = ${now}, end_reason = ${reason}
            where id = ${sessionId} and disconnected_at is null
          `;
        }).pipe(Effect.mapError(storeError)),
    };
  })
);
