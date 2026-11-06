#!/bin/sh
# Installs ral (rentanllm-node), the RentAnLLM seller agent.
#
#   curl -fsSL https://pub-f673ac09098c4d75afafeea51e907fa0.r2.dev/install.sh | sh
#
# Env: RENTANLLM_VERSION (default: latest), RENTANLLM_INSTALL_DIR (default: ~/.local/bin).
set -eu

BASE_URL="https://pub-f673ac09098c4d75afafeea51e907fa0.r2.dev/node"
VERSION="${RENTANLLM_VERSION:-latest}"
INSTALL_DIR="${RENTANLLM_INSTALL_DIR:-$HOME/.local/bin}"

fail() {
  printf 'ral install: %s\n' "$1" >&2
  exit 1
}

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) fail "unsupported OS $(uname -s); builds exist for Linux and macOS" ;;
esac

case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) fail "unsupported CPU $(uname -m); builds exist for x64 and arm64" ;;
esac

# Apple Silicon running a Rosetta shell still wants the native build.
if [ "$os" = darwin ] && [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then
  arch=arm64
fi

command -v curl >/dev/null 2>&1 || fail "curl is required"

if [ "$VERSION" = latest ]; then
  VERSION="$(curl -fsSL "$BASE_URL/LATEST")" || fail "could not read the latest version"
fi

asset="ral-$os-$arch"
url="$BASE_URL/$VERSION/$asset"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

printf 'Downloading %s (%s)\n' "$asset" "$VERSION"
curl -fsSL "$url" -o "$tmp/$asset" || fail "download failed: $url"
curl -fsSL "$BASE_URL/$VERSION/SHA256SUMS" -o "$tmp/SHA256SUMS" || fail "checksum download failed"

expected="$(grep " $asset\$" "$tmp/SHA256SUMS" | cut -d' ' -f1)"
[ -n "$expected" ] || fail "no checksum listed for $asset"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp/$asset" | cut -d' ' -f1)"
else
  actual="$(shasum -a 256 "$tmp/$asset" | cut -d' ' -f1)"
fi
[ "$expected" = "$actual" ] || fail "checksum mismatch for $asset"

mkdir -p "$INSTALL_DIR"
chmod 755 "$tmp/$asset"
mv "$tmp/$asset" "$INSTALL_DIR/ral"
printf 'Installed %s\n' "$INSTALL_DIR/ral"

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) printf '\nAdd it to your PATH:\n  export PATH="%s:$PATH"\n' "$INSTALL_DIR" ;;
esac

cat <<'EOF'

Next: register a node in the RentAnLLM console to get its id and token, then
  export RENTANLLM_NODE_ID=<node id>
  export RENTANLLM_NODE_TOKEN=rn_node_...
  ral start --gateway wss://gw.rentanllm.xyz/tunnel --ollama-model llama3.1:8b
EOF
