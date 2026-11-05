import { describe, expect, it } from "vitest";

import { computeUptime, DAY_MS } from "../src/services/uptime";

const MIN = 60_000;
const HOUR = 60 * MIN;
const now = new Date(0);
const ago = (ms: number) => new Date(now.getTime() - ms);
const staleMs = 45_000;

describe("computeUptime", () => {
  it("has no data before the first session", () => {
    const uptime = computeUptime({
      firstConnectedAt: null,
      node: { lastHeartbeatAt: null, status: "offline" },
      now,
      sessions: [],
      staleMs,
    });
    expect(uptime.last24h).toEqual({ onlineMs: 0, trackedMs: 0 });
    expect(uptime.currentSessionSince).toBeNull();
    expect(uptime.timeline24h).toEqual([]);
  });

  it("tracks only from the first session and counts an open session to now", () => {
    const uptime = computeUptime({
      firstConnectedAt: ago(4 * HOUR),
      node: { lastHeartbeatAt: ago(MIN), status: "online" },
      now,
      sessions: [
        { connectedAt: ago(4 * HOUR), disconnectedAt: ago(3 * HOUR) },
        { connectedAt: ago(2 * HOUR), disconnectedAt: null },
      ],
      staleMs,
    });
    expect(uptime.last24h).toEqual({ onlineMs: 3 * HOUR, trackedMs: 4 * HOUR });
    expect(uptime.last7d.onlineMs).toBe(3 * HOUR);
    expect(uptime.currentSessionSince).toEqual(ago(2 * HOUR));
    expect(uptime.timeline24h).toHaveLength(2);
  });

  it("ends an open session at the last heartbeat plus the stale window when offline", () => {
    const uptime = computeUptime({
      firstConnectedAt: ago(10 * HOUR),
      node: { lastHeartbeatAt: ago(6 * HOUR), status: "offline" },
      now,
      sessions: [{ connectedAt: ago(10 * HOUR), disconnectedAt: null }],
      staleMs,
    });
    expect(uptime.last24h.onlineMs).toBe(4 * HOUR + staleMs);
    expect(uptime.currentSessionSince).toBeNull();
  });

  it("merges overlapping sessions and clips to the window", () => {
    const uptime = computeUptime({
      firstConnectedAt: ago(30 * HOUR),
      node: { lastHeartbeatAt: ago(HOUR), status: "offline" },
      now,
      sessions: [
        { connectedAt: ago(26 * HOUR), disconnectedAt: ago(20 * HOUR) },
        { connectedAt: ago(21 * HOUR), disconnectedAt: ago(19 * HOUR) },
      ],
      staleMs,
    });
    expect(uptime.last24h).toEqual({ onlineMs: 5 * HOUR, trackedMs: DAY_MS });
    expect(uptime.last7d.onlineMs).toBe(7 * HOUR);
    expect(uptime.timeline24h).toEqual([
      { from: ago(DAY_MS), to: ago(19 * HOUR) },
    ]);
  });
});
