#!/bin/sh
# Builds ral (rentanllm-node) for every supported platform and uploads it, with
# SHA256SUMS and install.sh, to the public R2 bucket under node/v<version>/, then
# points node/LATEST at that version. Safe to rerun. Needs `wrangler login`.
#
#   bun run release            (from apps/node-agent)
set -eu

BUCKET="rentanllm-releases"
TARGETS="linux-x64 linux-arm64 darwin-x64 darwin-arm64"

cd "$(dirname "$0")/.."
version="$(sed -n 's/^export const AGENT_VERSION = "\(.*\)";$/\1/p' src/version.ts)"
[ -n "$version" ] || { echo "could not read AGENT_VERSION" >&2; exit 1; }

out="dist/release"

# RESUME=1 reuses the last build, so an interrupted upload finishes with the same
# bytes that SHA256SUMS describes (a fresh build need not be byte-identical).
if [ "${RESUME:-0}" = 1 ] && [ -f "$out/SHA256SUMS" ]; then
  echo "==> resuming with the build in $out"
else
  rm -rf "$out"
  mkdir -p "$out"
  for target in $TARGETS; do
    echo "==> building $target"
    bun build src/main.ts --compile --minify --target="bun-$target" \
      --outfile "$out/ral-$target"
  done
  (cd "$out" && shasum -a 256 ral-* > SHA256SUMS)
fi
cat "$out/SHA256SUMS"

PUBLIC_URL="https://pub-f673ac09098c4d75afafeea51e907fa0.r2.dev"

put() {
  bunx wrangler r2 object put "$BUCKET/$1" --file "$2" --content-type "$3" \
    --cache-control "$4" --remote
}

# Versioned files never change, so a rerun skips any already uploaded at the same size.
put_once() {
  size="$(wc -c < "$2" | tr -d ' ')"
  remote="$(curl -sI "$PUBLIC_URL/$1" | tr -d '\r' | awk 'tolower($1)=="content-length:" {print $2}')"
  if [ "$remote" = "$size" ]; then echo "skip $1 (already uploaded)"; return; fi
  put "$1" "$2" "$3" "public, max-age=31536000, immutable"
}

for target in $TARGETS; do
  put_once "node/v$version/ral-$target" "$out/ral-$target" application/octet-stream
done
put_once "node/v$version/SHA256SUMS" "$out/SHA256SUMS" text/plain

printf 'v%s' "$version" > "$out/LATEST"
put node/LATEST "$out/LATEST" text/plain "public, max-age=60"
put install.sh install.sh text/x-shellscript "public, max-age=300"
echo "==> released v$version"
