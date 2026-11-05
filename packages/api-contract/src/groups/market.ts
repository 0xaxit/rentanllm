import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

import { InvalidRequest } from "../errors/invalid-request";
import {
  MarketOfferSchema,
  PaidRequestSchema,
  PaidRequestsQuerySchema,
} from "../schemas";

/**
 * Public market reads: what is for sale and the latest paid requests, each with its
 * on-chain payment.
 */
export class MarketGroup extends HttpApiGroup.make("market")
  .add(
    HttpApiEndpoint.get("offers", "/offers", {
      success: Schema.Array(MarketOfferSchema),
    })
  )
  .add(
    HttpApiEndpoint.get("requests", "/requests", {
      error: InvalidRequest,
      query: PaidRequestsQuerySchema,
      success: Schema.Array(PaidRequestSchema),
    })
  )
  .prefix("/market") {}
