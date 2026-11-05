import { Context } from "effect";
import type { Effect } from "effect";

import type { MarketOffer, PaidRequestRecord } from "../domain.ts";
import type { StoreError } from "./store-error.ts";

/**
 * What the market route reads and writes: the live listings selling a model, and the
 * log of paid requests. `recordPaid` is idempotent by requestId and by paymentTx:
 * it returns false (and writes nothing) for a duplicate.
 */
export class MarketStore extends Context.Service<
  MarketStore,
  {
    /** Every live listing, cheapest output price first. Online or not. */
    readonly catalog: Effect.Effect<readonly MarketOffer[], StoreError>;
    /** Live listings that sell `model`, cheapest output price first. Online or not. */
    readonly offers: (
      model: string
    ) => Effect.Effect<readonly MarketOffer[], StoreError>;
    readonly recordPaid: (
      record: PaidRequestRecord
    ) => Effect.Effect<boolean, StoreError>;
  }
>()("@rentanllm/gateway/MarketStore") {}
