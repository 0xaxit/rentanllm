"use client";

import { useSyncExternalStore } from "react";

import {
  formatClock,
  formatDay,
  formatShortDay,
  formatWindow,
  zoneAbbreviation,
} from "@/lib/time";

const noop = () => () => {
  /* the zone does not change while the page is open */
};
const clientZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const serverZone = () => "UTC";

/**
 * The viewer's IANA time zone. The server renders UTC; hydration then swaps
 * in the browser's zone without a mismatch warning.
 */
export const useTimeZone = (): string =>
  useSyncExternalStore(noop, clientZone, serverZone);

type TimeFormat = "clock" | "day" | "short-day" | "zone";

const formatters: Record<TimeFormat, (date: Date, timeZone: string) => string> =
  {
    clock: formatClock,
    day: formatDay,
    "short-day": formatShortDay,
    zone: zoneAbbreviation,
  };

/** A time in the viewer's zone: <LocalTime value={date} format="clock" />. */
export const LocalTime = ({
  value,
  format = "clock",
}: {
  value: Date;
  format?: TimeFormat;
}) => {
  const timeZone = useTimeZone();
  return (
    <time dateTime={value.toISOString()}>
      {formatters[format](value, timeZone)}
    </time>
  );
};

/** "00:00 → 08:00 IST" in the viewer's zone. */
export const LocalWindow = ({
  startsAt,
  endsAt,
  withZone = true,
}: {
  startsAt: Date;
  endsAt: Date;
  withZone?: boolean;
}) => {
  const timeZone = useTimeZone();
  const zone = withZone ? ` ${zoneAbbreviation(startsAt, timeZone)}` : "";
  return (
    <span>
      {formatWindow(startsAt, endsAt, timeZone)}
      {zone}
    </span>
  );
};
