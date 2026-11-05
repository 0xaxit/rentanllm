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

const nextConfig: NextConfig = {
  outputFileTracingRoot: monorepoRoot,
  reactStrictMode: true,
  // The booking pages are gone; their old links land on the market.
  redirects: async () =>
    await Promise.resolve(
      ["/keys", "/browse", "/bookings", "/wallet"].map((source) => ({
        destination: "/market",
        permanent: false,
        source,
      }))
    ),
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
