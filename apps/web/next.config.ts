import path from "node:path";

import type { NextConfig } from "next";

const monorepoRoot = path.join(import.meta.dirname, "../..");

/**
 * The control-plane API's origin (server-only, read at build time). The
 * browser never calls it directly: `/api/:path*` on the web app's own host is
 * proxied there, so the session cookie is first-party and host-only.
 */
const apiOrigin = (
  process.env.API_ORIGIN?.trim() || "http://localhost:8788"
).replace(/\/+$/u, "");

/**
 * The canonical site. Sign-in messages are bound to one host (the API's
 * SIWE_DOMAIN), so older hosts redirect here instead of serving the app.
 */
const siteUrl = (
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://rentanllm.xyz"
).replace(/\/+$/u, "");
const LEGACY_HOSTS = ["rentanllm.vercel.app", "www.rentanllm.xyz"];
const legacyRedirects = LEGACY_HOSTS.filter(
  (host) => host !== new URL(siteUrl).host
).map((host) => ({
  destination: `${siteUrl}/:path*`,
  has: [{ type: "host" as const, value: host }],
  permanent: true,
  // /api stays reachable on the old host for clients mid-request.
  source: "/:path((?!api/).*)",
}));

const nextConfig: NextConfig = {
  outputFileTracingRoot: monorepoRoot,
  reactStrictMode: true,
  // The booking pages are gone; their old links land on the market.
  redirects: async () =>
    await Promise.resolve([
      ...legacyRedirects,
      ...["/keys", "/browse", "/bookings", "/wallet"].map((source) => ({
        destination: "/market",
        permanent: false,
        source,
      })),
    ]),
  // Checked before the filesystem, so /api/* never reaches an app route.
  rewrites: async () =>
    await Promise.resolve({
      afterFiles: [],
      beforeFiles: [
        { destination: `${apiOrigin}/:path*`, source: "/api/:path*" },
      ],
      fallback: [],
    }),
  // Workspace packages ship TypeScript source.
  transpilePackages: [
    "@rentanllm/api-contract",
    "@rentanllm/arkiv",
    "@rentanllm/core",
    "@rentanllm/protocol",
  ],
  turbopack: { root: monorepoRoot },
};

export default nextConfig;
