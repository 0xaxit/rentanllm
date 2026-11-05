/**
 * Money is integer USDC micros (1 USDC = 1_000_000) held as `bigint`, exactly as
 * the API sends it (a decimal string on the wire, decoded to bigint by the
 * client). Nothing here goes through a float.
 */
export type Micros = bigint;

export const MICROS_PER_USDC = 1_000_000n;
const CENTS_DIVISOR = 10_000n;
const HALF_CENT = 5000n;
const DECIMALS = 6;
const TOKENS_PER_MILLION = 1_000_000;
const THOUSAND = 1000;

const DECIMAL_STRING = /^-?\d+$/u;
const USD_INPUT = /^\$?\s*(?<whole>\d{0,9})(?:\.(?<fraction>\d{0,6}))?$/u;
const THOUSANDS = /\B(?=(?:\d{3})+(?!\d))/gu;
const TRAILING_ZEROS = /0+$/u;
const NOT_PRICE_CHARS = /[^\d.]/gu;

/** Micros from the API's decimal string (or a bigint). Throws on anything else. */
export const toMicros = (value: bigint | string): Micros => {
  if (typeof value === "bigint") {
    return value;
  }
  const trimmed = value.trim();
  if (!DECIMAL_STRING.test(trimmed)) {
    throw new Error(`Not an integer micros amount: "${value}"`);
  }
  return BigInt(trimmed);
};

const groupThousands = (whole: bigint): string =>
  whole.toString().replaceAll(THOUSANDS, ",");

/**
 * "$19.20", "-$2.88", "$1,204.00". Rounds half away from zero to cents.
 * `fractionDigits: 4` keeps sub-cent prices visible ("$0.0800").
 */
export const formatUsd = (
  value: bigint | string,
  { fractionDigits = 2 }: { readonly fractionDigits?: 2 | 4 | 6 } = {}
): string => {
  const micros = toMicros(value);
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const unit = 10n ** BigInt(DECIMALS - fractionDigits);
  const half = unit / 2n;
  const rounded = unit === 1n ? abs : ((abs + half) / unit) * unit;
  const whole = rounded / MICROS_PER_USDC;
  const fraction = (rounded % MICROS_PER_USDC)
    .toString()
    .padStart(DECIMALS, "0")
    .slice(0, fractionDigits);
  return `${negative ? "-" : ""}$${groupThousands(whole)}.${fraction}`;
};

/**
 * Never rounds money away: whole cents as "$4.20", anything finer to the micro with
 * trailing zeros dropped ("$4.999997", "$0.000003"). For balances and charges, where a
 * sub-cent amount rounded to "$0.00" would hide what was actually spent.
 */
export const formatUsdExact = (value: bigint | string): string => {
  const micros = toMicros(value);
  if (micros % CENTS_DIVISOR === 0n) {
    return formatUsd(micros);
  }
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const fraction = (abs % MICROS_PER_USDC)
    .toString()
    .padStart(DECIMALS, "0")
    .replace(TRAILING_ZEROS, "");
  return `${negative ? "-" : ""}$${groupThousands(abs / MICROS_PER_USDC)}.${fraction}`;
};

const MICROS_PER_MTOK_TOKEN = 1_000_000n;

/**
 * The exact cost of `tokens` at a per-million-token price, before rounding: 309 tokens
 * at $0.80 / M is "$0.0002472". A request's total is rounded up to whole micros once,
 * so these lines can add up to slightly less than its charge.
 */
export const formatTokenCost = (tokens: number, perMtok: bigint): string => {
  const scaled = BigInt(tokens) * perMtok;
  const whole = scaled / (MICROS_PER_USDC * MICROS_PER_MTOK_TOKEN);
  const fraction = (scaled % (MICROS_PER_USDC * MICROS_PER_MTOK_TOKEN))
    .toString()
    .padStart(DECIMALS * 2, "0")
    .replace(TRAILING_ZEROS, "")
    .padEnd(2, "0");
  return `$${groupThousands(whole)}.${fraction}`;
};

/** "$10" for whole dollars, "$2.50" otherwise: compact settings rows and chips. */
export const formatUsdCompact = (value: bigint | string): string => {
  const micros = toMicros(value);
  const abs = micros < 0n ? -micros : micros;
  if (abs % MICROS_PER_USDC === 0n) {
    return `${micros < 0n ? "-" : ""}$${groupThousands(abs / MICROS_PER_USDC)}`;
  }
  return formatUsd(micros);
};

/**
 * Price per million tokens: two decimals unless the price has more precision,
 * then up to four ("$0.08", "$1.60", "$0.0125").
 */
export const formatPrice = (value: bigint | string): string => {
  const micros = toMicros(value);
  return micros % CENTS_DIVISOR === 0n
    ? formatUsd(micros)
    : formatUsd(micros, { fractionDigits: 4 });
};

/** "10.00 USDC" with the token's six decimals trimmed to two. */
export const formatUsdcAmount = (value: bigint | string): string =>
  `${formatUsd(value).replace("$", "")} USDC`;

/** Micros as an editable dollar string: 1_600_000n -> "1.60", 125_000n -> "0.125". */
export const microsToInput = (value: bigint | string): string => {
  const micros = toMicros(value);
  const whole = micros / MICROS_PER_USDC;
  const fraction = (micros % MICROS_PER_USDC)
    .toString()
    .padStart(DECIMALS, "0")
    .replace(TRAILING_ZEROS, "");
  return `${whole}.${fraction.padEnd(2, "0")}`;
};

/**
 * Keeps a price field to what a price can be while the owner types: digits and one
 * decimal point (a second "." is dropped), at most six decimals (one micro-USDC).
 * "$1.60" pasted in becomes "1.60"; "0.4.00" can't be typed.
 */
export const sanitizePriceInput = (raw: string): string => {
  const cleaned = raw.replaceAll(NOT_PRICE_CHARS, "");
  const dot = cleaned.indexOf(".");
  if (dot === -1) {
    return cleaned;
  }
  const whole = cleaned.slice(0, dot);
  const fraction = cleaned
    .slice(dot + 1)
    .replaceAll(".", "")
    .slice(0, DECIMALS);
  return `${whole}.${fraction}`;
};

/**
 * Parses what an owner types into a price field ("1.6", "$1.60", ".08") into
 * micros. Null for empty, negative or malformed input. At most six decimals.
 */
export const parseUsdInput = (raw: string): Micros | null => {
  const match = USD_INPUT.exec(raw.trim());
  if (!match) {
    return null;
  }
  const whole = match.groups?.whole ?? "";
  const fraction = match.groups?.fraction ?? "";
  if (whole === "" && fraction === "") {
    return null;
  }
  return (
    BigInt(whole || "0") * MICROS_PER_USDC +
    BigInt(fraction.padEnd(DECIMALS, "0"))
  );
};

/** Whole cents, rounded half up: for comparing prices the way they are shown. */
export const toCents = (value: bigint | string): bigint =>
  (toMicros(value) + HALF_CENT) / CENTS_DIVISOR;

/** "40.0M", "1.2M", "850k", "12" for token counts. */
export const formatTokens = (tokens: number): string => {
  if (tokens >= TOKENS_PER_MILLION) {
    return `${(tokens / TOKENS_PER_MILLION).toFixed(1)}M`;
  }
  if (tokens >= THOUSAND) {
    return `${Math.round(tokens / THOUSAND)}k`;
  }
  return String(tokens);
};

const integerFormat = new Intl.NumberFormat("en-US");

export const formatInteger = (value: number): string =>
  integerFormat.format(value);

/**
 * An optional price field: empty means "use the default" (null). `ok` is
 * false only for text that is not a price.
 */
export const parseOptionalUsdInput = (
  raw: string
): { readonly ok: boolean; readonly value: Micros | null } => {
  if (raw.trim() === "") {
    return { ok: true, value: null };
  }
  const value = parseUsdInput(raw);
  return { ok: value !== null, value };
};
