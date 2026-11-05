import { BPS_DENOMINATOR, ceilDiv, TOKENS_PER_MTOK } from "./money";
import type { Micros } from "./money";

/** Per-million-token prices in USDC micros. $1.60 / Mtok = 1_600_000n. */
export interface TokenPrices {
  readonly cacheReadPerMtok: Micros;
  /** Cache-write price. Omitted: input price × CACHE_WRITE_MULTIPLIER_BPS (1.25×, like Anthropic). */
  readonly cacheWritePerMtok?: Micros;
  readonly inputPerMtok: Micros;
  readonly outputPerMtok: Micros;
}

export interface TokenUsage {
  readonly cacheReadTokens: number;
  /** Priced at `cacheWritePerMtok`, or 1.25× input when the listing sets none. */
  readonly cacheWriteTokens?: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

const toTokens = (count: number | undefined, label: string): bigint => {
  const value = count ?? 0;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer, got ${value}`);
  }
  return BigInt(value);
};

/** Default cache-write price relative to input: 1.25×, matching Anthropic's 5-minute cache writes. */
export const CACHE_WRITE_MULTIPLIER_BPS = 12_500n;

/** The cache-write price a listing effectively charges. */
export const cacheWritePrice = (prices: TokenPrices): Micros =>
  prices.cacheWritePerMtok ??
  (prices.inputPerMtok * CACHE_WRITE_MULTIPLIER_BPS) / BPS_DENOMINATOR;

/** Cache-read price when a listing sets none: input ÷ 10 (what the gateway charges). */
export const CACHE_READ_DEFAULT_DIVISOR = 10n;

/** A listing's price columns; null cache prices fall back to the defaults. */
export interface ListingPriceColumns {
  readonly cacheReadPerMtok: Micros | null;
  readonly cacheWritePerMtok: Micros | null;
  readonly inputPerMtok: Micros;
  readonly outputPerMtok: Micros;
}

/** The prices a listing effectively charges, with the cache-read and cache-write defaults applied. */
export const effectiveListingPrices = (
  columns: ListingPriceColumns
): Required<TokenPrices> => {
  const base = {
    cacheReadPerMtok:
      columns.cacheReadPerMtok ??
      columns.inputPerMtok / CACHE_READ_DEFAULT_DIVISOR,
    inputPerMtok: columns.inputPerMtok,
    outputPerMtok: columns.outputPerMtok,
  };
  return {
    ...base,
    cacheWritePerMtok: columns.cacheWritePerMtok ?? cacheWritePrice(base),
  };
};

/**
 * Prices one request (or an aggregate of requests). The exact cost is computed in
 * micro-micros and rounded up once to whole micros.
 */
export const priceUsage = (usage: TokenUsage, prices: TokenPrices): Micros => {
  const input = toTokens(usage.inputTokens, "inputTokens");
  const cacheWrite = toTokens(usage.cacheWriteTokens, "cacheWriteTokens");
  const output = toTokens(usage.outputTokens, "outputTokens");
  const cacheRead = toTokens(usage.cacheReadTokens, "cacheReadTokens");
  const scaled =
    input * prices.inputPerMtok +
    cacheWrite * cacheWritePrice(prices) +
    output * prices.outputPerMtok +
    cacheRead * prices.cacheReadPerMtok;
  return ceilDiv(scaled, TOKENS_PER_MTOK);
};

/** Suggested listing price is 40% of the provider API list price. */
export const SUGGESTED_PRICE_BPS = 4000n;
/** The recommended band is 30-50% of the API list price. */
export const FAIR_BAND_MIN_BPS = 3000n;
export const FAIR_BAND_MAX_BPS = 5000n;
const API_PARITY_BPS = BPS_DENOMINATOR;

const scalePrices = (prices: TokenPrices, bps: bigint): TokenPrices => ({
  cacheReadPerMtok: (prices.cacheReadPerMtok * bps) / BPS_DENOMINATOR,
  cacheWritePerMtok: (cacheWritePrice(prices) * bps) / BPS_DENOMINATOR,
  inputPerMtok: (prices.inputPerMtok * bps) / BPS_DENOMINATOR,
  outputPerMtok: (prices.outputPerMtok * bps) / BPS_DENOMINATOR,
});

export interface PriceSuggestion {
  readonly max: TokenPrices;
  readonly min: TokenPrices;
  readonly suggested: TokenPrices;
}

/** Suggested price (40%) plus the fair band (30-50%) for a provider's API list price. */
export const suggestPrices = (apiPrices: TokenPrices): PriceSuggestion => ({
  max: scalePrices(apiPrices, FAIR_BAND_MAX_BPS),
  min: scalePrices(apiPrices, FAIR_BAND_MIN_BPS),
  suggested: scalePrices(apiPrices, SUGGESTED_PRICE_BPS),
});

export type PriceVerdict = "underpriced" | "fair" | "pricey" | "above_api";

export interface ListingPrices {
  readonly inputPerMtok: Micros;
  readonly outputPerMtok: Micros;
}

/**
 * Compares `ratio = (in/apiIn + out/apiOut) / 2` against `bps / 10000` exactly, using
 * cross-multiplication. Returns -1, 0 or 1.
 */
const compareRatio = (
  listing: ListingPrices,
  api: ListingPrices,
  bps: bigint
): -1 | 0 | 1 => {
  const lhs =
    (listing.inputPerMtok * api.outputPerMtok +
      listing.outputPerMtok * api.inputPerMtok) *
    BPS_DENOMINATOR;
  const rhs = 2n * bps * api.inputPerMtok * api.outputPerMtok;
  if (lhs < rhs) {
    return -1;
  }
  return lhs > rhs ? 1 : 0;
};

/** Average of the input and output price ratios versus the API list price, as a float for display. */
export const priceRatio = (
  listing: ListingPrices,
  api: ListingPrices
): number =>
  (Number(listing.inputPerMtok) / Number(api.inputPerMtok) +
    Number(listing.outputPerMtok) / Number(api.outputPerMtok)) /
  2;

/**
 * Verdict on a listing's price relative to the API list price. There is no price cap:
 * any price is allowed, this is advisory only.
 * - ratio < 30%: underpriced
 * - 30% <= ratio <= 50%: fair
 * - 50% < ratio < 100%: pricey
 * - ratio >= 100%: above_api
 */
export const priceVerdict = (
  listing: ListingPrices,
  api: ListingPrices
): PriceVerdict => {
  if (api.inputPerMtok <= 0n || api.outputPerMtok <= 0n) {
    throw new Error("API reference prices must be positive");
  }
  if (compareRatio(listing, api, FAIR_BAND_MIN_BPS) < 0) {
    return "underpriced";
  }
  if (compareRatio(listing, api, FAIR_BAND_MAX_BPS) <= 0) {
    return "fair";
  }
  if (compareRatio(listing, api, API_PARITY_BPS) < 0) {
    return "pricey";
  }
  return "above_api";
};
