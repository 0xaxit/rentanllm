import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

import { NotFound } from "../errors/not-found";
import {
  ModelRefSchema,
  PriceSuggestionQuerySchema,
  PriceSuggestionSchema,
} from "../schemas";

/** Suggested listing prices: 40% of the provider API list price, fair band 30-50%. */
export class PricingGroup extends HttpApiGroup.make("pricing")
  .add(
    HttpApiEndpoint.get("suggestion", "/suggestion", {
      error: NotFound,
      query: PriceSuggestionQuerySchema,
      success: PriceSuggestionSchema,
    })
  )
  .add(
    HttpApiEndpoint.get("models", "/models", {
      success: Schema.Array(ModelRefSchema),
    })
  )
  .prefix("/pricing") {}
