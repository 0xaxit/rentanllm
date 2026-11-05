/**
 * The local spend log and the caps checked against it. Every payment the MCP server makes
 * is appended to `<stateDir>/spend.jsonl`; the daily cap is a rolling 24 hours over it.
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { formatUsdc } from "./config.ts";

const DAY_MS = 86_400_000;

export interface SpendEntry {
  readonly amountMicros: bigint;
  readonly at: Date;
  readonly model: string;
  readonly network: string;
  readonly payTo: string;
  readonly requestId: string | null;
  readonly tx: string | null;
}

export interface Caps {
  readonly maxPerDayMicros: bigint;
  readonly maxPerRequestMicros: bigint;
}

/** Spent in the 24 hours before `now`. */
export const spentLastDay = (
  entries: readonly SpendEntry[],
  now: Date
): bigint =>
  entries
    .filter((entry) => now.getTime() - entry.at.getTime() < DAY_MS)
    .reduce((sum, entry) => sum + entry.amountMicros, 0n);

/** Why paying `amount` now would break a cap, or null when it may go ahead. */
export const capRefusal = (
  amountMicros: bigint,
  caps: Caps,
  spentMicros: bigint,
  maxPriceMicros: bigint | null
): string | null => {
  if (maxPriceMicros !== null && amountMicros > maxPriceMicros) {
    return `the price ${formatUsdc(amountMicros)} USDC is above the ${formatUsdc(maxPriceMicros)} USDC you allowed for this request`;
  }
  if (amountMicros > caps.maxPerRequestMicros) {
    return `the price ${formatUsdc(amountMicros)} USDC is above the per-request cap of ${formatUsdc(caps.maxPerRequestMicros)} USDC`;
  }
  if (spentMicros + amountMicros > caps.maxPerDayMicros) {
    return `paying ${formatUsdc(amountMicros)} USDC would take today's spend past the daily cap of ${formatUsdc(caps.maxPerDayMicros)} USDC (${formatUsdc(spentMicros)} USDC spent in the last 24 hours)`;
  }
  return null;
};

interface StoredEntry {
  readonly amountMicros: string;
  readonly at: string;
  readonly model: string;
  readonly network: string;
  readonly payTo: string;
  readonly requestId: string | null;
  readonly tx: string | null;
}

const logPath = (stateDir: string) => path.join(stateDir, "spend.jsonl");

export const readSpends = (stateDir: string): SpendEntry[] => {
  let raw = "";
  try {
    raw = readFileSync(logPath(stateDir), "utf-8");
  } catch {
    return [];
  }
  const entries: SpendEntry[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    try {
      const stored = JSON.parse(line) as StoredEntry;
      entries.push({
        ...stored,
        amountMicros: BigInt(stored.amountMicros),
        at: new Date(stored.at),
      });
    } catch {
      // A torn last line from a crash: skip it rather than lose the whole log.
    }
  }
  return entries;
};

export const appendSpend = (stateDir: string, entry: SpendEntry): void => {
  mkdirSync(stateDir, { recursive: true });
  const stored: StoredEntry = {
    ...entry,
    amountMicros: entry.amountMicros.toString(),
    at: entry.at.toISOString(),
  };
  appendFileSync(logPath(stateDir), `${JSON.stringify(stored)}\n`);
};
