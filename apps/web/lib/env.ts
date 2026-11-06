/**
 * Public configuration, inlined at build time. Every value has a local-dev
 * default so the app builds with no environment at all.
 */

const trimSlash = (url: string): string => url.replace(/\/+$/u, "");

const DEFAULT_API_ORIGIN = "http://localhost:8788";
const DEFAULT_GATEWAY_URL = "http://localhost:8787";
const DEFAULT_SITE_URL = "https://rentanllm.xyz";

/**
 * Where the browser reaches the control-plane API: same origin, under /api.
 * next.config.ts rewrites `/api/:path*` to `API_ORIGIN/:path*`, so the
 * session cookie is host-only on the web app's own host (needed on
 * *.vercel.app, a public suffix where cookies cannot span sibling hosts).
 */
export const API_PROXY_PATH = "/api";

/**
 * Server-side base URL for Server Component fetches: API_URL (an override,
 * e.g. a private address), else API_ORIGIN, else the local API. Server-only
 * variables: in the browser bundle both are undefined and this is unused.
 */
export const SERVER_API_URL = trimSlash(
  process.env.API_URL?.trim() ||
    process.env.API_ORIGIN?.trim() ||
    DEFAULT_API_ORIGIN
);

/** The API base for the current runtime: `<origin>/api` in the browser. */
export const apiBaseUrl = (): string =>
  typeof window === "undefined"
    ? SERVER_API_URL
    : `${window.location.origin}${API_PROXY_PATH}`;

/** Gateway (apps/gateway), e.g. https://gw.rentanllm.xyz. */
export const GATEWAY_URL = trimSlash(
  process.env.NEXT_PUBLIC_GATEWAY_URL?.trim() || DEFAULT_GATEWAY_URL
);

/** OpenAI / Anthropic compatible base URL renters point their SDKs at. */
export const GATEWAY_API_BASE = `${GATEWAY_URL}/v1`;

export const WALLETCONNECT_PROJECT_ID =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() ?? "";

/** Hedera testnet JSON-RPC for the wallet. Defaults to viem's public endpoint (Hashio). */
export const RPC_URL =
  process.env.NEXT_PUBLIC_HEDERA_RPC_URL?.trim() || undefined;

/** Canonical site origin for Open Graph URLs. */
export const SITE_URL = trimSlash(
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || DEFAULT_SITE_URL
);

/** The HCS topic the gateway posts one message to per settled payment. */
export const HCS_AUDIT_TOPIC_ID =
  process.env.NEXT_PUBLIC_HCS_AUDIT_TOPIC_ID?.trim() || "0.0.11332573";

/** The hosted MCP server Claude Desktop connects to (a custom connector URL). */
export const MCP_URL = trimSlash(
  process.env.NEXT_PUBLIC_MCP_URL?.trim() || "https://api.rentanllm.xyz/mcp"
);

/** Circle's testnet USDC (HTS 0.0.429274) through its ERC-20 facade on Hedera's EVM. */
export const USDC_EVM_ADDRESS = "0x0000000000000000000000000000000000068cda";
