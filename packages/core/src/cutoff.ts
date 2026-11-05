import {
  CUTOFF_SAFETY_MARGIN_PCT,
  METER_MAX_AGE_MS,
} from "@rentanllm/protocol";

export const DEFAULT_SESSION_CUTOFF_PCT = 90;
export const DEFAULT_WEEKLY_CUTOFF_PCT = 50;
/** Within this many points of the enforced line, callers cap output length and run concurrency 1. */
export const NEAR_LINE_PCT = 10;

export interface MeterReading {
  /** When the meters were read. ISO string or Date. */
  readonly readAt: string | Date;
  readonly sessionUsedPct: number | null;
  readonly weeklyUsedPct: number | null;
}

export interface Cutoffs {
  readonly sessionCutoffPct?: number;
  readonly weeklyCutoffPct?: number;
}

export type CutoffAction =
  | "allow"
  | "pause_session"
  | "stop_weekly"
  | "stop_unreadable";

export interface CutoffDecision {
  readonly action: CutoffAction;
  /** True when allowed but a meter is within NEAR_LINE_PCT of its enforced line. */
  readonly nearTheLine: boolean;
  readonly reason: string;
  /** Lines actually enforced: owner cut-off minus the safety margin. */
  readonly sessionLinePct: number;
  readonly weeklyLinePct: number;
}

const isUsablePct = (value: number | null): value is number =>
  value !== null && Number.isFinite(value);

/**
 * Decides whether an owner's account may serve another request. Fails closed: a missing,
 * non-finite or stale reading stops renting. A meter at or above (cut-off - margin) blocks.
 * Weekly is checked before session because it is the stronger stop.
 */
export const decideCutoff = (
  reading: MeterReading | null,
  cutoffs: Cutoffs,
  now: Date
): CutoffDecision => {
  const sessionLinePct =
    (cutoffs.sessionCutoffPct ?? DEFAULT_SESSION_CUTOFF_PCT) -
    CUTOFF_SAFETY_MARGIN_PCT;
  const weeklyLinePct =
    (cutoffs.weeklyCutoffPct ?? DEFAULT_WEEKLY_CUTOFF_PCT) -
    CUTOFF_SAFETY_MARGIN_PCT;
  const decide = (
    action: CutoffAction,
    reason: string,
    nearTheLine = false
  ): CutoffDecision => ({
    action,
    nearTheLine,
    reason,
    sessionLinePct,
    weeklyLinePct,
  });

  if (reading === null) {
    return decide("stop_unreadable", "no meter reading");
  }
  const readAtMs = new Date(reading.readAt).getTime();
  if (Number.isNaN(readAtMs)) {
    return decide("stop_unreadable", "meter readAt is not a valid time");
  }
  const ageMs = now.getTime() - readAtMs;
  if (ageMs > METER_MAX_AGE_MS) {
    return decide("stop_unreadable", `meter reading is ${ageMs}ms old`);
  }
  const { sessionUsedPct, weeklyUsedPct } = reading;
  if (!(isUsablePct(sessionUsedPct) && isUsablePct(weeklyUsedPct))) {
    return decide("stop_unreadable", "a usage meter is missing");
  }
  if (weeklyUsedPct >= weeklyLinePct) {
    return decide(
      "stop_weekly",
      `weekly ${weeklyUsedPct}% >= line ${weeklyLinePct}%`
    );
  }
  if (sessionUsedPct >= sessionLinePct) {
    return decide(
      "pause_session",
      `session ${sessionUsedPct}% >= line ${sessionLinePct}%`
    );
  }
  const nearTheLine =
    weeklyUsedPct >= weeklyLinePct - NEAR_LINE_PCT ||
    sessionUsedPct >= sessionLinePct - NEAR_LINE_PCT;
  return decide("allow", "below both lines", nearTheLine);
};
