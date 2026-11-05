# Hostinger edge box

One VPS (Ubuntu 24.04, ~8 GB RAM) running Docker Compose. Vercel hosts `apps/web` (https://rentanllm.vercel.app) and `apps/api` (a second project, e.g. https://rentanllm-api.vercel.app); Neon hosts Postgres. Until the project has a domain, this box is reached through [sslip.io](https://sslip.io) names derived from its IP (`gw.203-0-113-7.sslip.io`); see [DNS](#2-dns). This box runs everything that needs long-lived connections or keeps state of its own:

| Service | Image | Role | Network |
| --- | --- | --- | --- |
| `caddy` | `caddy:2.11.7-alpine` | HTTPS for `gw.`, `otel.`, `grafana.`; the only container with published ports (80, 443/tcp, 443/udp) | edge |
| `gateway` | `apps/gateway/Dockerfile` (GHCR or built on the box) | Renter API `/v1/messages` (SSE) and owner WebSocket `/tunnel` | edge, internal |
| `redis` | `redis:8.10.2-alpine` | Rate limits and budgets. Password, AOF, `noeviction` | internal |
| `alloy` | `grafana/alloy:v1.21.2` | OTLP receiver (gRPC 4317, HTTP 4318), Docker log tailing, probes, scrapes | edge, internal |
| `tempo` | `grafana/tempo:2.10.10` | Traces, 7 days | internal |
| `loki` | `grafana/loki:3.7.9` | Logs, 7 days | internal |
| `prometheus` | `prom/prometheus:v3.15.1` | Metrics, 7 days or 8 GB | internal |
| `grafana` | `grafana/grafana:13.2.4` | Dashboards and alerting | edge, internal |
| `docker-socket-proxy` | `tecnativa/docker-socket-proxy:v0.5.0` | Read-only Docker API for Alloy (no raw socket in Alloy) | internal |
| `hc-tools`, `tempo-init` | `busybox:1.37.0-musl` | One-shot: copy a static busybox for the distroless healthchecks; chown Tempo's volume | none |

`internal` is a Docker `internal: true` network: no egress and nothing published. Redis, Tempo, Loki and Prometheus can only be reached from inside the stack.

## Telemetry flow

```
Vercel functions (apps/api, apps/web)
  └─ OTLP/HTTP + "Authorization: Bearer $OTEL_INGEST_TOKEN"
       └─ https://otel.<DOMAIN>/v1/{traces,metrics,logs}   (Caddy checks the token; 401 otherwise)
            └─ alloy:4318 ─┐
Browsers on https://rentanllm.vercel.app (Grafana Faro, apps/web)
  └─ https://otel.<DOMAIN>/collect  (Caddy: Origin must be FARO_ALLOWED_ORIGIN; Alloy: CORS + app key)
       └─ alloy:12347 faro.receiver ─ logs, errors, web vitals → Loki {service_name="rentanllm-web"}
gateway ── OTLP/HTTP ──────┤  (plain HTTP on the Docker network, http://alloy:4318)
                           ├─ traces  → tempo:4317 (OTLP gRPC) ─ span metrics → Prometheus
                           ├─ metrics → Prometheus remote write
                           └─ logs    → loki:3100/otlp
Docker stdout of every container → docker-socket-proxy → Alloy → Loki   (label service_name=<compose service>)
Alloy probes http://gateway:8787/healthz (probe_success), scrapes Caddy, Redis, Tempo, Loki, itself → Prometheus
Grafana ← Prometheus, Loki, Tempo (trace ↔ log ↔ metric links provisioned)
```

**Why Alloy pushes to Prometheus (remote write) and Prometheus scrapes nothing but itself:** Vercel functions are short-lived and cannot be scraped, so their metrics arrive as OTLP pushes no matter what. With one push path, every metric (Vercel, gateway, probes, infra scrapes) goes through the same Alloy pipeline, has the same `env` label, and is buffered in Alloy's WAL while Prometheus restarts. Prometheus stays a plain store with `--web.enable-remote-write-receiver`.

## Files

| File | What |
| --- | --- |
| `compose.yaml` | The stack. Resource limits, healthchecks, networks, volumes |
| `Caddyfile` | Sites `gw.`, `otel.` (OTLP + Faro `/collect`), `grafana.` plus the internal metrics listener `:9180` |
| `.env.example` | Stack settings and secrets (domain, Redis password, OTLP token, Faro origin + app key, Grafana admin, alert webhook) |
| `gateway.env.example` | Gateway app settings and secrets (`DATABASE_URL`, x402, tuning). Passed as-is to the gateway |
| `deploy.sh` | Idempotent deploy/update |
| `alloy/config.alloy` | Pipelines described above |
| `tempo/tempo.yaml`, `loki/loki.yaml`, `prometheus/prometheus.yaml` | Storage configs, 7-day retention |
| `grafana/provisioning/` | Datasources, dashboard provider, alerting (contact point, policy, rules) |
| `grafana/dashboards/rentanllm-gateway.json` | "RentAnLLM gateway" dashboard |

## RAM budget (8 GB box)

| Service | Limit | Idle (measured locally) |
| --- | --- | --- |
| gateway | 1 GiB (`--max-old-space-size=768`) | ~70 MiB |
| prometheus | 1 GiB | ~85 MiB |
| loki | 1 GiB | ~150 MiB |
| tempo | 768 MiB | ~80 MiB |
| grafana | 768 MiB | ~280 MiB |
| alloy | 512 MiB (memory_limiter at 350 MiB) | ~150 MiB |
| caddy | 256 MiB | ~20 MiB |
| redis | 256 MiB (`maxmemory 192mb`) | ~15 MiB |
| docker-socket-proxy | 64 MiB | ~26 MiB |
| **Sum of limits** | **5.6 GiB** | **~0.9 GiB** |
| OS, Docker daemon, page cache | ~2.4 GiB |  |
| Swap | 2 GiB (safety net, `swappiness=10`) |  |

Limits are ceilings, not reservations, so the box normally sits far below them. If you move to a 4 GB plan, halve Loki, Prometheus and Tempo first.

## 1. Provision a fresh Ubuntu VPS

Run as root once, then work as `deploy`.

```sh
# Base packages and automatic security updates
apt-get update && apt-get -y upgrade
apt-get install -y ca-certificates curl git ufw unattended-upgrades fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades

# Non-root deploy user with your SSH key
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/ && chown deploy:deploy /home/deploy/.ssh/authorized_keys
echo 'deploy ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/deploy   # or set a password instead

# SSH: keys only, no root login
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/; s/^#\?PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl restart ssh

# Firewall: 22, 80, 443 only (443/udp is HTTP/3)
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

# 2 GiB swap
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf && sysctl --system

# Docker Engine + Compose plugin from Docker's apt repo
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
usermod -aG docker deploy
```

Docker writes its own iptables rules and bypasses ufw for published ports. That is fine here because only Caddy publishes anything; never add `ports:` to another service. Hostinger's panel firewall can mirror the same 22/80/443 rule as a second layer.

## 2. DNS

### Current setup: no domain, sslip.io

The web app and the API live on `*.vercel.app` for now, and this box has no domain of its own. [sslip.io](https://sslip.io) is a public DNS service that answers any name containing an IP with that IP: `gw.203-0-113-7.sslip.io` resolves to `203.0.113.7`. Caddy gets real Let's Encrypt certificates for those names like for any other (HTTP-01 on port 80), so there is nothing to register or configure:

```sh
# on the VPS
IP=$(curl -4 -s https://ifconfig.me)        # e.g. 203.0.113.7
echo "DOMAIN=${IP//./-}.sslip.io"           # DOMAIN=203-0-113-7.sslip.io -> put it in .env
```

That gives `https://gw.<ip-dashed>.sslip.io` (gateway), `https://otel.<ip-dashed>.sslip.io` (OTLP and Faro) and `https://grafana.<ip-dashed>.sslip.io`. If the VPS IP ever changes, so do these names: update `.env`, redeploy, and update the Vercel variables below. sslip.io is on the Public Suffix List, so Let's Encrypt's per-domain rate limits apply per IP, not to sslip.io as a whole.

The web app proxies the API under its own origin (`https://rentanllm.vercel.app/api/*` is rewritten to the API project by `apps/web/next.config.ts`). `*.vercel.app` is a public suffix, so the two Vercel projects could not share a cookie; through the rewrite the browser only ever talks to `rentanllm.vercel.app` and the session cookie is host-only there. Server Components call the API project directly and forward the cookie.

Production values that tie the pieces together (replace `203-0-113-7` with your VPS IP, dashed, and `rentanllm-api` with the API project's name):

| Where | Variable | Value |
| --- | --- | --- |
| API (Vercel) | `SIWE_DOMAIN` | `rentanllm.vercel.app` (the web app's host: SIWE messages are signed there) |
| API (Vercel) | `COOKIE_DOMAIN` | unset (host-only cookie, set through the web app's `/api` rewrite) |
| API (Vercel) | `WEB_ORIGINS` | `https://rentanllm.vercel.app` (CORS for direct callers; the browser itself is same-origin) |
| API (Vercel) | `OTEL_EXPORTER_OTLP_ENDPOINT` | `https://otel.203-0-113-7.sslip.io` |
| Web (Vercel) | `API_ORIGIN` | `https://rentanllm-api.vercel.app` (server-only; read at build time by the rewrite, at runtime by Server Components) |
| Web (Vercel) | `NEXT_PUBLIC_GATEWAY_URL` | `https://gw.203-0-113-7.sslip.io` |
| Web (Vercel) | `NEXT_PUBLIC_SITE_URL` | `https://rentanllm.vercel.app` |
| Web (Vercel) | `NEXT_PUBLIC_FARO_URL` | `https://otel.203-0-113-7.sslip.io/collect` |
| Web (Vercel) | `NEXT_PUBLIC_FARO_APP_KEY` | the same value as `FARO_APP_KEY` here |
| Gateway (`gateway.env`) | `WEB_ORIGINS` | `https://rentanllm.vercel.app` |
| Gateway (compose) | `GATEWAY_PUBLIC_URL` | `https://gw.${DOMAIN}`, set by compose.yaml |
| Stack (`.env`) | `DOMAIN` | `203-0-113-7.sslip.io` |
| Stack (`.env`) | `FARO_ALLOWED_ORIGIN` | `https://rentanllm.vercel.app` |

SIWE only works on the host in `SIWE_DOMAIN`, so sign-in fails on Vercel preview URLs (`rentanllm-git-…vercel.app`) unless a preview API project uses the preview host. Keep Vercel Deployment Protection off for the API project's production deployment (the default Standard Protection covers previews only); otherwise the web app's proxy and Server Components get Vercel's login page instead of JSON.

### Later: rentanllm.xyz

When the domain is bought, point three records at the VPS IP (A, plus AAAA if it has IPv6): `gw.rentanllm.xyz`, `otel.rentanllm.xyz`, `grafana.rentanllm.xyz`, and set `DOMAIN=rentanllm.xyz`. Add `rentanllm.xyz` and `www.rentanllm.xyz` to the web project in Vercel (redirect `www` to the apex so SIWE always sees `rentanllm.xyz`). The `/api` rewrite keeps working unchanged, so the API project does not need a custom domain; give it `api.rentanllm.xyz` only if something outside the browser calls it. Then change the values above: `SIWE_DOMAIN=rentanllm.xyz`, `WEB_ORIGINS` and `FARO_ALLOWED_ORIGIN` to `https://rentanllm.xyz` (gateway: also `https://www.rentanllm.xyz`), `NEXT_PUBLIC_SITE_URL=https://rentanllm.xyz`, and every `*.sslip.io` URL to `*.rentanllm.xyz`.

Caddy gets Let's Encrypt certificates on first request, so the names must resolve before the first deploy (sslip.io names always do).

### Hosts that already run Traefik on 80/443

Set `EDGE_MODE=traefik` in `.env` (plus `TRAEFIK_NETWORK` and `TRAEFIK_CERT_RESOLVER` if they differ from `root_default` / `mytlschallenge`). `deploy.sh` then adds `compose.traefik.yaml`: Caddy publishes no ports, joins Traefik's Docker network and serves plain HTTP (`SITE_SCHEME=http://`), and Traefik routes `gw.`, `otel.` and `grafana.<DOMAIN>` to it with its own Let's Encrypt resolver. The existing Traefik configuration is not changed. Verified on the current box: valid certificates, SSE streaming, and node WebSocket tunnels that stay open past Traefik's 60 s read timeout.

### Every-minute scheduler

On Vercel Hobby, crons run once a day, so the `scheduler` service calls the API's `/cron/tick` every minute. Set `API_CRON_ORIGIN` to the API project's own URL (e.g. `https://rentanllm-api.vercel.app`) and `CRON_SECRET` to the API's value. `docker logs rentanllm-scheduler-1` shows one line per call with its status code.

## 3. First deploy

```sh
# as deploy
git clone <repo-url> ~/rentanllm && cd ~/rentanllm/deploy/hostinger
cp .env.example .env && chmod 600 .env                 # fill in; secrets: openssl rand -hex 32
cp gateway.env.example gateway.env && chmod 600 gateway.env
# The Neon database must be synced first (from a laptop or CI):
#   DATABASE_URL=<neon direct url> bun run --cwd packages/db db:sync
# GHCR package private? Log in once with a PAT that has read:packages:
#   echo "$PAT" | docker login ghcr.io -u <github-user> --password-stdin
./deploy.sh                 # pulls GATEWAY_IMAGE
# or: ./deploy.sh --build   # builds apps/gateway/Dockerfile from this checkout
```

Check: `curl https://gw.<DOMAIN>/healthz` (e.g. `https://gw.203-0-113-7.sslip.io/healthz`) returns `{"status":"ok",...}`, and `https://grafana.<DOMAIN>` shows the "RentAnLLM gateway" dashboard in the RentAnLLM folder.

## 4. Updates and rollback

```sh
cd ~/rentanllm && git pull          # picks up config changes under deploy/hostinger
cd deploy/hostinger
./deploy.sh                         # same tag (e.g. :main) re-pulled
./deploy.sh --tag v0.3.1            # a release tag
./deploy.sh --tag v0.3.0            # rollback = deploy the previous tag
```

What `deploy.sh` does, in order: validates `.env` (refuses `change-me` placeholders), fetches all images before touching anything, `up -d --wait` for the infrastructure (only services whose image or config changed are recreated; config changes are detected with a hash label per service), then recreates the gateway alone and waits for its healthcheck, then `caddy reload` (graceful, keeps TLS state and open tunnels).

Expected impact of a gateway update: Caddy holds new renter requests for up to 30 s (`lb_try_duration`) while the new container starts. Locally, a restart under a 4 req/s loop gave 0 failed requests and at most ~5 s added latency. In-flight streams get 30 s (`stop_grace_period`) to finish. Owner node tunnels are cut and the node agents reconnect. True zero downtime needs shared tunnel state, which the in-memory tunnel hub does not have.

## 5. Point Vercel at the collector

In each Vercel project (`apps/api`, and `apps/web` if it exports telemetry), set for Production (and Preview if you want it):

```
OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.203-0-113-7.sslip.io   # https://otel.<DOMAIN>
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer%20<OTEL_INGEST_TOKEN>
OTEL_SERVICE_NAME=rentanllm-api                # rentanllm-web for the web app
OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=production
```

The space in the header value must be written `%20` (the OTel spec URL-decodes header values). OTLP exporters append `/v1/traces`, `/v1/metrics`, `/v1/logs` to the endpoint; those are the only paths Caddy forwards. A function must flush its exporters before it returns (`forceFlush()` in `waitUntil`), or spans from short invocations are lost.

Quick test from a laptop:

```sh
curl -i -X POST https://otel.<DOMAIN>/v1/traces \
  -H "Authorization: Bearer $OTEL_INGEST_TOKEN" -H 'Content-Type: application/json' \
  -d '{"resourceSpans":[]}'        # 200 with the token, 401 without
```

### Browser telemetry (Grafana Faro)

`apps/web` starts the Faro web SDK when `NEXT_PUBLIC_FARO_URL` is set (errors, web vitals, sessions, page views; no tracing). It posts to `https://otel.<DOMAIN>/collect`, which Caddy forwards to Alloy's `faro.receiver` (port 12347 on the Docker network) only when the `Origin` header is `FARO_ALLOWED_ORIGIN`. Alloy answers CORS for that origin, requires the `x-api-key` header to equal `FARO_APP_KEY`, rate limits (50 req/s, burst 100) and sends everything to Loki with `service_name="rentanllm-web"`, `source="faro"`.

No bearer token is involved on purpose: anything shipped to a browser is public, including `NEXT_PUBLIC_FARO_APP_KEY`. The origin check and app key keep out casual traffic; a determined client can still forge both with curl, which is why the receiver is rate limited, payloads are capped at 2 MB and nothing it accepts can reach Tempo, Prometheus or the gateway.

```sh
curl -i -X POST https://otel.<DOMAIN>/collect \
  -H 'Origin: https://rentanllm.vercel.app' -H "x-api-key: $FARO_APP_KEY" -H 'Content-Type: application/json' \
  -d '{"meta":{"app":{"name":"rentanllm-web"}},"logs":[{"message":"hello","level":"info","context":{},"timestamp":"1970-01-01T00:00:00Z"}]}'
# 202 with the key, 401 without (from Alloy), and 401 from Caddy with any other Origin
```

In Grafana Explore → Loki: `{service_name="rentanllm-web"}`.

## 6. Metric contract (gateway ↔ dashboard and alerts)

The gateway exports Effect metrics over OTLP. Alloy runs `otelcol.exporter.prometheus` with `add_metric_suffixes = false`, so a metric keeps its OTel name in Prometheus (dots become underscores, nothing is appended; histograms get `_bucket`, `_sum`, `_count`). This matters because Effect sends unit `1` by default (which would otherwise turn gauges into `*_ratio`) and, because suffixes are off, counters stay without `_total` even though the gateway now marks them monotonic (`incremental: true`). Verified locally against the real gateway image.

| Prometheus series | Gateway instrument | Labels | Used by |
| --- | --- | --- | --- |
| `gateway_requests` | counter `gateway_requests` | `status` (e.g. `402`), `status_class`, `outcome` | requests by status, 5xx share, 402s, error-rate alert |
| `gateway_request_duration_ms_bucket` | histogram `gateway_request_duration_ms` |  | latency p50/p95/p99 |
| `gateway_tokens` | counter `gateway_tokens` | `kind` (`input`, `output`, `cache_read`, `cache_write`) | tokens/min |
| `gateway_cost_micros` | counter `gateway_cost_micros` |  | (not on the dashboard yet) |
| `gateway_active_tunnels` | gauge `gateway_active_tunnels` |  | active tunnels |
| `gateway_nodes_connected` | gauge `gateway_nodes_connected` |  | tunnels panel, "No node heartbeats" alert |
| `probe_success{job="gateway-health"}` | Alloy blackbox probe of `/healthz` |  | "Gateway down" alert, Gateway up stat |

Counters are cumulative, so `rate()` and `increase()` work; Prometheus 3 may add an info note in Explore that the name lacks `_total`, which is harmless. Every series also carries `env` (from `DEPLOY_ENV`) and `job` (`service.name`, i.e. `rentanllm-gateway`). Renaming an instrument in `apps/gateway/src/metrics.ts` breaks the matching panel or alert: update `grafana/dashboards/rentanllm-gateway.json` and `grafana/provisioning/alerting/alerting.yaml` in the same change.

## 7. Alerts

Grafana-managed rules in the RentAnLLM folder, all sent to the `ops-webhook` contact point (`GRAFANA_ALERT_WEBHOOK_URL`):

| Rule | Fires when | Severity |
| --- | --- | --- |
| Gateway down | `probe_success` < 1 for 2 min, or the probe series disappears | critical |
| No node heartbeats | `gateway_nodes_connected` was 0 for the whole last 10 min, for 5 min. The gateway drops a node after 3 missed heartbeats, so this covers wedged tunnels and "every owner is offline" alike | warning |
| Gateway 5xx rate spike | 5xx share of `gateway_requests` > 5 % for 5 min (denominator floored at 0.05 req/s). Includes 503 "node offline" | critical |

Rules are provisioned from files, so they are read-only in the UI; change `grafana/provisioning/alerting/alerting.yaml` and redeploy.

## 8. Backups

Worth backing up: `grafana-data` (users, annotations, alert state), `caddy-data` (certificates and ACME account; re-issuable), `redis-data` (budgets and counters, if Redis is ever the source of truth). Prometheus, Loki and Tempo hold 7 days of telemetry; back them up only if you care about that history. Dashboards, datasources and alert rules are in git.

```sh
cd ~/rentanllm/deploy/hostinger
mkdir -p ~/backups
backup() {  # backup <volume>
  docker run --rm -v "rentanllm_$1:/v:ro" -v "$HOME/backups:/b" busybox:1.37.0-musl \
    tar czf "/b/$1-$(date +%F).tgz" -C /v .
}
docker compose stop grafana && backup grafana-data && docker compose start grafana
backup caddy-data
docker compose exec -T redis redis-cli BGSAVE && backup redis-data
# Prometheus: stop briefly for a consistent TSDB copy; Alloy buffers remote writes meanwhile.
docker compose stop prometheus && backup prometheus-data && docker compose start prometheus
find ~/backups -name '*.tgz' -mtime +14 -delete
```

Put that in a script and run it from the deploy user's crontab, e.g. `0 3 * * *` (03:00 in the server's timezone, UTC on a stock Hostinger image). Copy `~/backups` off the box (restic, rclone, or Hostinger's snapshot feature). Restore: stop the service, `tar xzf` into the volume with the same `docker run` pattern, start it.

## 9. Local test run

Everything runs on a laptop with `DOMAIN=localhost` (Caddy uses its internal CA for `*.localhost`):

```sh
cd deploy/hostinger
cp .env.example .env    # DOMAIN=localhost, GATEWAY_IMAGE=rentanllm-gateway:local, non-placeholder secrets
printf 'STORE=memory\nGATEWAY_SEED_FILE=/app/fixtures/dev-seed.json\n' > gateway.env
./deploy.sh --build
curl -k https://gw.localhost/healthz
docker compose down -v  # tear down and delete volumes
```

If something else on the laptop already owns port 443, test from inside the Docker network instead: `docker run --rm --network rentanllm_edge curlimages/curl -k --resolve gw.localhost:443:<caddy-ip> https://gw.localhost/healthz`.

## Troubleshooting

- `docker compose ps`: every long-running service should be `healthy`; `hc-tools` and `tempo-init` exit 0 by design.
- `docker compose logs -f <service>`, or in Grafana Explore → Loki: `{service_name="gateway"}`.
- Alloy's pipeline UI: `docker compose exec alloy bash`, or temporarily tunnel `ssh -L 12345:<alloy-ip>:12345`; it is not exposed publicly.
- Cert issues: `docker compose logs caddy`; DNS must resolve and ports 80/443 must be open.
