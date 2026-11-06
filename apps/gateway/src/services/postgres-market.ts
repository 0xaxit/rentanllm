/**
 * Postgres `MarketStore` (packages/db schema).
 *
 * - Offers are live listings whose `models` include the requested model, on nodes that
 *   are not disabled and whose owner has a wallet to be paid at. They are cached per model
 *   for `authCacheTtlMs`, like the auth stores, so the hot path does not query Postgres
 *   on every request; a price change reaches this gateway within that time.
 * - A paid request is one `paid_requests` row; `request_id` and `payment_tx` are unique,
 *   so a duplicate writes nothing.
 */
import { effectiveListingPrices } from "@rentanllm/core";
import { ProviderSchema } from "@rentanllm/protocol";
import { Cache, Duration, Effect, Exit, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";

import { Settings } from "../config.ts";
import type { BuyerPolicy, MarketOffer } from "../domain.ts";
import { MarketStore } from "./market-store.ts";
import { toMicros } from "./rows.ts";
import { StoreError } from "./store-error.ts";

const CACHE_CAPACITY = 1000;

type MicrosColumn = bigint | string | number;

interface OfferRow {
  readonly id: string;
  readonly max_concurrency: number;
  readonly models: readonly string[];
  readonly node_id: string;
  readonly owner_id: string;
  readonly price_cache_read_per_mtok_usdc: MicrosColumn | null;
  readonly price_cache_write_per_mtok_usdc: MicrosColumn | null;
  readonly price_in_per_mtok_usdc: MicrosColumn;
  readonly price_out_per_mtok_usdc: MicrosColumn;
  readonly provider: string;
  readonly wallet_address: string;
}

const nullable = (value: MicrosColumn | null) =>
  value === null ? null : toMicros(value);

interface PolicyRow {
  readonly allowed_sellers: readonly string[] | null;
  readonly daily_budget_micros: MicrosColumn | null;
  readonly max_per_request_micros: MicrosColumn | null;
  readonly paused: boolean;
  readonly per_seller_daily_micros: MicrosColumn | null;
}

interface SpendRow {
  readonly to_seller: MicrosColumn | null;
  readonly total: MicrosColumn | null;
}

const policyOf = (row: PolicyRow): BuyerPolicy => ({
  allowedSellers: row.allowed_sellers,
  dailyBudgetMicros: nullable(row.daily_budget_micros),
  maxPerRequestMicros: nullable(row.max_per_request_micros),
  paused: row.paused,
  perSellerDailyMicros: nullable(row.per_seller_daily_micros),
});

const isProvider = Schema.is(ProviderSchema);

const storeError = (cause: unknown) =>
  new StoreError({ cause, store: "MarketStore" });

const offerOf = (row: OfferRow): MarketOffer | null => {
  if (!isProvider(row.provider)) {
    return null;
  }
  return {
    listingId: row.id,
    maxConcurrency: row.max_concurrency,
    models: row.models,
    nodeId: row.node_id,
    ownerId: row.owner_id,
    ownerWallet: row.wallet_address,
    prices: effectiveListingPrices({
      cacheReadPerMtok: nullable(row.price_cache_read_per_mtok_usdc),
      cacheWritePerMtok: nullable(row.price_cache_write_per_mtok_usdc),
      inputPerMtok: toMicros(row.price_in_per_mtok_usdc),
      outputPerMtok: toMicros(row.price_out_per_mtok_usdc),
    }),
    provider: row.provider,
  };
};

export const PostgresMarketStore = Layer.effect(MarketStore)(
  Effect.gen(function* makePostgresMarketStore() {
    const sql = yield* SqlClient;
    const { authCacheTtlMs } = yield* Settings;
    const ttl = Duration.millis(authCacheTtlMs);

    const select = (model: string | null) =>
      sql<OfferRow>`
        select l.id, l.max_concurrency, l.models, l.price_cache_read_per_mtok_usdc,
               l.price_cache_write_per_mtok_usdc, l.price_in_per_mtok_usdc,
               l.price_out_per_mtok_usdc, pa.provider, n.id as node_id, n.owner_id,
               u.wallet_address
        from listings l
        join provider_accounts pa on pa.id = l.provider_account_id
        join nodes n on n.id = pa.node_id
        join users u on u.id = n.owner_id
        where l.status = 'live'
          and n.status <> 'disabled'
          and pa.status not in ('banned', 'revoked')
          and pa.provider = 'ollama'
          and u.wallet_address is not null
          and (${model}::text is null or ${model} = any(l.models))
        order by l.price_out_per_mtok_usdc, l.id
      `.pipe(
        Effect.map((rows) =>
          rows.flatMap((row) => {
            const offer = offerOf(row);
            return offer === null ? [] : [offer];
          })
        ),
        Effect.mapError(
          (cause) => new StoreError({ cause, store: "MarketStore" })
        )
      );
    // Keyed by model; "" is the whole catalog.
    const offers = yield* Cache.makeWith(
      (model: string) => select(model === "" ? null : model),
      {
        capacity: CACHE_CAPACITY,
        timeToLive: (exit) => (Exit.isSuccess(exit) ? ttl : Duration.zero),
      }
    );

    return {
      buyerPolicy: (payer) =>
        sql<PolicyRow>`
          select allowed_sellers, daily_budget_micros, max_per_request_micros,
                 paused, per_seller_daily_micros
          from buyer_policies
          where payer_account = ${payer}
        `.pipe(
          Effect.map(([row]) => (row === undefined ? null : policyOf(row))),
          Effect.mapError(storeError)
        ),
      buyerSpend: (payer, payTo, since) =>
        sql<SpendRow>`
          select coalesce(sum(paid_usdc_micros), 0) as total,
                 coalesce(sum(paid_usdc_micros) filter (where pay_to = ${payTo}), 0)
                   as to_seller
          from paid_requests
          where payer = ${payer} and created_at > ${since}
        `.pipe(
          Effect.map(([row]) => ({
            toSellerMicros: toMicros(row?.to_seller ?? 0),
            totalMicros: toMicros(row?.total ?? 0),
          })),
          Effect.mapError(storeError)
        ),
      catalog: Cache.get(offers, ""),
      offers: (model) => Cache.get(offers, model),
      recordAuditSequence: (requestId, sequence) =>
        sql`
          update paid_requests set audit_sequence = ${sequence}
          where request_id = ${requestId}
        `.pipe(Effect.asVoid, Effect.mapError(storeError)),
      recordPaid: (record) =>
        Effect.gen(function* recordPaidRequest() {
          const { prices, usage } = record;
          const inserted = yield* sql<{ readonly id: string }>`
            insert into paid_requests
              (cache_read_tokens, cache_write_tokens, finished_at, http_status,
               input_tokens, latency_ms, listing_id, max_tokens, model, network,
               node_id, output_tokens, owner_id, paid_usdc_micros, pay_to, payer,
               payment_tx, price_in_per_mtok_usdc, price_out_per_mtok_usdc,
               request_id, status, ttfb_ms, used_usdc_micros)
            values
              (${usage?.cacheReadTokens ?? 0}, ${usage?.cacheWriteTokens ?? 0},
               ${record.finishedAt}, ${record.httpStatus}, ${usage?.inputTokens ?? 0},
               ${record.latencyMs}, ${record.listingId}, ${record.maxTokens},
               ${record.model}, ${record.network}, ${record.nodeId},
               ${usage?.outputTokens ?? 0}, ${record.ownerId},
               ${record.paidMicros.toString()}, ${record.payTo}, ${record.payer},
               ${record.paymentTx}, ${prices.inputPerMtok.toString()},
               ${prices.outputPerMtok.toString()}, ${record.requestId},
               ${record.status}, ${record.ttfbMs}, ${record.usedMicros.toString()})
            on conflict do nothing
            returning id
          `;
          return inserted.length > 0;
        }).pipe(
          Effect.mapError(
            (cause) => new StoreError({ cause, store: "MarketStore" })
          )
        ),
    };
  })
);
