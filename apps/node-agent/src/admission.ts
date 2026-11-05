/**
 * The node's own fail-closed gate, applied to every new request regardless of what the gateway
 * decided. In-flight requests are never cut off mid-stream.
 */
import {
  CUTOFF_SAFETY_MARGIN_PCT,
  METER_MAX_AGE_MS,
} from "@rentanllm/protocol";
import type { ResponseError, UsageMeters } from "@rentanllm/protocol";

import type { Availability } from "./state.ts";

export interface Refusal {
  readonly code: (typeof ResponseError.Type)["code"];
  readonly message: string;
}

export interface AdmissionInput {
  readonly availability: Availability;
  readonly circuitOpenUntilMs: number;
  readonly meters: UsageMeters | null;
  readonly nowMs: number;
}

export const metersAreFresh = (
  meters: UsageMeters | null,
  nowMs: number
): meters is UsageMeters => {
  if (meters === null) {
    return false;
  }
  const readAt = Date.parse(meters.readAt);
  return !Number.isNaN(readAt) && nowMs - readAt <= METER_MAX_AGE_MS;
};

const overCutoff = (usedPct: number, cutoffPct: number): boolean =>
  usedPct >= cutoffPct - CUTOFF_SAFETY_MARGIN_PCT;

/**
 * Returns why a new request must be refused, or null to admit it.
 *
 * Rules: node must be open; the 429 circuit breaker must be closed; meters must be present,
 * fresher than METER_MAX_AGE_MS and have a session reading; every non-null meter must be below
 * its cut-off minus CUTOFF_SAFETY_MARGIN_PCT.
 */
export const evaluateAdmission = (input: AdmissionInput): Refusal | null => {
  const { availability, circuitOpenUntilMs, meters, nowMs } = input;
  if (!availability.open) {
    return { code: "node_closed", message: "node is closed" };
  }
  if (circuitOpenUntilMs > nowMs) {
    return {
      code: "provider_rate_limited",
      message: `provider rate limited; cooling off for ${Math.ceil((circuitOpenUntilMs - nowMs) / 1000)}s`,
    };
  }
  if (!metersAreFresh(meters, nowMs) || meters.sessionUsedPct === null) {
    return {
      code: "meters_unreadable",
      message: "usage meters are missing or stale",
    };
  }
  if (overCutoff(meters.sessionUsedPct, availability.sessionCutoffPct)) {
    return { code: "cutoff_reached", message: "session cut-off reached" };
  }
  if (
    meters.weeklyUsedPct !== null &&
    overCutoff(meters.weeklyUsedPct, availability.weeklyCutoffPct)
  ) {
    return { code: "cutoff_reached", message: "weekly cut-off reached" };
  }
  return null;
};
