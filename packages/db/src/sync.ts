/**
 * Applies schema.ts to a database and upserts the API price seed.
 * There is no migrations folder: drizzle-kit push diffs the live database.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { Effect } from "effect";

import { Db } from "./client";
import { apiPriceRefs } from "./schema";
import { API_PRICE_SEED } from "./seed";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DRIZZLE_KIT = fileURLToPath(
  new URL("../node_modules/drizzle-kit/bin.cjs", import.meta.url)
);
const SCHEMA_FILE = fileURLToPath(new URL("schema.ts", import.meta.url));

interface PushResult {
  readonly status?: string;
}

/** Creates or updates tables so they match schema.ts. */
export const pushSchema = (url: string): void => {
  const result = spawnSync(
    "bun",
    [
      DRIZZLE_KIT,
      "push",
      "--output",
      "json",
      "--dialect",
      "postgresql",
      "--schema",
      SCHEMA_FILE,
      "--url",
      url,
    ],
    {
      cwd: PACKAGE_ROOT,
      encoding: "utf-8",
      env: { ...process.env, DATABASE_URL: url },
    }
  );
  const jsonLine = (result.stdout ?? "")
    .split("\n")
    .toReversed()
    .find((line) => line.startsWith("{"));
  const parsed: PushResult =
    jsonLine === undefined ? {} : (JSON.parse(jsonLine) as PushResult);
  if (parsed.status === "ok" || parsed.status === "no_changes") {
    return;
  }
  const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
  throw new Error(
    `schema push failed (exit ${result.status ?? "none"}): ${detail}`
  );
};

/** Upserts API_PRICE_SEED into api_price_refs. */
export const seedPrices = Effect.gen(function* seedPrices() {
  const db = yield* Db;
  for (const row of API_PRICE_SEED) {
    yield* db
      .insert(apiPriceRefs)
      .values({
        cacheReadPerMtokUsdc: row.cacheReadPerMtokUsdc,
        checkedAt: row.checkedAt,
        inputPerMtokUsdc: row.inputPerMtokUsdc,
        model: row.model,
        outputPerMtokUsdc: row.outputPerMtokUsdc,
        provider: row.provider,
        sourceUrl: row.sourceUrl,
      })
      .onConflictDoUpdate({
        set: {
          cacheReadPerMtokUsdc: row.cacheReadPerMtokUsdc,
          checkedAt: row.checkedAt,
          inputPerMtokUsdc: row.inputPerMtokUsdc,
          outputPerMtokUsdc: row.outputPerMtokUsdc,
          sourceUrl: row.sourceUrl,
        },
        target: [apiPriceRefs.provider, apiPriceRefs.model],
      });
  }
});
