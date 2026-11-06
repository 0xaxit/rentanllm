"use client";

import { useState } from "react";
import type { ReactNode } from "react";

import { SegmentedControl } from "@/components/app-shell/segmented-control";

export type UseMode = "mcp" | "api";

const MODES = [
  { label: "CLAUDE DESKTOP · MCP", value: "mcp" },
  { label: "OPENAI-COMPATIBLE API", value: "api" },
] as const;

/** The two ways to buy from the market, one shown at a time. */
export const UseTabs = ({
  api,
  initial,
  mcp,
}: {
  api: ReactNode;
  initial: UseMode;
  mcp: ReactNode;
}) => {
  const [mode, setMode] = useState<UseMode>(initial);
  return (
    <section
      aria-label="Use the market"
      className="flex flex-col gap-5"
      id="use"
    >
      <SegmentedControl
        className="max-w-150"
        label="How to buy"
        onChange={(next) => {
          setMode(next);
          const url = new URL(window.location.href);
          url.searchParams.set("use", next);
          window.history.replaceState(null, "", url);
        }}
        segments={MODES}
        value={mode}
      />
      {mode === "mcp" ? mcp : api}
    </section>
  );
};
