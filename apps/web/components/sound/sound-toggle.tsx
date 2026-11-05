"use client";

import { unlock } from "cuelume";
import { useSyncExternalStore } from "react";

import { cx } from "@/lib/cx";
import { readSoundEnabled, writeSoundEnabled } from "@/lib/sound";

import { PixelIcon } from "../app-shell/icons";

const listeners = new Set<() => void>();
const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
};
const serverSnapshot = () => true;

/** Speaker on / off switch; remembered in this browser. */
export const SoundToggle = ({ className }: { className?: string }) => {
  const enabled = useSyncExternalStore(
    subscribe,
    readSoundEnabled,
    serverSnapshot
  );
  const toggle = () => {
    const next = !enabled;
    writeSoundEnabled(next);
    for (const listener of listeners) {
      listener();
    }
    if (next) {
      // Start audio inside the gesture; browsers block it otherwise.
      unlock().catch(() => null);
    }
  };
  return (
    <button
      aria-label="Interface sounds"
      aria-pressed={enabled}
      className={cx(
        "spring inline-flex size-9 items-center justify-center",
        className
      )}
      title={enabled ? "Sound on" : "Sound off"}
      data-cuelume-toggle=""
      onClick={toggle}
      type="button"
    >
      <PixelIcon name={enabled ? "soundOn" : "soundOff"} />
    </button>
  );
};
