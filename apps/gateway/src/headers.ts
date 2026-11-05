/** Header filtering between renter, gateway and node. */

/** RFC 9110 hop-by-hop headers, plus legacy ones proxies must not forward. */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/**
 * Renter request headers never sent to the node: renter credentials, hop-by-hop headers,
 * headers the gateway recomputes (host, length, encoding) and anything identifying the
 * renter's network location.
 */
const STRIP_FROM_RENTER = new Set([
  ...HOP_BY_HOP,
  "accept-encoding",
  "authorization",
  "content-length",
  "cookie",
  "forwarded",
  "host",
  "payment-signature",
  "x-api-key",
  "x-payment",
  "x-real-ip",
]);

const STRIP_PREFIXES = ["x-forwarded-", "x-rentanllm-"];

const connectionListed = (headers: Readonly<Record<string, string>>) =>
  new Set(
    (headers.connection ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter((h) => h.length > 0)
  );

/** Headers forwarded to the node in `ProxyRequest.headers`. Names are lowercased. */
export const forwardableRequestHeaders = (
  headers: Readonly<Record<string, string>>
): Record<string, string> => {
  const listed = connectionListed(headers);
  const out: Record<string, string> = {};
  for (const [rawName, value] of Object.entries(headers)) {
    const name = rawName.toLowerCase();
    const stripped =
      STRIP_FROM_RENTER.has(name) ||
      listed.has(name) ||
      STRIP_PREFIXES.some((prefix) => name.startsWith(prefix));
    if (!stripped) {
      out[name] = value;
    }
  }
  return out;
};

/**
 * Response headers from the node passed through to the renter. Everything else
 * (provider rate-limit and organisation headers, cookies, lengths) stays private to
 * the owner or is recomputed by the gateway.
 */
const PASS_TO_RENTER = new Set(["content-type", "request-id", "retry-after"]);

export const renterResponseHeaders = (
  headers: Readonly<Record<string, string>>
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [rawName, value] of Object.entries(headers)) {
    const name = rawName.toLowerCase();
    if (PASS_TO_RENTER.has(name)) {
      out[name] = value;
    }
  }
  return out;
};

const BEARER_PREFIX = /^bearer\s+/iu;

/** Renter key from `x-api-key` or `Authorization: Bearer`. */
export const extractApiKey = (
  headers: Readonly<Record<string, string | undefined>>
): string | null => {
  const direct = headers["x-api-key"]?.trim();
  if (direct !== undefined && direct.length > 0) {
    return direct;
  }
  const auth = headers.authorization?.trim();
  if (auth !== undefined && BEARER_PREFIX.test(auth)) {
    const token = auth.replace(BEARER_PREFIX, "").trim();
    return token.length > 0 ? token : null;
  }
  return null;
};

/** x402 payment: v2 `PAYMENT-SIGNATURE`, or the v1-era `X-PAYMENT` name. */
export const extractPaymentHeader = (
  headers: Readonly<Record<string, string | undefined>>
): string | null => {
  const value = (headers["payment-signature"] ?? headers["x-payment"])?.trim();
  return value === undefined || value.length === 0 ? null : value;
};
