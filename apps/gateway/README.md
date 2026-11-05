# @rentanllm/gateway

Edge gateway for the open-model market. Agents call an OpenAI-compatible API with no account or key; the gateway quotes a price, takes the payment over x402 on Hedera testnet straight to the seller, forwards the request over a WebSocket tunnel to the seller's node agent, and streams the answer back.

## Run

```sh
bun install                                      # from the repo root
bun run --filter @rentanllm/gateway dev          # build + run, http://localhost:8787
bun run --filter @rentanllm/gateway test         # unit + in-memory end-to-end tests
bun run --filter @rentanllm/gateway test:integration   # Docker Postgres + Redis
bun run --filter @rentanllm/gateway typecheck
```

The workspace packages (`@rentanllm/core`, `/db`, `/protocol`) ship TypeScript source, so `bun run build` bundles the gateway into `dist/main.js`, which runs on Node 22+. `dev` builds once and starts; re-run it after a change.

With `STORE=memory` (the default) every store is in memory, seeded from `fixtures/dev-seed.json`. The node token in that file is for local use only.

Docker (build from the repo root):

```sh
docker build -f apps/gateway/Dockerfile -t rentanllm-gateway .
docker run -p 8787:8787 --env-file gateway.env rentanllm-gateway        # STORE=postgres by default
docker run -p 8787:8787 -e STORE=memory rentanllm-gateway               # dev seed
```

In production the gateway runs in Docker on the VPS next to Redis and Grafana Alloy; Postgres is Neon, shared with the control-plane API.

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/v1/chat/completions` | none (x402 payment) | Buy one OpenAI-style chat completion from the cheapest online seller; see [Market](#market-pay-per-request) |
| GET | `/v1/models` | none | Models for sale, sellers online, cheapest prices |
| GET | `/tunnel` | node token | WebSocket for node agents |
| GET | `/healthz` | none | Liveness and connected nodes |

Before forwarding, the gateway removes buyer credentials (including x402 payment headers), hop-by-hop headers, `host`, `content-length`, `accept-encoding`, cookies and `x-forwarded-*`. Back to the buyer it passes only `content-type`, `request-id` and `retry-after` from the provider, plus its own `x-rentanllm-request-id`, `PAYMENT-RESPONSE`, `x-rentanllm-listing` and `x-rentanllm-paid-usdc`.

## Market (pay per request)

`POST /v1/chat/completions` sells one OpenAI-style chat completion at a time, with no account or key. The checks, in order:

| Check | Status |
| --- | --- |
| Market off (`MARKET_ENABLED=false`) | 404 |
| Malformed body, or `max_tokens` above `MARKET_MAX_TOKENS_CEILING` | 400 |
| No live open-model (`ollama`) listing sells `model` | 404 |
| No seller of it is online, or none has a Hedera account | 503 |
| No payment yet | 402 with the cheapest online sellers' terms (`MARKET_QUOTED_OFFERS`, cheapest first) |
| Payment does not match any current terms, or the facilitator refuses it | 402 |
| The chosen seller's `max_concurrency` is used up (nothing charged) | 429 |

The price is the prompt (a ~4 chars/token estimate plus 25% headroom and 8 tokens per message) plus the full `max_tokens` (default `MARKET_DEFAULT_MAX_TOKENS`) at the listing's prices, at least 1 micro-USDC. The gateway enforces that `max_tokens` on the forwarded request, so an answer never costs more than was paid. Unused output is not refunded.

The payment goes straight to the seller, in USDC (`0.0.429274`) on Hedera testnet: to the `0.0.x` account the mirror node (`HEDERA_MIRROR_URL`) finds for the seller's sign-in wallet, with the facilitator's `feePayer` from its `/supported` list. A seller with no Hedera account is left out of quotes. Each request is one `paid_requests` row (`request_id` and `payment_tx` unique) with what was paid and what the usage cost at the listing's prices. A request whose seller fails after the payment settled is recorded as `error`, and its error response still carries `PAYMENT-RESPONSE`, `x-rentanllm-paid-usdc`, `x-rentanllm-listing` and `x-rentanllm-request-id`.

### Arkiv

With `ARKIV_PRIVATE_KEY` set, the gateway mirrors the market to Arkiv's Rabdi testnet (`packages/arkiv`), so anyone can read it without our API:

- Every `ARKIV_SYNC_SECONDS`, one `rentanllm.offer` entity per (listing, model) is created or patched, with a 15-minute TTL. Offers no longer listed are deleted, all in one transaction.
- Each recorded paid request becomes a `rentanllm.receipt` entity (30-day TTL) pointing at its payment transaction.

Writes run in the background. A failed write is logged and never affects a request. The writer needs testnet tGLM for gas.

## Storage

`STORE=postgres` uses:

| What | Where | Notes |
| --- | --- | --- |
| Live listings sold on the market | Postgres | open-model (`ollama`) listings only; cached in process for `GATEWAY_AUTH_CACHE_TTL_MS` (5 s) |
| Paid requests | Postgres `paid_requests` | one row per request; `request_id` and `payment_tx` unique |
| Listing concurrency | Redis | sorted set of holders scored by lease expiry (`GATEWAY_CONCURRENCY_LEASE_MS`, refreshed while a request runs); released when the request ends |
| Node auth | Postgres `nodes.node_token_hash` | SHA-256 hex of the node token; disabled nodes are refused; the node must send its `nodes.id` as `NodeHello.nodeId` |
| Node meters, heartbeats | in process, written to `provider_accounts` and `nodes.last_heartbeat_at`/`status` at most every `GATEWAY_METER_PERSIST_INTERVAL_MS` per node |  |

Redis uses `redis` (node-redis) through `NodeRedis` from `@effect/platform-node`.

## Tunnel

The node connects to `/tunnel` with its token, then must send `NodeHello` (matching `nodeId`, `protocolVersion` 1) within `GATEWAY_NODE_HELLO_TIMEOUT_MS`. The gateway answers with `SetAvailability` when it knows one (Postgres: open when any of the node's listings is live, with the strictest cut-offs among them). Frames follow `@rentanllm/protocol`. Close codes: 4002 protocol error, 4003 token/nodeId mismatch, 4004 no hello, 4008 missed heartbeats, 4009 replaced by a newer connection from the same node.

## Telemetry

With `OTEL_EXPORTER_OTLP_ENDPOINT` set (Alloy's OTLP/HTTP receiver, e.g. `http://alloy:4318`), traces, metrics and logs are exported over OTLP/HTTP JSON by Effect's built-in exporter (`effect/observability/Otlp`). Logs also go to stdout. Counters are monotonic (`incremental`), so Prometheus types them as counters; Alloy runs with `add_metric_suffixes = false`, so the names below are kept exactly (no `_total`). Metrics:

| Metric | Type | Attributes |
| --- | --- | --- |
| `gateway_requests` | counter | `status`, `status_class`, `outcome` (`ok`, `error`, `cancelled`, `refused`) |
| `gateway_node_heartbeats` | counter | heartbeat frames from nodes |
| `gateway_tokens` | counter | `kind` (`input`, `output`, `cache_read`, `cache_write`) |
| `gateway_cost_micros` | counter |  |
| `gateway_request_duration_ms` | histogram |  |
| `gateway_active_tunnels` | gauge | open tunnel sockets |
| `gateway_nodes_connected` | gauge | nodes past hello |

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8787` | Listen port |
| `HOST` | `0.0.0.0` | Listen address |
| `LOG_FORMAT` | `json` | `json` or `pretty` |
| `STORE` | `memory` (`postgres` in the Docker image) | `memory` or `postgres` |
| `DATABASE_URL` |  | Postgres (Neon) connection string; `STORE=postgres` |
| `DB_MAX_CONNECTIONS` | `5` | Postgres pool size |
| `REDIS_URL` |  | e.g. `redis://redis:6379`; `STORE=postgres` |
| `GATEWAY_SEED_FILE` | `fixtures/dev-seed.json` | Seed for `STORE=memory` |
| `MARKET_ENABLED` | `true` | Serve `/v1/chat/completions` and `/v1/models` |
| `MARKET_DEFAULT_MAX_TOKENS` | `1024` | `max_tokens` quoted and enforced when a request sets none |
| `MARKET_MAX_TOKENS_CEILING` | `32768` | Largest `max_tokens` a market request may ask for |
| `MARKET_QUOTED_OFFERS` | `3` | Online sellers listed in one 402 |
| `HEDERA_MIRROR_URL` | `https://testnet.mirrornode.hedera.com` | Finds sellers' Hedera accounts |
| `ARKIV_PRIVATE_KEY` |  | Arkiv writer key; empty leaves Arkiv out |
| `ARKIV_ACCESS_KEY` |  | Arkiv Hub access key; empty uses the rate-limited public RPC |
| `ARKIV_SYNC_SECONDS` | `180` | How often offers are re-published |
| `X402_FACILITATOR_URL` | `https://x402.org/facilitator` | x402 facilitator |
| `X402_FACILITATOR_TIMEOUT_MS` | `30000` | Per facilitator call |
| `X402_MAX_TIMEOUT_SECONDS` | `300` | Validity offered for the payer's authorization |
| `GATEWAY_PUBLIC_URL` | `http://localhost:8787` | Public base URL, shown as the x402 resource |
| `OTEL_EXPORTER_OTLP_ENDPOINT` |  | OTLP/HTTP base URL; unset disables export |
| `OTEL_SERVICE_NAME` | `rentanllm-gateway` |  |
| `GATEWAY_VERSION` | `dev` | Reported as `service.version` |
| `DEPLOY_ENV` | `development` | Reported as `deployment.environment` |
| `GATEWAY_HEAD_TIMEOUT_MS` | `120000` | Wait for the node's response head, then 504 |
| `GATEWAY_CANCEL_USAGE_WAIT_MS` | `2000` | After a buyer cancels, wait for the node's partial usage |
| `GATEWAY_NODE_HELLO_TIMEOUT_MS` | `10000` | Wait for `NodeHello` after a node connects |
| `GATEWAY_MAX_BODY_BYTES` | `10485760` | Largest accepted request body |
| `GATEWAY_AUTH_CACHE_TTL_MS` | `5000` | Market offer cache |
| `GATEWAY_CONCURRENCY_LEASE_MS` | `600000` | Redis concurrency-slot lease |
| `GATEWAY_METER_PERSIST_INTERVAL_MS` | `30000` | Meter/heartbeat writes per node |

## Tests

- `test/units.test.ts`, `test/market.test.ts`: in-memory stores, a real HTTP server and a fake node over a real WebSocket, a fake x402 facilitator (`test/fake-facilitator.ts`) and a stub Hedera mirror node.
- `test/integration/`: starts Postgres 17 and Redis 7 with `docker-compose.test.yml` (project `rentanllm-gateway-test`, ports 54339 and 63799, so it never touches the packages/db dev database), migrates with `@rentanllm/db`, runs, and removes the containers. `GATEWAY_TEST_KEEP_CONTAINERS=1` keeps them. Covers the Postgres market store, concurrency slots across two processes, and node auth plus heartbeat persistence.

## Code map

- `src/app.ts`: routes and the `gatewayLayer` used by `main.ts` and the tests.
- `src/market/`: quoting (`quote.ts`), Hedera payment terms and accounts (`terms.ts`, `hedera-accounts.ts`), the route (`route.ts`), usage accounting (`accounting.ts`), `/v1/models` (`models.ts`) and the Arkiv mirror (`arkiv-mirror.ts`).
- `src/proxy.ts`: forwarding over the tunnel and streaming back.
- `src/tunnel/tunnel-hub.ts`: node connections, request routing, heartbeats.
- `src/services/*.ts`: store interfaces; `memory.ts` (all in memory), `postgres-*.ts`, `redis-rate-limiter.ts`.
- `src/stores.ts`: `STORE` selection. `src/telemetry.ts`, `src/metrics.ts`: OTLP export and metrics.
- `src/x402/`: Hedera chain, facilitator client, settlement.
