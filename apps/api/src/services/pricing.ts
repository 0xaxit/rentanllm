import { InvalidRequest, NotFound } from "@rentanllm/api-contract";
import type { Listing as ContractListing } from "@rentanllm/api-contract";
import { priceVerdict, suggestPrices } from "@rentanllm/core";
import type { TokenPrices } from "@rentanllm/core";
import { Db } from "@rentanllm/db";
import { apiPriceRefs } from "@rentanllm/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";

import { dieOnDbError } from "../db-errors";

type Provider = ContractListing["provider"];

const toWire = (prices: TokenPrices) => ({
  cacheReadPerMtokUsdc: prices.cacheReadPerMtok,
  inputPerMtokUsdc: prices.inputPerMtok,
  outputPerMtokUsdc: prices.outputPerMtok,
});

/** Suggested price and fair band from the provider's API list price (api_price_refs). */
export const priceSuggestion = Effect.fn("pricing.suggestion")(
  function* priceSuggestionGen(input: {
    readonly inputPerMtokUsdc?: bigint;
    readonly model: string;
    readonly outputPerMtokUsdc?: bigint;
    readonly provider: Provider;
  }) {
    const db = yield* Db;
    const [ref] = yield* db
      .select()
      .from(apiPriceRefs)
      .where(
        and(
          eq(apiPriceRefs.provider, input.provider),
          eq(apiPriceRefs.model, input.model)
        )
      );
    if (ref === undefined) {
      return yield* new NotFound({
        message: `No API reference price for ${input.provider}/${input.model}`,
      });
    }
    const api: TokenPrices = {
      cacheReadPerMtok: ref.cacheReadPerMtokUsdc,
      inputPerMtok: ref.inputPerMtokUsdc,
      outputPerMtok: ref.outputPerMtokUsdc,
    };
    const suggestion = suggestPrices(api);
    const verdict =
      input.inputPerMtokUsdc === undefined ||
      input.outputPerMtokUsdc === undefined
        ? null
        : priceVerdict(
            {
              inputPerMtok: input.inputPerMtokUsdc,
              outputPerMtok: input.outputPerMtokUsdc,
            },
            api
          );
    return {
      api: toWire(api),
      checkedAt: ref.checkedAt,
      max: toWire(suggestion.max),
      min: toWire(suggestion.min),
      model: ref.model,
      provider: ref.provider,
      sourceUrl: ref.sourceUrl,
      suggested: toWire(suggestion.suggested),
      verdict,
    };
  },
  dieOnDbError
);

/** Models a listing can offer: every model with an API reference price. */
export const listModels = Effect.fn("pricing.models")(
  function* listModelsGen() {
    const db = yield* Db;
    return yield* db
      .select({ model: apiPriceRefs.model, provider: apiPriceRefs.provider })
      .from(apiPriceRefs)
      .orderBy(asc(apiPriceRefs.provider), asc(apiPriceRefs.model));
  },
  dieOnDbError
);

/** Ollama model names: `name[:tag]`, optionally namespaced (`user/name:tag`). */
const OPEN_MODEL_NAME =
  /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9._-]+)?(?::[a-z0-9._-]+)?$/u;

/**
 * Fails unless every model has an API reference price for the provider. Ollama listings
 * sell open models with no API list price, so only the name's shape is checked.
 */
export const requireKnownModels = Effect.fn("pricing.requireKnownModels")(
  function* requireKnownModelsGen(
    provider: Provider,
    models: readonly string[]
  ) {
    // Open models are whatever the owner pulled into Ollama: any well-formed name goes.
    if (provider === "ollama") {
      const bad = models.filter((model) => !OPEN_MODEL_NAME.test(model));
      if (models.length === 0 || bad.length > 0) {
        return yield* new InvalidRequest({
          message:
            models.length === 0
              ? "Pick at least one model"
              : `Not an Ollama model name: ${bad.join(", ")} (e.g. llama3.1:8b)`,
        });
      }
      return;
    }
    const db = yield* Db;
    const known = yield* db
      .select({ model: apiPriceRefs.model })
      .from(apiPriceRefs)
      .where(
        and(
          eq(apiPriceRefs.provider, provider),
          inArray(apiPriceRefs.model, [...models])
        )
      );
    const knownSet = new Set(known.map((row) => row.model));
    const unknown = models.filter((model) => !knownSet.has(model));
    if (models.length === 0 || unknown.length > 0) {
      return yield* new InvalidRequest({
        message:
          models.length === 0
            ? "Pick at least one model"
            : `Unknown ${provider} model: ${unknown.join(", ")}`,
      });
    }
  },
  dieOnDbError
);
