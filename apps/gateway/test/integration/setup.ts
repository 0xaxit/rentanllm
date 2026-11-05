/**
 * Vitest global setup for the integration tests: starts Postgres + Redis with Docker
 * Compose, syncs the database with @rentanllm/db, and removes the containers (and
 * their data) afterwards. Set GATEWAY_TEST_KEEP_CONTAINERS=1 to leave them running.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { layer } from "@rentanllm/db";
import { pushSchema, seedPrices } from "@rentanllm/db/sync";
import { Effect, Layer, Redacted } from "effect";

import { TEST_DATABASE_URL } from "./env.ts";

const COMPOSE_FILE = fileURLToPath(
  new URL("../../docker-compose.test.yml", import.meta.url)
);

const compose = (...args: string[]) =>
  execFileSync("docker", ["compose", "-f", COMPOSE_FILE, ...args], {
    stdio: "inherit",
  });

const sync = Effect.gen(function* syncDatabase() {
  yield* Effect.sync(() => {
    pushSchema(TEST_DATABASE_URL);
  });
  yield* seedPrices;
}).pipe(
  Effect.retry({ times: 10 }),
  Effect.provide(
    layer({ maxConnections: 1, url: Redacted.make(TEST_DATABASE_URL) }).pipe(
      Layer.orDie
    )
  )
);

export const setup = async () => {
  compose("up", "-d", "--wait");
  await Effect.runPromise(sync);
};

export const teardown = () => {
  if (process.env.GATEWAY_TEST_KEEP_CONTAINERS !== "1") {
    compose("down", "-v", "--remove-orphans");
  }
};
