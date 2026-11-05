# RentAnLLM edge gateway.
# Build from the repo root (the gateway depends on workspace packages):
#   docker build -f apps/gateway/Dockerfile -t rentanllm-gateway .
#
# The workspace packages (@rentanllm/core, /db, /protocol) ship TypeScript source, so the
# gateway is bundled with `bun build` into one ESM file and run on plain Node.

FROM oven/bun:1.3.10 AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile --filter '@rentanllm/gateway' \
 && cd apps/gateway && bun run build

FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    PORT=8787 \
    LOG_FORMAT=json \
    STORE=postgres
WORKDIR /app
COPY --from=build /app/apps/gateway/dist ./dist
COPY --from=build /app/apps/gateway/fixtures ./fixtures
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/main.js"]
