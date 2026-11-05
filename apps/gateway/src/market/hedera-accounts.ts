/**
 * Finds the Hedera account behind a seller's EVM sign-in address. Hedera payments go to a
 * `0.0.x` account id (the facilitator rejects aliases), and a Hedera ECDSA account has its
 * EVM address as an alias, so the mirror node maps one to the other.
 *
 * Cached: found accounts for 10 minutes, misses for 30 seconds so a seller who just
 * created their account is picked up quickly.
 */
import { Cache, Context, Duration, Effect, Exit, Layer } from "effect";

import { Settings } from "../config.ts";

const FOUND_TTL = Duration.minutes(10);
const MISS_TTL = Duration.seconds(30);
const MIRROR_TIMEOUT = Duration.seconds(10);
const CACHE_CAPACITY = 10_000;
const HEDERA_ACCOUNT_ID = /^\d+\.\d+\.\d+$/u;

/** Finds the Hedera account behind an EVM address; null when there is none. */
export class HederaAccounts extends Context.Service<
  HederaAccounts,
  {
    readonly accountFor: (evmAddress: string) => Effect.Effect<string | null>;
  }
>()("@rentanllm/gateway/HederaAccounts") {}

/** Mirror-node lookup: GET /api/v1/accounts/{evmAddress} -> { account: "0.0.x" }. */
export const MirrorNodeAccounts = Layer.effect(HederaAccounts)(
  Effect.gen(function* makeMirrorNodeAccounts() {
    const { market } = yield* Settings;
    const mirror = market?.hederaMirrorUrl ?? "";
    const lookup = (evmAddress: string) =>
      Effect.tryPromise(async () => {
        const response = await fetch(
          `${mirror}/api/v1/accounts/${encodeURIComponent(evmAddress.toLowerCase())}`
        );
        if (!response.ok) {
          return null;
        }
        const body = (await response.json()) as { account?: unknown };
        return typeof body.account === "string" &&
          HEDERA_ACCOUNT_ID.test(body.account)
          ? body.account
          : null;
      }).pipe(
        Effect.timeout(MIRROR_TIMEOUT),
        Effect.tapError((cause) =>
          Effect.logWarning("Hedera mirror node lookup failed", cause)
        ),
        Effect.orElseSucceed(() => null)
      );
    const cache = yield* Cache.makeWith(lookup, {
      capacity: CACHE_CAPACITY,
      timeToLive: (exit) =>
        Exit.isSuccess(exit) && exit.value !== null ? FOUND_TTL : MISS_TTL,
    });
    return { accountFor: (evmAddress) => Cache.get(cache, evmAddress) };
  })
);
