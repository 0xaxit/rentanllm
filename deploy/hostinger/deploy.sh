#!/usr/bin/env bash
# Deploy or update the RentAnLLM edge stack. Idempotent: run it as often as you like.
#
#   ./deploy.sh            pull GATEWAY_IMAGE (and the pinned infra images), roll what changed
#   ./deploy.sh --build    build the gateway image from this checkout instead of pulling
#   ./deploy.sh --tag v0.2.0   deploy ghcr image tag v0.2.0 (overrides the tag in GATEWAY_IMAGE)
#   ./deploy.sh --no-pull  use the GATEWAY_IMAGE already on this host (docker load, local test)
#
# "Zero-downtime-ish": images are fetched before anything restarts; the gateway is
# the only thing recreated on a normal deploy and Caddy holds renter requests for up
# to 30s (lb_try_duration) while it comes back. Owner node tunnels drop and the
# node agents reconnect. Caddy itself is reloaded in place, never restarted.
# Secrets live only in .env next to this script.
set -euo pipefail

cd "$(dirname "$0")"

build=0
pull=1
tag=""
while (($#)); do
  case "$1" in
    --build) build=1 ;;
    --no-pull) pull=0 ;;
    --tag)
      tag="${2:?--tag needs a value}"
      shift
      ;;
    -h | --help)
      sed -n '2,13p' "$0"
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
  shift
done

if [[ ! -f .env ]]; then
  echo "missing .env: cp .env.example .env and fill it in" >&2
  exit 1
fi

# Refuse to deploy with placeholder secrets.
for var in REDIS_PASSWORD OTEL_INGEST_TOKEN GRAFANA_ADMIN_PASSWORD FARO_APP_KEY; do
  value="$(grep -E "^${var}=" .env | tail -n1 | cut -d= -f2- || true)"
  if [[ -z "${value}" || "${value}" == change-me* ]]; then
    echo "${var} is empty or still a placeholder in .env" >&2
    exit 1
  fi
done

env_value() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- || true; }

# EDGE_MODE=traefik: an existing Traefik owns 80/443 on this host; Caddy joins its
# network without publishing ports (compose.traefik.yaml).
compose_files=(-f compose.yaml)
if [[ "$(env_value EDGE_MODE)" == "traefik" ]]; then
  compose_files+=(-f compose.traefik.yaml)
fi
compose() { docker compose --env-file .env "${compose_files[@]}" "$@"; }

if [[ ! -f gateway.env ]]; then
  echo "missing gateway.env: cp gateway.env.example gateway.env and fill it in (DATABASE_URL etc.)" >&2
  exit 1
fi

image="$(grep -E '^GATEWAY_IMAGE=' .env | tail -n1 | cut -d= -f2- || true)"
image="${image:-rentanllm-gateway:local}"
if [[ -n "${tag}" ]]; then
  image="${image%:*}:${tag}"
fi
export GATEWAY_IMAGE="${image}"
if ((build)); then
  GATEWAY_VERSION="$(git -C ../.. describe --tags --always --dirty 2>/dev/null || echo local)"
else
  GATEWAY_VERSION="${image##*:}"
fi
export GATEWAY_VERSION

# Hash each service's config so `up -d` recreates exactly the services whose
# config changed (the hash is a container label in compose.yaml).
hash_dir() { find "$1" -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -c1-16; }
ALLOY_CONFIG_HASH="$(hash_dir alloy)"
TEMPO_CONFIG_HASH="$(hash_dir tempo)"
LOKI_CONFIG_HASH="$(hash_dir loki)"
PROMETHEUS_CONFIG_HASH="$(hash_dir prometheus)"
GRAFANA_CONFIG_HASH="$(hash_dir grafana)"
export ALLOY_CONFIG_HASH TEMPO_CONFIG_HASH LOKI_CONFIG_HASH PROMETHEUS_CONFIG_HASH GRAFANA_CONFIG_HASH

echo "==> validating compose file"
compose config --quiet

echo "==> fetching images"
compose pull --quiet --ignore-buildable
if ((build)); then
  compose build --pull gateway
elif ((pull)); then
  compose pull --quiet gateway
elif ! docker image inspect "${GATEWAY_IMAGE}" >/dev/null 2>&1; then
  echo "--no-pull: image ${GATEWAY_IMAGE} is not on this host" >&2
  exit 1
fi

echo "==> starting / updating infrastructure"
compose up --detach --wait --wait-timeout 180 --remove-orphans \
  caddy redis docker-socket-proxy tempo loki prometheus alloy grafana scheduler

echo "==> rolling gateway"
compose up --detach --wait --wait-timeout 120 --no-deps gateway

echo "==> reloading Caddy config in place"
compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile

echo "==> pruning dangling images"
docker image prune --force >/dev/null

compose ps --format 'table {{.Service}}\t{{.Status}}'
