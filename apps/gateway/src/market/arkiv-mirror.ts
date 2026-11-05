/**
 * Mirrors the market to Arkiv so anyone can read it without our API: the live offers
 * (re-published every `syncIntervalMs`, each with a short TTL so a seller that drops out
 * simply expires) and one receipt per paid request. Arkiv is a public record, never a
 * dependency: a failed write is logged and the market carries on.
 */
import {
  arkivReader,
  arkivWriter,
  publishReceipt,
  syncOffers,
  writerAddress,
} from "@rentanllm/arkiv";
import type { Offer, Receipt } from "@rentanllm/arkiv";
import { Context, Duration, Effect, Layer, Redacted, Schedule } from "effect";

import { Settings } from "../config.ts";
import type { ArkivSettings } from "../config.ts";
import { MarketStore } from "../services/market-store.ts";
import { TunnelHub } from "../tunnel/tunnel-hub.ts";
import { MarketTerms } from "./terms.ts";

/** Any positive amount: the terms are only read for their network and payee. */
const PROBE_AMOUNT = 1n;

export class ArkivMirror extends Context.Service<
  ArkivMirror,
  {
    /** Publishes a paid request's receipt in the background. Never fails. */
    readonly receipt: (receipt: Receipt) => Effect.Effect<void>;
  }
>()("@rentanllm/gateway/ArkivMirror") {}

const ArkivMirrorOff = Layer.succeed(ArkivMirror)({
  receipt: () => Effect.void,
});

/** Every live listing's models as offers: who to pay, on which network, and whether its node is up. */
const currentOffers = (resourceUrl: string) =>
  Effect.gen(function* currentOffersGen() {
    const catalog = yield* (yield* MarketStore).catalog;
    const hub = yield* TunnelHub;
    const terms = yield* MarketTerms;
    const offers: Offer[] = [];
    for (const offer of catalog) {
      const requirements = yield* terms.requirementsFor(offer, PROBE_AMOUNT);
      if (requirements === null) {
        continue;
      }
      const online = yield* hub.isOnline(offer.nodeId, offer.provider);
      for (const model of offer.models) {
        offers.push({
          listing: offer.listingId,
          model,
          network: requirements.network,
          online,
          payTo: requirements.payTo,
          priceIn: offer.prices.inputPerMtok,
          priceOut: offer.prices.outputPerMtok,
          url: resourceUrl,
        });
      }
    }
    return offers;
  });

const makeMirror = (arkiv: ArkivSettings, resourceUrl: string) =>
  Effect.gen(function* makeArkivMirror() {
    const key = Redacted.value(arkiv.privateKey);
    const reader = arkivReader(arkiv.accessKey);
    const writer = arkivWriter(key, arkiv.accessKey);
    const sync = currentOffers(resourceUrl).pipe(
      Effect.flatMap((offers) =>
        Effect.tryPromise(() => syncOffers(reader, writer, offers))
      ),
      Effect.tap(({ plan, txHash }) =>
        txHash === null
          ? Effect.void
          : Effect.logInfo("arkiv offers synced").pipe(
              Effect.annotateLogs({
                created: plan.create.length,
                refreshed: plan.refresh.length,
                removed: plan.remove.length,
                tx: txHash,
              })
            )
      ),
      Effect.catchCause((cause) =>
        Effect.logWarning("arkiv offer sync failed", cause)
      )
    );
    yield* Effect.logInfo("mirroring the market to arkiv").pipe(
      Effect.annotateLogs({ writer: writerAddress(key) })
    );
    yield* Effect.forkScoped(
      sync.pipe(
        Effect.repeat(Schedule.spaced(Duration.millis(arkiv.syncIntervalMs)))
      )
    );
    return {
      receipt: (receipt: Receipt) =>
        Effect.tryPromise(() => publishReceipt(writer, receipt)).pipe(
          Effect.tap(({ key: entityKey }) =>
            Effect.logInfo("arkiv receipt published").pipe(
              Effect.annotateLogs({
                entity: entityKey,
                requestId: receipt.requestId,
              })
            )
          ),
          Effect.catchCause((cause) =>
            Effect.logWarning("arkiv receipt failed", cause)
          ),
          Effect.forkDetach,
          Effect.asVoid
        ),
    };
  });

/** Mirrors to Arkiv when the market and ARKIV_PRIVATE_KEY are both set; otherwise a no-op. */
export const ArkivMirrorLive = Layer.unwrap(
  Effect.gen(function* chooseArkivMirror() {
    const { market } = yield* Settings;
    if (market === null || market.arkiv === null) {
      return ArkivMirrorOff;
    }
    return Layer.effect(ArkivMirror)(
      makeMirror(market.arkiv, market.resourceUrl)
    );
  })
);
