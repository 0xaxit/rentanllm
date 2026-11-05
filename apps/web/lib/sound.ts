/**
 * Interaction sounds (Cuelume, synthesized with Web Audio; no audio files).
 *
 * Elements opt in with data-cuelume-* attributes, which <SoundBinder> wires up
 * once for the whole app. Outcomes (copied, paid, failed) are played from code
 * with `cue`. The on/off choice is ours to persist; Cuelume never stores it.
 */
import { play, setEnabled } from "cuelume";
import type { PlayOptions, SoundName } from "cuelume";

const STORAGE_KEY = "rentanllm.sound";

/** Sound is on unless this browser turned it off. */
export const readSoundEnabled = (): boolean => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
};

export const writeSoundEnabled = (enabled: boolean) => {
  setEnabled(enabled);
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
};

/** Plays a cue from code. A no-op on the server and while sound is off. */
export const cue = (name: SoundName, options?: PlayOptions) => {
  if (typeof window === "undefined") {
    return;
  }
  play(name, options);
};
