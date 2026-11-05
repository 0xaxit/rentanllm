"use client";

import { useRef } from "react";
import type { KeyboardEvent } from "react";

import { cx } from "@/lib/cx";

export interface Segment<V extends string> {
  readonly value: V;
  readonly label: string;
}

/**
 * Segmented control as an ARIA radio group: arrow keys move the selection,
 * each segment is a 40px-tall touch target inside a 3px inset frame.
 */
export const SegmentedControl = <V extends string>({
  label,
  segments,
  value,
  onChange,
  className,
}: {
  label: string;
  segments: readonly Segment<V>[];
  value: V | null;
  onChange: (value: V) => void;
  className?: string;
}) => {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = segments.findIndex((s) => s.value === value);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowDown: 1, ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1 }[
      event.key
    ];
    if (step === undefined) {
      return;
    }
    event.preventDefault();
    const from = Math.max(selectedIndex, 0);
    const next = (from + step + segments.length) % segments.length;
    const segment = segments[next];
    if (segment) {
      onChange(segment.value);
      refs.current[next]?.focus();
    }
  };

  return (
    <div
      aria-label={label}
      className={cx(
        "border-dark bg-carbon flex gap-0.75 border p-0.75",
        className
      )}
      onKeyDown={onKeyDown}
      role="radiogroup"
    >
      {segments.map((segment, index) => {
        const checked = segment.value === value;
        const focusable = checked || (selectedIndex === -1 && index === 0);
        return (
          <button
            data-cuelume-select=""
            aria-checked={checked}
            className={cx(
              "flex h-10 grow basis-0 items-center justify-center px-1 text-sm leading-5",
              checked ? "bg-amber text-carbon" : "text-cement hover:bg-soot"
            )}
            key={segment.value}
            onClick={() => onChange(segment.value)}
            ref={(node) => {
              refs.current[index] = node;
            }}
            role="radio"
            tabIndex={focusable ? 0 : -1}
            type="button"
          >
            {segment.label}
          </button>
        );
      })}
    </div>
  );
};
