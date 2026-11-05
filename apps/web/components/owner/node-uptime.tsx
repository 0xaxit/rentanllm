import type { CSSProperties } from "react";

import type { NodeUptime } from "@/lib/api/types";

import { GroupedRow } from "../app-shell/grouped-list";
import { LocalTime } from "../local-time";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const TICKS = ["−24h", "−18h", "−12h", "−6h", "now"] as const;

const formatSpan = (ms: number) => {
  const hours = Math.floor(ms / HOUR_MS);
  const minutes = Math.floor((ms % HOUR_MS) / MINUTE_MS);
  if (hours >= 48) {
    return `${Math.floor(hours / 24)}d`;
  }
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
};

const percent = (onlineMs: number, trackedMs: number) => {
  if (trackedMs <= 0) {
    return "—";
  }
  const value = (onlineMs / trackedMs) * 100;
  return `${value >= 99.95 ? "100" : value.toFixed(1)}%`;
};

const UptimeRow = ({
  label,
  spanMs,
  window,
}: {
  label: string;
  spanMs: number;
  window: NodeUptime["last24h"];
}) => (
  <GroupedRow
    detail={
      window.trackedMs > 0 && window.trackedMs < spanMs
        ? `tracked ${formatSpan(window.trackedMs)} so far`
        : undefined
    }
    label={label}
    value={percent(window.onlineMs, window.trackedMs)}
  />
);

/** Uptime rows for the node card's grouped list. */
export const NodeUptimeRows = ({ uptime }: { uptime: NodeUptime }) => (
  <>
    <GroupedRow
      label="Online since"
      tone={uptime.currentSessionSince ? "foam" : "muted"}
      value={
        uptime.currentSessionSince ? (
          <>
            <LocalTime format="short-day" value={uptime.currentSessionSince} />{" "}
            <LocalTime value={uptime.currentSessionSince} />
          </>
        ) : (
          "offline"
        )
      }
    />
    <UptimeRow label="Uptime · 24h" spanMs={DAY_MS} window={uptime.last24h} />
    <UptimeRow label="Uptime · 7d" spanMs={7 * DAY_MS} window={uptime.last7d} />
  </>
);

/**
 * The last 24 hours as a strip: amber where the node was online, carbon where
 * it was offline, hatched before tracking began.
 */
export const UptimeStrip = ({ uptime }: { uptime: NodeUptime }) => {
  const end = uptime.asOf.getTime();
  const start = end - DAY_MS;
  const position = (at: number) =>
    `${(((Math.min(Math.max(at, start), end) - start) / DAY_MS) * 100).toFixed(3)}%`;
  const tracked = uptime.trackedSince?.getTime() ?? end;
  return (
    <figure className="flex flex-col gap-1.5">
      <figcaption className="text-label tracking-label text-mud">
        LAST 24 HOURS
      </figcaption>
      <div
        aria-label={`Online ${percent(uptime.last24h.onlineMs, uptime.last24h.trackedMs)} of the last 24 hours`}
        className="border-dark relative h-4 overflow-hidden border bg-black"
        role="img"
      >
        {tracked > start && (
          <span
            aria-hidden="true"
            className="bg-hatch absolute inset-y-0 left-0 w-(--until)"
            style={{ "--until": position(tracked) } as CSSProperties}
          />
        )}
        {uptime.timeline24h.map((span) => (
          <span
            aria-hidden="true"
            className="bg-amber absolute inset-y-0 right-[calc(100%-var(--to))] left-(--from)"
            key={span.from.toISOString()}
            style={
              {
                "--from": position(span.from.getTime()),
                "--to": position(span.to.getTime()),
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div
        aria-hidden="true"
        className="text-label text-mud flex justify-between"
      >
        {TICKS.map((tick) => (
          <span key={tick}>{tick}</span>
        ))}
      </div>
    </figure>
  );
};
