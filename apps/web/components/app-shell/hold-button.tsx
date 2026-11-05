"use client";

import { useEffect, useRef, useState } from "react";

import { cx } from "@/lib/cx";
import { cue } from "@/lib/sound";

const HOLD_MS = 2000;

/**
 * Hold-to-confirm for destructive actions: press and hold for 2s (pointer,
 * Space or Enter). Releasing early cancels. The fill shows progress; screen
 * readers get the instruction in the label.
 */
export const HoldButton = ({
  label,
  onConfirm,
  disabled = false,
}: {
  label: string;
  onConfirm: () => void;
  disabled?: boolean;
}) => {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setHolding(false);
  };

  const start = () => {
    if (disabled || timer.current) {
      return;
    }
    setHolding(true);
    cue("loading", { emphasis: "subtle" });
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      cue("close", { emphasis: "strong" });
      onConfirm();
    }, HOLD_MS);
  };

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    []
  );

  return (
    <button
      aria-label={`${label}. Press and hold for 2 seconds.`}
      className="bg-pumpkin text-carbon text-body relative flex h-14 w-full touch-none items-center justify-center overflow-clip leading-5.25 select-none disabled:opacity-60"
      disabled={disabled}
      onBlur={cancel}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if ((event.key === " " || event.key === "Enter") && !event.repeat) {
          event.preventDefault();
          start();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === " " || event.key === "Enter") {
          cancel();
        }
      }}
      onPointerCancel={cancel}
      onPointerDown={start}
      onPointerLeave={cancel}
      onPointerUp={cancel}
      type="button"
    >
      <span
        aria-hidden="true"
        className={cx(
          "bg-amber absolute inset-0",
          holding ? "hold-fill-active" : "hold-fill"
        )}
      />
      <span className="relative">
        {holding ? "KEEP HOLDING…" : `${label.toUpperCase()} · HOLD 2s`}
      </span>
    </button>
  );
};
