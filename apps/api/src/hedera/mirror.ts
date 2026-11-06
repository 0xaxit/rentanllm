/**
 * Hedera mirror node lookups the API needs:
 * - the Hedera account behind a sign-in wallet (an ECDSA account has its EVM address as
 *   an alias), so a buyer's limits can be keyed by the account that pays;
 * - whether an account can receive USDC, so a seller is not listed with an account every
 *   payment would fail to reach.
 * `canReceiveUsdc` answers null when the mirror node cannot say, which never blocks.
 * `accountFor` answers null both for "no account" and "mirror unreachable".
 */
import { Config, Context, Duration, Effect, Layer } from "effect";

/** Circle's testnet USDC on Hedera, the token the market settles in. */
export const USDC_TOKEN_ID = "0.0.429274";
const DEFAULT_MIRROR_URL = "https://testnet.mirrornode.hedera.com";
const TIMEOUT = Duration.seconds(8);
const HEDERA_ACCOUNT_ID = /^\d+\.\d+\.\d+$/u;

export class HederaMirror extends Context.Service<
  HederaMirror,
  {
    /** The `0.0.x` account behind an EVM address; null when there is none or unknown. */
    readonly accountFor: (evmAddress: string) => Effect.Effect<string | null>;
    /**
     * True when `account` holds a USDC association or has a free automatic-association
     * slot; false when a USDC transfer to it would fail; null when unknown.
     */
    readonly canReceiveUsdc: (account: string) => Effect.Effect<boolean | null>;
  }
>()("@rentanllm/api/HederaMirror") {}

interface AccountBody {
  readonly account?: unknown;
  readonly max_automatic_token_associations?: unknown;
}

interface TokensBody {
  readonly tokens?: readonly unknown[];
}

/** -1 is unlimited; otherwise free slots = limit - associations made automatically. */
const hasFreeSlot = (limit: number, automaticallyAssociated: number) =>
  limit === -1 || limit > automaticallyAssociated;

export const HederaMirrorLive = Layer.effect(HederaMirror)(
  Effect.gen(function* makeHederaMirror() {
    const base = (yield* Config.String("HEDERA_MIRROR_URL").pipe(
      Config.withDefault(DEFAULT_MIRROR_URL)
    )).replace(/\/+$/u, "");
    const getJson = <T>(path: string) =>
      Effect.tryPromise(async () => {
        const response = await fetch(`${base}${path}`);
        return response.ok ? ((await response.json()) as T) : null;
      }).pipe(
        Effect.timeout(TIMEOUT),
        Effect.tapError((cause) =>
          Effect.logWarning("Hedera mirror node lookup failed", cause)
        ),
        Effect.orElseSucceed(() => null)
      );

    return HederaMirror.of({
      accountFor: (evmAddress) =>
        getJson<AccountBody>(
          `/api/v1/accounts/${encodeURIComponent(evmAddress.toLowerCase())}`
        ).pipe(
          Effect.map((body) =>
            typeof body?.account === "string" &&
            HEDERA_ACCOUNT_ID.test(body.account)
              ? body.account
              : null
          )
        ),
      canReceiveUsdc: (account) =>
        Effect.gen(function* canReceiveUsdcGen() {
          const usdc = yield* getJson<TokensBody>(
            `/api/v1/accounts/${encodeURIComponent(account)}/tokens?token.id=${USDC_TOKEN_ID}`
          );
          if (usdc === null) {
            return null;
          }
          if ((usdc.tokens ?? []).length > 0) {
            return true;
          }
          const details = yield* getJson<AccountBody>(
            `/api/v1/accounts/${encodeURIComponent(account)}`
          );
          const limit = details?.max_automatic_token_associations;
          if (typeof limit !== "number") {
            return null;
          }
          const automatic = yield* getJson<{
            readonly tokens?: readonly {
              readonly automatic_association?: unknown;
            }[];
          }>(
            `/api/v1/accounts/${encodeURIComponent(account)}/tokens?limit=100`
          );
          const used = (automatic?.tokens ?? []).filter(
            (t) => t.automatic_association === true
          ).length;
          return hasFreeSlot(limit, used);
        }),
    });
  })
);

/** For tests: every wallet is `account`, and it can receive USDC unless told otherwise. */
export const hederaMirrorStub = (
  options: {
    readonly account?: string | null;
    readonly canReceive?: boolean | null;
  } = {}
) =>
  Layer.succeed(HederaMirror)(
    HederaMirror.of({
      accountFor: () =>
        Effect.succeed(
          options.account === undefined ? "0.0.1001" : options.account
        ),
      canReceiveUsdc: () =>
        Effect.succeed(
          options.canReceive === undefined ? true : options.canReceive
        ),
    })
  );
