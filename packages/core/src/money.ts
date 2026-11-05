/**
 * Money is always an integer number of USDC micros (1 USDC = 1_000_000 micros), held as a
 * `bigint`. Never use floats for money.
 */
export type Micros = bigint;

export const MICROS_PER_USDC = 1_000_000n;
export const TOKENS_PER_MTOK = 1_000_000n;
export const BPS_DENOMINATOR = 10_000n;

const USD_PATTERN = /^(?<sign>-)?(?<whole>\d+)(?:\.(?<fraction>\d{1,6}))?$/u;
const DECIMALS = 6;

/** Parses a decimal string such as "19.20" or "0.08" into micros. Throws on bad input. */
export const usdc = (value: string): Micros => {
  const match = USD_PATTERN.exec(value.trim());
  if (match === null) {
    throw new Error(`Not a USDC amount with at most 6 decimals: "${value}"`);
  }
  const { sign, whole = "0", fraction = "" } = match.groups ?? {};
  const micros =
    BigInt(whole) * MICROS_PER_USDC + BigInt(fraction.padEnd(DECIMALS, "0"));
  return sign === "-" ? -micros : micros;
};

/** Formats micros as a fixed 6-decimal USDC string, e.g. 19_200_000n -> "19.200000". */
export const formatUsdc = (micros: Micros): string => {
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const whole = abs / MICROS_PER_USDC;
  const fraction = (abs % MICROS_PER_USDC).toString().padStart(DECIMALS, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
};

/** Integer division rounding up, for non-negative operands. */
export const ceilDiv = (numerator: bigint, denominator: bigint): bigint => {
  if (denominator <= 0n) {
    throw new Error("ceilDiv denominator must be positive");
  }
  if (numerator <= 0n) {
    return numerator / denominator;
  }
  return (numerator + denominator - 1n) / denominator;
};

/** Applies basis points (1 bps = 0.01%), rounding down. */
export const applyBps = (amount: Micros, bps: bigint): Micros =>
  (amount * bps) / BPS_DENOMINATOR;

export const sumMicros = (amounts: Iterable<Micros>): Micros => {
  let total = 0n;
  for (const amount of amounts) {
    total += amount;
  }
  return total;
};
