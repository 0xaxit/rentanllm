/**
 * Node uptime from tunnel sessions (`node_sessions`, written by the gateway).
 *
 * A session that is still open counts up to now while the node is online. If
 * the node is not online (the gateway restarted, or the scheduler marked it
 * stale), the open session ends at its last heartbeat plus the stale window.
 * Time before the node's first recorded session is not tracked, so a new node
 * is not penalised for the hours before it ever connected.
 */

export interface SessionSpan {
  readonly connectedAt: Date;
  readonly disconnectedAt: Date | null;
}

export interface UptimeNode {
  readonly lastHeartbeatAt: Date | null;
  readonly status: string;
}

export interface Interval {
  readonly from: Date;
  readonly to: Date;
}

export interface UptimeWindow {
  /** Online time inside the window. */
  readonly onlineMs: number;
  /** Tracked time inside the window (from the first session, at most the window). */
  readonly trackedMs: number;
}

export interface Uptime {
  readonly asOf: Date;
  readonly currentSessionSince: Date | null;
  readonly last24h: UptimeWindow;
  readonly last7d: UptimeWindow;
  /** Merged online intervals inside the last 24 hours, oldest first. */
  readonly timeline24h: readonly Interval[];
  readonly trackedSince: Date | null;
}

const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
export const WEEK_MS = 7 * DAY_MS;

const sessionEnd = (
  session: SessionSpan,
  node: UptimeNode,
  now: Date,
  staleMs: number
): number => {
  if (session.disconnectedAt !== null) {
    return session.disconnectedAt.getTime();
  }
  if (node.status === "online") {
    return now.getTime();
  }
  const start = session.connectedAt.getTime();
  const lastSeen = Math.max(start, node.lastHeartbeatAt?.getTime() ?? start);
  return Math.min(now.getTime(), lastSeen + staleMs);
};

/** Sorts and merges overlapping [from, to) intervals given in ms. */
const merge = (spans: readonly (readonly [number, number])[]) => {
  const sorted = spans
    .filter(([from, to]) => to > from)
    .toSorted((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [from, to] of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && from <= last[1]) {
      last[1] = Math.max(last[1], to);
    } else {
      merged.push([from, to]);
    }
  }
  return merged;
};

const clip = (
  spans: readonly (readonly [number, number])[],
  from: number,
  to: number
) => {
  const clipped: (readonly [number, number])[] = [];
  for (const [a, b] of spans) {
    const start = Math.max(a, from);
    const end = Math.min(b, to);
    if (end > start) {
      clipped.push([start, end]);
    }
  }
  return clipped;
};

const total = (spans: readonly (readonly [number, number])[]) =>
  spans.reduce((sum, [a, b]) => sum + (b - a), 0);

export const computeUptime = (input: {
  readonly firstConnectedAt: Date | null;
  readonly node: UptimeNode;
  readonly now: Date;
  /** Sessions overlapping the last 7 days. */
  readonly sessions: readonly SessionSpan[];
  readonly staleMs: number;
}): Uptime => {
  const { firstConnectedAt, node, now, sessions, staleMs } = input;
  const nowMs = now.getTime();
  const online = merge(
    sessions.map(
      (s) =>
        [s.connectedAt.getTime(), sessionEnd(s, node, now, staleMs)] as const
    )
  );
  const window = (spanMs: number): UptimeWindow => {
    if (firstConnectedAt === null) {
      return { onlineMs: 0, trackedMs: 0 };
    }
    const from = Math.max(nowMs - spanMs, firstConnectedAt.getTime());
    return {
      onlineMs: total(clip(online, from, nowMs)),
      trackedMs: Math.max(0, nowMs - from),
    };
  };
  const open = sessions.find(
    (s) => s.disconnectedAt === null && node.status === "online"
  );
  return {
    asOf: now,
    currentSessionSince: open?.connectedAt ?? null,
    last24h: window(DAY_MS),
    last7d: window(WEEK_MS),
    timeline24h: clip(online, nowMs - DAY_MS, nowMs).map(([from, to]) => ({
      from: new Date(from),
      to: new Date(to),
    })),
    trackedSince: firstConnectedAt,
  };
};
