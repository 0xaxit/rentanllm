/**
 * Price verdicts on the owner console. The thresholds and the exact bigint
 * comparison come from @rentanllm/core, the same code the API answers
 * /pricing/suggestion with, so the live verdict while typing matches the
 * server's.
 */
import { priceRatio, priceVerdict } from "@rentanllm/core";

import type { PriceVerdict } from "./api/types";

/** Price band on the console runs 0–150% of the provider's API price. */
export const BAND_MAX_PERCENT = 150;
export const FAIR_MIN_PERCENT = 30;
export const FAIR_MAX_PERCENT = 50;
export const API_PERCENT = 100;
const PERCENT = 100;

export interface PricePair {
  readonly inputPerMtok: bigint;
  readonly outputPerMtok: bigint;
}

/** Null when the API reference price is missing or zero. */
export const verdictFor = (
  listing: PricePair,
  api: PricePair
): PriceVerdict | null =>
  api.inputPerMtok > 0n && api.outputPerMtok > 0n
    ? priceVerdict(listing, api)
    : null;

/** (in/apiIn + out/apiOut) / 2 as a percent, for the marker on the band. */
export const percentOfApi = (listing: PricePair, api: PricePair): number =>
  api.inputPerMtok > 0n && api.outputPerMtok > 0n
    ? priceRatio(listing, api) * PERCENT
    : 0;

export const verdictLabel: Record<PriceVerdict, string> = {
  above_api: "ABOVE API",
  fair: "FAIR",
  pricey: "PRICEY",
  underpriced: "UNDERPRICED",
};

export const verdictCopy: Record<PriceVerdict, string> = {
  above_api: "renters pay less going direct",
  fair: "likely to book",
  pricey: "books slower than the board",
  underpriced: "books fast, leaves money on the table",
};

/** 0–100% position on the band for a percent-of-API value. */
export const bandPosition = (percent: number): number =>
  (Math.min(Math.max(percent, 0), BAND_MAX_PERCENT) / BAND_MAX_PERCENT) *
  PERCENT;

/** A listing price this many times the API price is almost certainly a mistake. */
const ABSURD_HIGH_MULTIPLE = 2n;
/** ...and so is one below 1/20 of it (5%). */
const ABSURD_LOW_DIVISOR = 20n;

export type PriceSanity = "too_high" | "too_low";

/**
 * Flags prices that make no sense next to the provider's API price, per field:
 * more than 2× (renters would just use the API) or under 5% (likely a typo).
 * Null when the prices are plausible or there is no API reference.
 */
export const priceSanity = (
  listing: PricePair,
  api: PricePair
): PriceSanity | null => {
  if (api.inputPerMtok <= 0n || api.outputPerMtok <= 0n) {
    return null;
  }
  const pairs = [
    [listing.inputPerMtok, api.inputPerMtok],
    [listing.outputPerMtok, api.outputPerMtok],
  ] as const;
  if (pairs.some(([mine, ref]) => mine > ref * ABSURD_HIGH_MULTIPLE)) {
    return "too_high";
  }
  if (pairs.some(([mine, ref]) => mine * ABSURD_LOW_DIVISOR < ref)) {
    return "too_low";
  }
  return null;
};

export const sanityCopy: Record<PriceSanity, string> = {
  too_high:
    "This is more than double the API price. Renters can pay less by going to the provider directly, so it won't get booked.",
  too_low:
    "This is under 5% of the API price, which looks like a typo. You'd earn almost nothing for the tokens you serve.",
};
