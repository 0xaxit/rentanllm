/**
 * The x402 terms for paying one seller one price on Hedera: the USDC token to the
 * seller's `0.0.x` account. Sellers sign in with an EVM wallet, so the account is looked
 * up from that address on the mirror node (a Hedera ECDSA account has its EVM address as
 * an alias). `extra.feePayer` is the facilitator's account from its `/supported` list;
 * it submits the transfer and pays the network fee.
 *
 * The fee payer is cached for 10 minutes (30 seconds when the facilitator does not list one).
 */
import type { Micros } from "@rentanllm/core";
import type { PaymentRequirements } from "@x402/core/types";
import { Cache, Context, Duration, Effect, Exit, Layer, Option } from "effect";

import type { MarketSettings } from "../config.ts";
import { Settings } from "../config.ts";
import type { MarketOffer } from "../domain.ts";
import type { FacilitatorError } from "../x402/facilitator-error.ts";
import { X402Facilitator } from "../x402/facilitator.ts";
import { HederaAccounts } from "./hedera-accounts.ts";

const FOUND_TTL = Duration.minutes(10);
const MISS_TTL = Duration.seconds(30);

export class MarketTerms extends Context.Service<
  MarketTerms,
  {
    /**
     * Terms for paying `offer`'s owner `amountMicros`; null when the owner cannot be paid
     * (no Hedera account, or the facilitator does not serve Hedera).
     */
    readonly requirementsFor: (
      offer: MarketOffer,
      amountMicros: Micros
    ) => Effect.Effect<PaymentRequirements | null, FacilitatorError>;
  }
>()("@rentanllm/gateway/MarketTerms") {}

const baseRequirements = (
  market: MarketSettings,
  payTo: string,
  amountMicros: Micros,
  extra: Record<string, unknown>
): PaymentRequirements => ({
  amount: amountMicros.toString(),
  asset: market.chain.assetAddress,
  extra,
  maxTimeoutSeconds: market.maxTimeoutSeconds,
  network: market.chain.network,
  payTo,
  scheme: "exact",
});

export const MarketTermsLive = Layer.effect(MarketTerms)(
  Effect.gen(function* makeMarketTerms() {
    const { market } = yield* Settings;
    const facilitator = yield* X402Facilitator;
    const accounts = yield* HederaAccounts;
    const feePayer = yield* Cache.makeWith(
      (network: string) =>
        facilitator
          .supportedExtra(network)
          .pipe(
            Effect.map((extra) =>
              typeof extra?.feePayer === "string"
                ? Option.some(extra.feePayer)
                : Option.none<string>()
            )
          ),
      {
        capacity: 4,
        timeToLive: (exit) =>
          Exit.isSuccess(exit) && Option.isSome(exit.value)
            ? FOUND_TTL
            : MISS_TTL,
      }
    );

    return {
      requirementsFor: (offer, amountMicros) =>
        Effect.gen(function* requirementsFor() {
          if (market === null) {
            return null;
          }
          const { chain } = market;
          const payer = yield* Cache.get(feePayer, chain.network);
          if (Option.isNone(payer)) {
            yield* Effect.logWarning(
              `the x402 facilitator does not serve ${chain.network}`
            );
            return null;
          }
          const account = yield* accounts.accountFor(offer.ownerWallet);
          if (account === null) {
            return null;
          }
          return baseRequirements(market, account, amountMicros, {
            feePayer: payer.value,
          });
        }),
    };
  })
);
