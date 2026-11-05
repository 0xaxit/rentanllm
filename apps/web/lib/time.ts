/** Time formatting. Every function takes the IANA zone to render in. */

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

const clockFormats = new Map<string, Intl.DateTimeFormat>();
const clockFormat = (timeZone: string): Intl.DateTimeFormat => {
  let format = clockFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      timeZone,
    });
    clockFormats.set(timeZone, format);
  }
  return format;
};

/** "00:00", "23:42": 24-hour clock, the board's style. */
export const formatClock = (date: Date, timeZone: string): string =>
  clockFormat(timeZone).format(date);

/** "00:00 → 08:00". */
export const formatWindow = (
  startsAt: Date,
  endsAt: Date,
  timeZone: string
): string =>
  `${formatClock(startsAt, timeZone)} → ${formatClock(endsAt, timeZone)}`;

/** Day, short month, and year, in capitals. */
export const formatDay = (date: Date, timeZone: string): string =>
  new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone,
    year: "numeric",
  })
    .format(date)
    .toUpperCase();

/** Weekday, day, and short month, for list rows. */
export const formatShortDay = (date: Date, timeZone: string): string =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone,
    weekday: "short",
  }).format(date);

const ZONE_LOCALES = ["en-US", "en-IN", "en-GB", "en-AU"] as const;
const GMT_OFFSET = /^GMT[+-]/u;

const shortZoneName = (
  date: Date,
  timeZone: string,
  locale: string
): string | undefined =>
  new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "short" })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName")?.value;

/**
 * "IST", "PDT", "CET": the zone's short name at `date`. en-US only knows
 * American abbreviations, so other locales are tried before settling for a
 * "GMT+5:30" style offset.
 */
export const zoneAbbreviation = (date: Date, timeZone: string): string => {
  let fallback: string | undefined;
  for (const locale of ZONE_LOCALES) {
    const name = shortZoneName(date, timeZone, locale);
    if (name && !GMT_OFFSET.test(name)) {
      return name;
    }
    fallback ??= name;
  }
  return fallback ?? timeZone;
};

/** "1h19m", "45m", "2d 3h": a compact countdown. */
export const formatDuration = (ms: number): string => {
  const minutes = Math.max(0, Math.round(ms / MS_PER_MINUTE));
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const days = Math.floor(hours / HOURS_PER_DAY);
  if (days > 0) {
    return `${days}d ${hours % HOURS_PER_DAY}h`;
  }
  if (hours > 0) {
    return `${hours}h${String(minutes % MINUTES_PER_HOUR).padStart(2, "0")}m`;
  }
  return `${minutes}m`;
};

/** "YYYY-MM-DDTHH:mm" for <input type="datetime-local"> in `timeZone`. */
export const toLocalInputValue = (date: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
};

/** The browser's IANA zone, or UTC on the server. */
export const browserTimeZone = (): string =>
  typeof Intl === "undefined"
    ? "UTC"
    : Intl.DateTimeFormat().resolvedOptions().timeZone;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** [1,2,3,4,5] -> "Mon–Fri"; [0..6] -> "every day"; otherwise "Mon, Wed". */
export const formatDays = (days: readonly number[]): string => {
  const sorted = [...new Set(days)].toSorted((a, b) => a - b);
  if (sorted.length === WEEKDAYS.length) {
    return "every day";
  }
  const isRun =
    sorted.length > 2 &&
    sorted.every((day, i) => i === 0 || day === (sorted[i - 1] ?? -1) + 1);
  const [first] = sorted;
  const last = sorted.at(-1);
  if (isRun && first !== undefined && last !== undefined) {
    return `${WEEKDAYS[first]}–${WEEKDAYS[last]}`;
  }
  return sorted.map((day) => WEEKDAYS[day] ?? "?").join(", ");
};

export const WEEKDAY_LABELS = WEEKDAYS;
