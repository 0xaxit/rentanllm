/**
 * Redis `RateLimiter`, shared by every gateway process: per-listing concurrency as a
 * sorted set of slot holders scored by lease expiry. A slot is released when the request
 * scope closes; the lease (refreshed while the request runs) frees slots held by a
 * crashed process. Time comes from Redis (`TIME`), so gateway clocks do not matter.
 */
import { randomUUID } from "node:crypto";

import { Effect, Layer, Schedule } from "effect";
import { Redis, script } from "effect/persistence/Redis";

import { Settings } from "../config.ts";
import { RateLimiter } from "./rate-limiter.ts";
import { StoreError } from "./store-error.ts";

const SLOTS_PREFIX = "rentanllm:rl:slots:";
const LEASE_REFRESHES_PER_LEASE = 3;

/** KEYS[1] slots; ARGV[1] limit, ARGV[2] holder, ARGV[3] lease ms. Returns 1 or 0. */
const ACQUIRE_SLOT = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local lease = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[1]) then
  return 0
end
redis.call('ZADD', KEYS[1], now + lease, ARGV[2])
redis.call('PEXPIRE', KEYS[1], lease)
return 1
`;

/** KEYS[1] slots; ARGV[1] holder, ARGV[2] lease ms. Extends a held slot. */
const REFRESH_SLOT = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local lease = tonumber(ARGV[2])
if redis.call('ZSCORE', KEYS[1], ARGV[1]) then
  redis.call('ZADD', KEYS[1], 'XX', now + lease, ARGV[1])
  redis.call('PEXPIRE', KEYS[1], lease)
end
return 1
`;

const acquire = script(
  (key: string, limit: number, holder: string, leaseMs: number) => [
    key,
    limit,
    holder,
    leaseMs,
  ],
  { lua: ACQUIRE_SLOT, numberOfKeys: 1 }
).withReturnType<number>();

const refresh = script(
  (key: string, holder: string, leaseMs: number) => [key, holder, leaseMs],
  { lua: REFRESH_SLOT, numberOfKeys: 1 }
).withReturnType<number>();

const storeError = (cause: unknown) =>
  new StoreError({ cause, store: "RateLimiter" });

export const RedisRateLimiter = Layer.effect(RateLimiter)(
  Effect.gen(function* makeRedisRateLimiter() {
    const redis = yield* Redis;
    const { concurrencyLeaseMs } = yield* Settings;
    const runAcquire = redis.eval(acquire);
    const runRefresh = redis.eval(refresh);

    const acquireSlot = (slotKey: string, limit: number) => {
      const key = `${SLOTS_PREFIX}${slotKey}`;
      const holder = randomUUID();
      return Effect.acquireRelease(
        runAcquire(key, limit, holder, concurrencyLeaseMs).pipe(
          Effect.mapError(storeError),
          Effect.map((acquired) => acquired === 1)
        ),
        (acquired) =>
          acquired
            ? redis.send("ZREM", key, holder).pipe(Effect.ignore)
            : Effect.void
      ).pipe(
        Effect.tap((acquired) =>
          acquired
            ? runRefresh(key, holder, concurrencyLeaseMs).pipe(
                Effect.ignore,
                Effect.repeat(
                  Schedule.spaced(
                    Math.max(
                      1000,
                      Math.floor(concurrencyLeaseMs / LEASE_REFRESHES_PER_LEASE)
                    )
                  )
                ),
                Effect.forkScoped
              )
            : Effect.void
        )
      );
    };

    return { acquireSlot };
  })
);
