# @rentanllm/web

Marketing site, market and seller console for RentAnLLM. Next.js 16 (App Router), React 19, Tailwind v4. It talks to the control-plane API (`apps/api`) through a client derived from `@rentanllm/api-contract`, and signs sellers in with Ethereum (SIWE, on Hedera testnet). Agents pay per request over x402 on Hedera through the gateway; the web app only shows the market and the seller console. On phones (< 768px) the console and market screens behave like an installed app; on desktop they keep the web layout.

## Run

From the repo root, install once:

```sh
bun install
```

Then from `apps/web`:

```sh
bun run dev        # http://localhost:3000
bun run build      # production build
bun run start      # serve the build
bun run typecheck  # next typegen + tsc
bun run test       # vitest unit tests
bun run lint       # ultracite (oxlint + oxfmt) check
```

Local stack: run the API (`bun run --cwd apps/api dev`, port 8788) with `SIWE_DOMAIN=localhost:3000`, and the gateway (port 8787). Use the web app's host in SIWE_DOMAIN exactly (including the port). The browser reaches the API through this app's `/api` rewrite, so the API needs no CORS setup for it.

## Environment

All optional; the app builds with none. See `.env.example`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `API_ORIGIN` | `http://localhost:8788` | Control-plane API origin, server-only. `/api/:path*` is rewritten to `${API_ORIGIN}/:path*` (baked in at build time); Server Components call it directly |
| `API_URL` | `API_ORIGIN` | Override for Server Component fetches only (e.g. a private address) |
| `NEXT_PUBLIC_GATEWAY_URL` | `http://localhost:8787` | Gateway: agents' base URL (`+ /v1`), node tunnel (`wss://<host>/tunnel`), x402 market route |
| `NEXT_PUBLIC_HEDERA_RPC_URL` | viem public RPC (Hashio) | Hedera testnet JSON-RPC for the wallet (sign-in runs on Hedera testnet) |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` |  | Enables WalletConnect (QR / mobile wallets) |
| `NEXT_PUBLIC_SITE_URL` | `https://rentanllm.vercel.app` | `metadataBase` for Open Graph images, WalletConnect metadata |
| `NEXT_PUBLIC_FARO_URL` |  | Grafana Faro collector (`https://otel.<host>/collect`); Faro is off when unset |
| `NEXT_PUBLIC_FARO_APP_KEY` |  | Alloy's `FARO_APP_KEY` (public, not a secret) |
| `NEXT_PUBLIC_FARO_ENV` | `production` | Faro `app.environment` |

### Production (Vercel project `rentanllm`, https://rentanllm.vercel.app)

Root Directory `apps/web` with "Include files outside the root directory" on; framework Next.js; install `bun install --frozen-lockfile`. No `vercel.json` is needed (crons live on the API project).

| Variable | Value |
| --- | --- |
| `API_ORIGIN` | `https://rentanllm-api.vercel.app` (the API project) |
| `NEXT_PUBLIC_GATEWAY_URL` | `https://gw.<vps-ip-dashed>.sslip.io` |
| `NEXT_PUBLIC_SITE_URL` | `https://rentanllm.vercel.app` |
| `NEXT_PUBLIC_FARO_URL` | `https://otel.<vps-ip-dashed>.sslip.io/collect` |
| `NEXT_PUBLIC_FARO_APP_KEY` | `FARO_APP_KEY` from `deploy/hostinger/.env` |

The API project needs `SIWE_DOMAIN=rentanllm.vercel.app` and no `COOKIE_DOMAIN`. The full table for all three pieces (web, API, gateway) is in [deploy/hostinger/README.md](../../deploy/hostinger/README.md#2-dns). Changing `API_ORIGIN` needs a redeploy, since rewrites are compiled into the build.

## Sessions

Sign-in is ConnectKit's `SIWEProvider` against `/auth/nonce`, `/auth/verify`, `/auth/me` and `/auth/logout` (`lib/siwe.ts`). The API binds each nonce to an address, so the nonce is fetched inside `createMessage`, once ConnectKit knows the address. The browser calls the API same-origin at `<origin>/api/*` (`lib/env.ts` `apiBaseUrl`), which `next.config.ts` rewrites to `API_ORIGIN` with the `/api` prefix stripped. The API sets the `rentanllm_session` cookie (httpOnly, Secure, SameSite=Lax, Path=/, no Domain), so it is host-only on the web app's host: that is what makes sessions work on `*.vercel.app`, a public suffix where two projects can never share a cookie. Server Components read that cookie and forward it to the API directly (`lib/api/server.ts`). The SIWE message's `domain` is `window.location.host`, so the API's `SIWE_DOMAIN` must be the web app's host (`rentanllm.vercel.app`, `localhost:3000` locally).

## Routes

| Route | Screen | Data |
| --- | --- | --- |
| `/` | Landing: what the market is, links to the market, agent setup and the seller console | none |
| `/market` | Market · Models for sale (cheapest online price per model), how to call the gateway, latest paid requests, and the offers and receipts read back from Arkiv | `GET /market/offers`, `GET /market/requests`, Arkiv (Rabdi) query |
| `/agents` | Market · Set up the MCP server so an agent can buy requests within a budget, with Touch ID approval | none |
| `/console` | Seller · Dashboard: sales so far, selling switch + kill switch (pauses every live listing), nodes | `GET /owner/dashboard`, `/owner/listings`, `/owner/sales`; `PATCH /owner/listings/:id`, `POST …/pause` |
| `/console/node` | Seller · Register a node (one-time token, start command) | `POST /owner/nodes` |
| `/console/node/[id]` | Seller · One node: uptime, Ollama account, its listing and price | `GET /owner/nodes/:id/uptime`, `POST /owner/nodes/:id/accounts`, `POST /owner/listings` |
| `/console/sales` | Seller · Totals and recent paid requests | `GET /owner/sales` |
| `/console/settings` | Seller · Listings, status, account | `GET /owner/listings`, `PATCH /owner/listings/:id` |

## Layout

- `lib/api/`: the Effect `HttpApiClient` derived from `RentAnLlmApi` (`client.ts`), plain `ApiResult`/`ApiError` (`errors.ts`), Server Component loaders (`queries.ts`, `server.ts`) and browser actions (`actions.ts`). Effect stays in here.
- `lib/money.ts`: bigint USDC micros, formatting and parsing; never a float.
- `lib/arkiv.ts`: reads the gateway's offers and receipts from Arkiv (server-only, 5 s timeout). Set `ARKIV_WRITER_ADDRESS` to the gateway's writer.
- `components/app-shell/`: the phone app shell: fixed tab bar, large titles, grouped lists, segmented controls, bottom sheets (native modal `<dialog>`), hold-to-confirm, toasts.
- `components/wallet/`: wagmi + ConnectKit + SIWE providers. App routes mount them in their layouts; the landing page loads them lazily for its button only.
- `app/globals.css`: design tokens, safe-area utilities, sheet/toast animations. `lib/tokens.ts` mirrors the palette for JS-only consumers (shaders, manifest, ConnectKit).
- `app/manifest.ts`: installable web app (standalone, starts at `/console`).
- `instrumentation-client.ts` + `lib/faro.ts`: Grafana Faro, loaded only when `NEXT_PUBLIC_FARO_URL` is set.

## End-to-end tests (Playwright)

```sh
bunx playwright install chromium     # once
bun run build && bun run test:e2e    # starts `next start` on :3100 itself
```

`e2e/` runs Chromium only. The API is never contacted: the market and console are rendered from a stub API (`e2e/stub-api.ts`, started by the Playwright config and used as `API_ORIGIN`), and browser calls to `/api/*` are intercepted with `page.route`. Reports land in `playwright-report/` and `test-results/` (both gitignored).
