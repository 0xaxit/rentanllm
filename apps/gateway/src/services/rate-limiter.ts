import { Context } from "effect";
import type { Effect, Scope } from "effect";

import type { StoreError } from "./store-error.ts";

/** Concurrency slots per key (a listing), shared across gateway processes in Redis. */
export class RateLimiter extends Context.Service<
  RateLimiter,
  {
    /**
     * Holds one of `limit` concurrency slots for `key` until the current scope closes.
     * Returns false (and holds nothing) when all slots are taken.
     */
    readonly acquireSlot: (
      key: string,
      limit: number
    ) => Effect.Effect<boolean, StoreError, Scope.Scope>;
  }
>()("@rentanllm/gateway/RateLimiter") {}
