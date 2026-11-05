/** Supply cut-off presets and copy. Defaults match the API: 90% session, 50% weekly. */

export const DEFAULT_SESSION_CUTOFF = 90;
export const DEFAULT_WEEKLY_CUTOFF = 50;
export const MIN_CUTOFF = 10;
export const MAX_CUTOFF = 100;
export const CUTOFF_STEP = 5;
/** New requests stop a little before the cut-off so in-flight ones can land. */
export const STOP_MARGIN = 3;

export type CutoffPresetId = "cautious" | "balanced" | "max";

export interface CutoffPreset {
  readonly id: CutoffPresetId;
  readonly label: string;
  readonly session: number;
  readonly weekly: number;
}

export const CUTOFF_PRESETS: readonly CutoffPreset[] = [
  { id: "cautious", label: "CAUTIOUS", session: 70, weekly: 35 },
  {
    id: "balanced",
    label: "BALANCED",
    session: DEFAULT_SESSION_CUTOFF,
    weekly: DEFAULT_WEEKLY_CUTOFF,
  },
  { id: "max", label: "MAX EARN", session: 95, weekly: 75 },
];

export const presetFor = (
  session: number,
  weekly: number
): CutoffPresetId | null =>
  CUTOFF_PRESETS.find((p) => p.session === session && p.weekly === weekly)
    ?.id ?? null;

export const stopAt = (cutoff: number): number =>
  Math.max(0, cutoff - STOP_MARGIN);

export const weeklyKeepCopy = (weekly: number): string => {
  const kept = MAX_CUTOFF - weekly;
  if (kept === 50) {
    return "at least half your week stays yours";
  }
  if (kept === 0) {
    return "renters can use your whole week";
  }
  return `at least ${kept}% of your week stays yours`;
};

const BALANCED: CutoffPreset = {
  id: "balanced",
  label: "BALANCED",
  session: DEFAULT_SESSION_CUTOFF,
  weekly: DEFAULT_WEEKLY_CUTOFF,
};

export const presetById = (id: CutoffPresetId): CutoffPreset =>
  CUTOFF_PRESETS.find((p) => p.id === id) ?? BALANCED;
