import {
  CUTOFF_SAFETY_MARGIN_PCT,
  METER_MAX_AGE_MS,
} from "@rentanllm/protocol";
import { describe, expect, it } from "vitest";

import { decideCutoff } from "../src/index";

const NOW = new Date(0);
const fresh = (
  sessionUsedPct: number | null,
  weeklyUsedPct: number | null
) => ({
  readAt: NOW.toISOString(),
  sessionUsedPct,
  weeklyUsedPct,
});
const DEFAULTS = {};
const SESSION_LINE = 90 - CUTOFF_SAFETY_MARGIN_PCT;
const WEEKLY_LINE = 50 - CUTOFF_SAFETY_MARGIN_PCT;

describe("decideCutoff", () => {
  it("allows well below both lines", () => {
    const decision = decideCutoff(fresh(10, 10), DEFAULTS, NOW);
    expect(decision.action).toBe("allow");
    expect(decision.nearTheLine).toBe(false);
    expect(decision.sessionLinePct).toBe(SESSION_LINE);
    expect(decision.weeklyLinePct).toBe(WEEKLY_LINE);
  });

  it("pauses exactly at the session line (cut-off minus margin)", () => {
    expect(decideCutoff(fresh(SESSION_LINE, 0), DEFAULTS, NOW).action).toBe(
      "pause_session"
    );
  });

  it("allows just below the session line, flagged near the line", () => {
    const decision = decideCutoff(fresh(SESSION_LINE - 0.01, 0), DEFAULTS, NOW);
    expect(decision.action).toBe("allow");
    expect(decision.nearTheLine).toBe(true);
  });

  it("stops exactly at the weekly line", () => {
    expect(decideCutoff(fresh(0, WEEKLY_LINE), DEFAULTS, NOW).action).toBe(
      "stop_weekly"
    );
  });

  it("prefers stop_weekly when both lines are crossed", () => {
    expect(decideCutoff(fresh(99, 99), DEFAULTS, NOW).action).toBe(
      "stop_weekly"
    );
  });

  it("flags near the line within 10 points of the weekly line", () => {
    expect(
      decideCutoff(fresh(0, WEEKLY_LINE - 10), DEFAULTS, NOW).nearTheLine
    ).toBe(true);
    expect(
      decideCutoff(fresh(0, WEEKLY_LINE - 10.01), DEFAULTS, NOW).nearTheLine
    ).toBe(false);
  });

  it("uses owner-specific cut-offs", () => {
    const cutoffs = { sessionCutoffPct: 50, weeklyCutoffPct: 80 };
    expect(decideCutoff(fresh(47, 60), cutoffs, NOW).action).toBe(
      "pause_session"
    );
    expect(decideCutoff(fresh(46, 60), cutoffs, NOW).action).toBe("allow");
    expect(decideCutoff(fresh(0, 77), cutoffs, NOW).action).toBe("stop_weekly");
  });

  it("fails closed on a null meter", () => {
    expect(decideCutoff(fresh(null, 10), DEFAULTS, NOW).action).toBe(
      "stop_unreadable"
    );
    expect(decideCutoff(fresh(10, null), DEFAULTS, NOW).action).toBe(
      "stop_unreadable"
    );
    expect(decideCutoff(null, DEFAULTS, NOW).action).toBe("stop_unreadable");
  });

  it("fails closed on a non-finite meter", () => {
    expect(decideCutoff(fresh(Number.NaN, 10), DEFAULTS, NOW).action).toBe(
      "stop_unreadable"
    );
  });

  it("accepts a reading exactly METER_MAX_AGE_MS old and rejects one older", () => {
    const at = (ageMs: number) => ({
      readAt: new Date(NOW.getTime() - ageMs),
      sessionUsedPct: 1,
      weeklyUsedPct: 1,
    });
    expect(decideCutoff(at(METER_MAX_AGE_MS), DEFAULTS, NOW).action).toBe(
      "allow"
    );
    expect(decideCutoff(at(METER_MAX_AGE_MS + 1), DEFAULTS, NOW).action).toBe(
      "stop_unreadable"
    );
  });

  it("fails closed on an unparseable readAt", () => {
    const reading = {
      readAt: "yesterday-ish",
      sessionUsedPct: 1,
      weeklyUsedPct: 1,
    };
    expect(decideCutoff(reading, DEFAULTS, NOW).action).toBe("stop_unreadable");
  });
});
