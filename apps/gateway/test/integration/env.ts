/** Connection strings for the containers in docker-compose.test.yml (dev-only credentials). */
export const TEST_DATABASE_URL =
  process.env.GATEWAY_TEST_DATABASE_URL ??
  "postgres://rentanllm:rentanllm@127.0.0.1:54339/rentanllm";
export const TEST_REDIS_URL =
  process.env.GATEWAY_TEST_REDIS_URL ?? "redis://127.0.0.1:63799";

export const integrationEnabled = process.env.GATEWAY_INTEGRATION === "1";
