"use client";

import { bind, setEnabled, setTheme } from "cuelume";
import { useEffect } from "react";

import { readSoundEnabled } from "@/lib/sound";

/**
 * Binds every data-cuelume-* element on the page (including ones rendered
 * later) and applies the stored on/off choice. The `mech` material (shutter
 * clicks, ratchet detents, latches) suits the departures-board look.
 */
export const SoundBinder = () => {
  useEffect(() => {
    setTheme("mech");
    setEnabled(readSoundEnabled());
    return bind();
  }, []);
  return null;
};
