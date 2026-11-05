import { usdc } from "@rentanllm/core";
import type { Micros } from "@rentanllm/core";

import type { provider } from "./schema";

export interface ApiPriceSeed {
  readonly cacheReadPerMtokUsdc: Micros;
  readonly checkedAt: Date;
  readonly inputPerMtokUsdc: Micros;
  readonly model: string;
  readonly outputPerMtokUsdc: Micros;
  readonly provider: (typeof provider.enumValues)[number];
  readonly sourceUrl: string;
}

const CHECKED_AT = new Date(0);

/** Provider API list prices written into api_price_refs when the database is synced. */
export const API_PRICE_SEED: readonly ApiPriceSeed[] = [
  {
    cacheReadPerMtokUsdc: usdc("0.20"),
    checkedAt: CHECKED_AT,
    inputPerMtokUsdc: usdc("4"),
    model: "claude-opus-5-5",
    outputPerMtokUsdc: usdc("20"),
    provider: "anthropic",
    sourceUrl: "https://platform.claude.com",
  },
  {
    cacheReadPerMtokUsdc: usdc("0.20"),
    checkedAt: CHECKED_AT,
    inputPerMtokUsdc: usdc("2"),
    model: "claude-sonnet-5-5",
    outputPerMtokUsdc: usdc("10"),
    provider: "anthropic",
    sourceUrl: "https://platform.claude.com",
  },
  {
    cacheReadPerMtokUsdc: usdc("0.20"),
    checkedAt: CHECKED_AT,
    inputPerMtokUsdc: usdc("2"),
    model: "gpt-6-sol",
    outputPerMtokUsdc: usdc("10"),
    provider: "openai",
    sourceUrl: "https://openai.com/api/pricing",
  },
];
