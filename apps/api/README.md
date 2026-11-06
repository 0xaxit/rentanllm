# @rentanllm/api

Control-plane API for the open-model market: wallet sign-in, sellers' nodes and listings, what each seller has sold, the public market reads, and a per-minute job that marks silent nodes offline. Payments themselves never pass through here: agents pay sellers directly over x402 on Hedera, at the gateway.

- Contract: `@rentanllm/api-contract` (Effect `HttpApi`). Derive a typed client with `HttpApiClient.make(RentAnLlmApi)`; OpenAPI at `GET /openapi.json`.
- Runtime: Vercel Node.js function (Fluid compute), Postgres on Neon (`DATABASE_URL`), shared with the gateway.
- Money is integer USDC micros (`bigint`), sent in JSON as a decimal string (`"19200000"` = $19.20). Instants are ISO-8601 UTC strings.

## Hosting

The web app is `https://rentanllm.xyz` (`rentanllm.xyz` redirects there) and the API is its own Vercel project. Browsers reach it **same-origin** through a Next.js rewrite in the web app, `https://rentanllm.xyz/api/:path*` → the API project, with the `/api` prefix stripped (so `/api/auth/me` arrives here as `/auth/me`). Server-side code in the web app calls the API project's URL directly and forwards the `Cookie` header. Production settings:

- `SIWE_DOMAIN=rentanllm.xyz` (the host the user signs in on)
- `COOKIE_DOMAIN` unset: the session cookie is host-only on `rentanllm.xyz` (`Set-Cookie` carries no `Domain` attribute) with `Path=/`, so it is sent to every `/api/*` call
- `WEB_ORIGINS=https://rentanllm.xyz` (CORS only matters for direct cross-origin calls; the rewrite is same-origin)

Nothing assumes the API sits at the root of its own host: there are no redirects or absolute URLs in responses, and `/openapi.json` declares no `servers` (behind the rewrite its paths are relative to `/api`). The every-minute cron calls (Hostinger `scheduler`, or Vercel Cron on Pro) go to the API project directly.

## Endpoints

Auth: the session cookie `rentanllm_session` (httpOnly, Secure, SameSite=Lax). Browsers send it with `credentials: "include"`.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | none | `{"status":"ok"}` |
| GET | `/openapi.json` | none | OpenAPI 3.1 document |
| POST | `/auth/nonce` | none | `{address}` → single-use SIWE nonce (10 min) |
| POST | `/auth/verify` | none | `{message, signature}` (EIP-4361) → user + session cookie; creates the user on first sign-in |
| POST | `/auth/logout` | cookie | Deletes the session, clears the cookie |
| GET | `/auth/me` | cookie | Current user |
| GET | `/pricing/suggestion?provider&model[&inputPerMtokUsdc&outputPerMtokUsdc]` | none | API list price (`api_price_refs`), suggested 40%, fair band 30-50%, optional verdict |
| GET | `/market/offers` | none | Live open-model listings for sale, with each seller's wallet and whether their node is online |
| GET | `/market/requests[?limit]` | none | Latest paid market requests (default 25, max 100), each with its payment transaction |
| POST | `/owner/nodes` | cookie | Registers a node. Returns `node` (its `id` is the tunnel's node id) and `nodeToken` **once**; only `sha256(token)` is stored in `nodes.node_token_hash` |
| GET | `/owner/nodes` | cookie | Owner's nodes |
| POST | `/owner/nodes/:nodeId/accounts` | cookie | Turns on selling open models from the node (`provider: "ollama"`; anything else is 422). The tier is what the node reported |
| GET | `/owner/listings` | cookie | Owner's listings |
| POST | `/owner/listings` | cookie | Creates a listing: one Ollama model name, input and output price per million tokens, `status` draft or live |
| PATCH | `/owner/listings/:listingId` | cookie | Updates any listing field, including `status` |
| POST | `/owner/listings/:listingId/pause` | cookie | Sets `status = paused` |
| GET | `/owner/dashboard` | cookie | The owner's nodes and their provider accounts |
| GET | `/owner/sales` | cookie | What the owner's listings sold: totals for the last 24 h and to date, and the latest 50 paid requests |
| POST | `/approvals` | none | `{payer, payTo, amountUsdc, network, description[, expectedSubject]}`: starts a World ID Agent Pass approval of that one payment. Returns the approval (World's link and code) and its `secret` **once** |
| POST | `/approvals/:id/check` | `{secret}` | Polls World (at most once per interval), validates the ID token, returns the approval's state |
| POST | `/approvals/:id/consume` | `{secret, amountUsdc, payTo}` | Uses an `approved` approval once, for exactly that amount and payee (409 otherwise) |
| POST | `/approvals/:id/cancel` | `{secret}` | Cancels a pending or approved approval; it can never be used afterwards |
| GET | `/cron/tick` | `Bearer $CRON_SECRET` | Marks nodes offline whose last heartbeat is older than `NODE_STALE_SECONDS` |

Errors are JSON `{"_tag": "...", "message": "..."}`: `Unauthorized` 401, `NotFound` 404, `Conflict` 409, `InvalidRequest` 422, `Unavailable` 503 (World ID not configured or not reachable). Schema failures are 400.

## Environment

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes |  | Postgres. On Vercel: Neon's pooled URL |
| `DB_MAX_CONNECTIONS` |  | `5` | Pool size per instance; use 1-3 on Vercel |
| `SESSION_SECRET` | yes |  | ≥ 32 chars; HMAC key for stored session-token hashes |
| `CRON_SECRET` | yes |  | ≥ 32 chars; Vercel sends it as `Authorization: Bearer …` to cron paths |
| `SIWE_DOMAIN` | yes |  | The `domain` SIWE messages must carry: the web app's host, `rentanllm.xyz` |
| `WEB_ORIGINS` |  |  | Comma-separated origins allowed by CORS with credentials: `https://rentanllm.xyz` |
| `COOKIE_DOMAIN` |  | host-only | Leave unset behind the `/api` rewrite. Only for web and API on sibling subdomains, e.g. `.rentanllm.xyz` |
| `SESSION_TTL_HOURS` |  | `168` | Session lifetime |
| `SIWE_NONCE_TTL_SECONDS` |  | `600` | Nonce lifetime |
| `NODE_STALE_SECONDS` |  | `90` | Heartbeat age after which a node is marked offline |
| `WORLD_ID_CLIENT_ID` |  |  | World IdP client id. With the secret, turns on `/approvals` |
| `WORLD_ID_CLIENT_SECRET` |  |  | World IdP client secret (`client_secret_post`). Only sent to World |
| `WORLD_ID_ISSUER` |  | `https://sandbox.auth.world.org` | `https://auth.world.org` for production identities |
| `WORLD_ID_ACCEPTED_ACR` |  | any | Comma-separated `acr` values to accept, e.g. `https://world.org/oidc/acr/orb` |
| `HEDERA_RPC_URL` |  |  | Hedera testnet JSON-RPC (e.g. `https://testnet.hashio.io/api`); enables ERC-1271/6492 smart-wallet sign-in |
| `OTEL_EXPORTER_OTLP_ENDPOINT` |  | off | OTLP/HTTP base URL, e.g. `https://otel.rentanllm.xyz`; `/v1/traces` and `/v1/logs` are appended |
| `OTEL_EXPORTER_OTLP_HEADERS` |  |  | `Authorization=Bearer%20<token>` (values URL-encoded: write the space as `%20`) |
| `OTEL_SERVICE_NAME` |  | `rentanllm-api` | Service name on spans and logs |

Logs are JSON outside development. Spans and logs are exported with Effect's built-in OTLP exporters (`effect/observability`, as the gateway does) and flushed after every invocation inside `waitUntil` from `@vercel/functions`, so short invocations do not lose them.

## Deploy (Vercel)

One Vercel project with Root Directory `apps/api` ("Include files outside the root directory" on, for the workspace packages).

- `vercel.json` sets `bun install`, `bun run build` and the `/cron/tick` cron. It is daily (`5 0 * * *`, UTC) because the Hobby plan only allows daily crons; the every-minute call comes from the `scheduler` service in `deploy/hostinger` (`API_CRON_ORIGIN` + `CRON_SECRET`). On a Pro plan, change the schedule to `* * * * *` and leave `API_CRON_ORIGIN` empty.
- `bun run build` (`scripts/build-vercel.ts`) bundles `src/vercel.ts` with Bun into one ESM file and writes the [Build Output API v3](https://vercel.com/docs/build-output-api/v3) directly: `.vercel/output/functions/index.func` (Node.js 22, `maxDuration` 300 s, set in `FUNCTION_CONFIG`) and `config.json` routing every path to it, while Vercel registers the crons from `vercel.json`. Bundling is needed because the workspace packages export TypeScript with extensionless imports, which Node cannot load directly.
- `src/vercel.ts` builds the app once per instance with `HttpRouter.toWebHandler(AppLive)` (Effect 4) and adapts the resulting `(Request) => Promise<Response>` to Node's `(req, res)` (`src/node-adapter.ts`).

Schema sync never runs inside functions. Run it as a deploy step before promoting a build, against Neon's direct (unpooled) URL:

```sh
DATABASE_URL="$DATABASE_URL_UNPOOLED" bun run --cwd apps/api db:sync
```

## Develop and test

```sh
bun run --cwd apps/api dev          # http://localhost:8788, reads apps/api/.env
bun run --cwd apps/api typecheck
bun run --cwd apps/api test         # unit tests; integration tests too when DATABASE_URL is set
```

Integration tests need a disposable Postgres 17. Use port 54349 for the API's own container (54329 is packages/db's dev database; 54339 and 63799 belong to the gateway's test compose):

```sh
docker run -d --name rentanllm-api-test-pg -p 54349:5432 \
  -e POSTGRES_DB=rentanllm -e POSTGRES_USER=rentanllm -e POSTGRES_PASSWORD=rentanllm postgres:17-alpine
bun run --cwd apps/api test:integration   # DATABASE_URL defaults to localhost:54349
docker rm -f rentanllm-api-test-pg
```

Each integration test file drops and recreates its own database (`<db>_api_http`) and migrates it; it only connects to the `DATABASE_URL` database to run `CREATE DATABASE`. So the root `bun run test` (all workspaces in parallel against one Postgres in CI) cannot collide with packages/db, whose test drops the `public` schema of the `DATABASE_URL` database. The role needs `CREATEDB`.

Tests use throwaway wallets generated per run; no real keys.
