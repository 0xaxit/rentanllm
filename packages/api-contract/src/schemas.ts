/**
 * Request and response schemas for the RentAnLLM control-plane API.
 *
 * JSON conventions:
 * - Money is an integer number of USDC micros (1 USDC = 1_000_000), typed `bigint` and sent
 *   as a decimal string ("19200000"). Format it with `formatUsdc` from @rentanllm/core.
 * - Instants are `Date`, sent as ISO-8601 strings in UTC.
 */
import { Schema } from "effect";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u;
const HEX_PATTERN = /^0x[0-9a-fA-F]*$/u;
const MAX_PCT = 100;
export const UuidSchema = Schema.String.check(Schema.isUUID());
/** USDC micros. JSON: decimal string. */
export const MicrosSchema = Schema.BigInt;
export const NonNegativeMicrosSchema = Schema.BigInt.check(
  Schema.isGreaterThanOrEqualToBigInt(0n)
);
export const AddressSchema = Schema.String.check(
  Schema.isPattern(ADDRESS_PATTERN)
);
export const HexSchema = Schema.String.check(Schema.isPattern(HEX_PATTERN));
export const PctSchema = Schema.Int.check(
  Schema.isBetween({ maximum: MAX_PCT, minimum: 0 })
);
export const PositiveIntSchema = Schema.Int.check(Schema.isGreaterThan(0));
export const ProviderSchema = Schema.Literals([
  "anthropic",
  "openai",
  "google",
  "xai",
  "ollama",
]);
export const NodeModeSchema = Schema.Literals([
  "owner_hosted",
  "platform_hosted",
]);
export const NodeStatusSchema = Schema.Literals([
  "online",
  "offline",
  "disabled",
]);
export const AuthKindSchema = Schema.Literals([
  "oauth",
  "session_token",
  "api_key",
]);
export const ProviderAccountStatusSchema = Schema.Literals([
  "ok",
  "limited",
  "banned",
  "revoked",
]);
export const ListingStatusSchema = Schema.Literals(["draft", "live", "paused"]);

// Auth

export const UserSchema = Schema.Struct({
  createdAt: Schema.Date,
  id: UuidSchema,
  isOwner: Schema.Boolean,
  isRenter: Schema.Boolean,
  walletAddress: Schema.NullOr(Schema.String),
});
export type User = typeof UserSchema.Type;

export const NonceRequestSchema = Schema.Struct({ address: AddressSchema });
export const NonceResponseSchema = Schema.Struct({
  expiresAt: Schema.Date,
  nonce: Schema.String,
});
export const VerifyRequestSchema = Schema.Struct({
  /** The EIP-4361 message the wallet signed, verbatim. */
  message: Schema.String,
  signature: HexSchema,
});
export const SessionResponseSchema = Schema.Struct({
  expiresAt: Schema.Date,
  user: UserSchema,
});

// Owner: nodes and provider accounts

export const NodeSchema = Schema.Struct({
  connectedAt: Schema.NullOr(Schema.Date),
  /** When the owner registered the node; the console lists the newest first. */
  createdAt: Schema.Date,
  /**
   * What the node's agent reported holding, per provider, read from the provider's
   * own headers (e.g. "API key · 450K tokens/min"). Empty until it first reports.
   */
  detectedPlans: Schema.Record(Schema.String, Schema.String),
  id: UuidSchema,
  lastHeartbeatAt: Schema.NullOr(Schema.Date),
  mode: NodeModeSchema,
  region: Schema.NullOr(Schema.String),
  status: NodeStatusSchema,
  version: Schema.NullOr(Schema.String),
});
export type Node = typeof NodeSchema.Type;

const UptimeWindowSchema = Schema.Struct({
  onlineMs: Schema.Number,
  trackedMs: Schema.Number,
});

/** Uptime from the gateway's tunnel sessions; untracked before the first one. */
export const NodeUptimeSchema = Schema.Struct({
  /** When this was computed; the timeline covers the 24 hours before it. */
  asOf: Schema.Date,
  currentSessionSince: Schema.NullOr(Schema.Date),
  last24h: UptimeWindowSchema,
  last7d: UptimeWindowSchema,
  timeline24h: Schema.Array(
    Schema.Struct({ from: Schema.Date, to: Schema.Date })
  ),
  trackedSince: Schema.NullOr(Schema.Date),
});
export type NodeUptime = typeof NodeUptimeSchema.Type;

/** No region: the gateway infers it from where the agent connects. */
export const RegisterNodeRequestSchema = Schema.Struct({
  mode: Schema.optionalKey(NodeModeSchema),
});
export const RegisterNodeResponseSchema = Schema.Struct({
  node: NodeSchema,
  /** Shown once. Only its SHA-256 is stored; give it to the node agent. */
  nodeToken: Schema.String,
});

export const ProviderAccountSchema = Schema.Struct({
  authKind: AuthKindSchema,
  id: UuidSchema,
  lastLimitHitAt: Schema.NullOr(Schema.Date),
  nodeId: UuidSchema,
  planTier: Schema.String,
  provider: ProviderSchema,
  sessionResetsAt: Schema.NullOr(Schema.Date),
  sessionUsedPct: Schema.NullOr(Schema.Number),
  status: ProviderAccountStatusSchema,
  usageReadAt: Schema.NullOr(Schema.Date),
  /** When the weekly meter resets (written by the gateway from node readings). */
  weeklyResetsAt: Schema.NullOr(Schema.Date),
  weeklyUsedPct: Schema.NullOr(Schema.Number),
});
export type ProviderAccount = typeof ProviderAccountSchema.Type;

/** Plan tier of a plan added before its node reported one; the gateway fills it in. */
export const UNDETECTED_PLAN_TIER = "not detected yet";

/**
 * The plan tier and sign-in kind are not asked for: the API takes them from what the
 * node reported (`Node.detectedPlans`), and the gateway keeps them in sync after.
 */
export const AddProviderAccountRequestSchema = Schema.Struct({
  /** Reference into the owner's secret store, never the credential itself. */
  credentialRef: Schema.optionalKey(Schema.String),
  provider: ProviderSchema,
});

// Owner: listings

export const ListingSchema = Schema.Struct({
  id: UuidSchema,
  maxConcurrency: Schema.Int,
  models: Schema.Array(Schema.String),
  /** Null: the gateway prices cache reads at input ÷ 10. */
  priceCacheReadPerMtokUsdc: Schema.NullOr(MicrosSchema),
  /** Null: cache writes cost 1.25× the input price. */
  priceCacheWritePerMtokUsdc: Schema.NullOr(MicrosSchema),
  priceInPerMtokUsdc: MicrosSchema,
  priceOutPerMtokUsdc: MicrosSchema,
  provider: ProviderSchema,
  providerAccountId: UuidSchema,
  sessionCutoffPct: Schema.Int,
  status: ListingStatusSchema,
  weeklyCutoffPct: Schema.Int,
});
export type Listing = typeof ListingSchema.Type;

/**
 * A listing offers exactly one model, priced for that model; to offer another model
 * from the same plan, create another listing.
 */
const ListingModelsSchema = Schema.Array(
  Schema.String.check(Schema.isNonEmpty())
).check(Schema.isMinLength(1), Schema.isMaxLength(1));

export const CreateListingRequestSchema = Schema.Struct({
  maxConcurrency: Schema.optionalKey(PositiveIntSchema),
  models: ListingModelsSchema,
  priceCacheReadPerMtokUsdc: Schema.optionalKey(
    Schema.NullOr(NonNegativeMicrosSchema)
  ),
  /** Null or omitted: 1.25× the input price. */
  priceCacheWritePerMtokUsdc: Schema.optionalKey(
    Schema.NullOr(NonNegativeMicrosSchema)
  ),
  priceInPerMtokUsdc: NonNegativeMicrosSchema,
  priceOutPerMtokUsdc: NonNegativeMicrosSchema,
  providerAccountId: UuidSchema,
  /** Default 90. */
  sessionCutoffPct: Schema.optionalKey(PctSchema),
  /** "draft" (default) or "live". */
  status: Schema.optionalKey(Schema.Literals(["draft", "live"])),
  /** Default 50. */
  weeklyCutoffPct: Schema.optionalKey(PctSchema),
});

export const UpdateListingRequestSchema = Schema.Struct({
  maxConcurrency: Schema.optionalKey(PositiveIntSchema),
  models: Schema.optionalKey(ListingModelsSchema),
  priceCacheReadPerMtokUsdc: Schema.optionalKey(
    Schema.NullOr(NonNegativeMicrosSchema)
  ),
  /** Null or omitted: 1.25× the input price. */
  priceCacheWritePerMtokUsdc: Schema.optionalKey(
    Schema.NullOr(NonNegativeMicrosSchema)
  ),
  priceInPerMtokUsdc: Schema.optionalKey(NonNegativeMicrosSchema),
  priceOutPerMtokUsdc: Schema.optionalKey(NonNegativeMicrosSchema),
  sessionCutoffPct: Schema.optionalKey(PctSchema),
  status: Schema.optionalKey(ListingStatusSchema),
  weeklyCutoffPct: Schema.optionalKey(PctSchema),
});

// Pricing

export const TokenPricesSchema = Schema.Struct({
  cacheReadPerMtokUsdc: MicrosSchema,
  inputPerMtokUsdc: MicrosSchema,
  outputPerMtokUsdc: MicrosSchema,
});

export const PriceVerdictSchema = Schema.Literals([
  "underpriced",
  "fair",
  "pricey",
  "above_api",
]);

export const PriceSuggestionQuerySchema = {
  /** Optional current listing prices, to get a verdict back. */
  inputPerMtokUsdc: Schema.optionalKey(NonNegativeMicrosSchema),
  model: Schema.String,
  outputPerMtokUsdc: Schema.optionalKey(NonNegativeMicrosSchema),
  provider: ProviderSchema,
};

/** A model with an API reference price: the models a listing can offer. */
export const ModelRefSchema = Schema.Struct({
  model: Schema.String,
  provider: ProviderSchema,
});

export const PriceSuggestionSchema = Schema.Struct({
  api: TokenPricesSchema,
  checkedAt: Schema.Date,
  max: TokenPricesSchema,
  min: TokenPricesSchema,
  model: Schema.String,
  provider: ProviderSchema,
  sourceUrl: Schema.String,
  suggested: TokenPricesSchema,
  verdict: Schema.NullOr(PriceVerdictSchema),
});

// Market

/** A live listing sold pay-per-request on the gateway's market route. */
export const MarketOfferSchema = Schema.Struct({
  listingId: UuidSchema,
  maxConcurrency: Schema.Int,
  models: Schema.Array(Schema.String),
  nodeId: UuidSchema,
  nodeStatus: NodeStatusSchema,
  priceInPerMtokUsdc: MicrosSchema,
  priceOutPerMtokUsdc: MicrosSchema,
  provider: ProviderSchema,
  /** The wallet buyers pay (the owner's sign-in address). */
  sellerWallet: Schema.String,
});
export type MarketOffer = typeof MarketOfferSchema.Type;

/** One paid request on the market: public, like the on-chain payment it points to. */
export const PaidRequestSchema = Schema.Struct({
  /** This payment's message on the spend audit log (an HCS topic); null until posted. */
  auditSequence: Schema.NullOr(Schema.Int),
  createdAt: Schema.Date,
  httpStatus: Schema.Int,
  inputTokens: Schema.Int,
  latencyMs: Schema.NullOr(Schema.Int),
  listingId: UuidSchema,
  maxTokens: Schema.Int,
  model: Schema.String,
  /** CAIP-2 network, e.g. "hedera:testnet". */
  network: Schema.String,
  outputTokens: Schema.Int,
  paidUsdc: MicrosSchema,
  payTo: Schema.String,
  payer: Schema.NullOr(Schema.String),
  paymentTx: Schema.String,
  requestId: Schema.String,
  status: Schema.Literals(["ok", "error", "cancelled"]),
  usedUsdc: MicrosSchema,
});
export type PaidRequest = typeof PaidRequestSchema.Type;

/** What one seller has sold on the market: totals, the last 24 hours and the latest requests. */
export const SalesTotalsSchema = Schema.Struct({
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  /** Paid by buyers straight to the seller's wallet. */
  paidUsdc: MicrosSchema,
  requests: Schema.Number,
});

export const OwnerSalesSchema = Schema.Struct({
  last24h: SalesTotalsSchema,
  lifetime: SalesTotalsSchema,
  /** Newest first, at most 50. */
  recent: Schema.Array(PaidRequestSchema),
});
export type OwnerSales = typeof OwnerSalesSchema.Type;

export const PaidRequestsQuerySchema = {
  /** Most recent first; default 25, at most 100. */
  limit: Schema.optionalKey(Schema.FiniteFromString),
};

// Owner dashboard

export const OwnerDashboardSchema = Schema.Struct({
  nodes: Schema.Array(NodeSchema),
  /** Latest meters per provider account. */
  providerAccounts: Schema.Array(ProviderAccountSchema),
});

// Cron

export const CronTickResultSchema = Schema.Struct({
  nodesMarkedOffline: Schema.Number,
});

// Buyer: spending limits the gateway enforces before a payment settles

/** A Hedera account id, e.g. "0.0.11331176". */
export const HederaAccountSchema = Schema.String.check(
  Schema.isPattern(/^\d+\.\d+\.\d+$/u)
);

const PositiveMicrosSchema = Schema.BigInt.check(
  Schema.isGreaterThanBigInt(0n)
);

/** Null limits mean "no limit"; `allowedSellers` null means any seller. */
export const BuyerPolicySchema = Schema.Struct({
  /** Sellers (Hedera accounts) this buyer may pay. */
  allowedSellers: Schema.NullOr(Schema.Array(HederaAccountSchema)),
  /** Most paid in any rolling 24 hours, across all sellers (USDC micros). */
  dailyBudgetUsdc: Schema.NullOr(PositiveMicrosSchema),
  /** Largest single payment (USDC micros). */
  maxPerRequestUsdc: Schema.NullOr(PositiveMicrosSchema),
  /** True refuses every payment. */
  paused: Schema.Boolean,
  /** Most paid to any one seller in any rolling 24 hours (USDC micros). */
  perSellerDailyUsdc: Schema.NullOr(PositiveMicrosSchema),
});
export type BuyerPolicy = typeof BuyerPolicySchema.Type;

export const UpdateBuyerPolicyRequestSchema = Schema.Struct({
  allowedSellers: Schema.NullOr(
    Schema.Array(HederaAccountSchema).check(Schema.isMaxLength(50))
  ),
  dailyBudgetUsdc: Schema.NullOr(PositiveMicrosSchema),
  maxPerRequestUsdc: Schema.NullOr(PositiveMicrosSchema),
  paused: Schema.Boolean,
  perSellerDailyUsdc: Schema.NullOr(PositiveMicrosSchema),
});

export const BuyerSellerSpendSchema = Schema.Struct({
  paidUsdc: MicrosSchema,
  payTo: Schema.String,
  requests: Schema.Int,
});

export const BuyerOverviewSchema = Schema.Struct({
  /** The Hedera account behind the sign-in wallet; null when it has none yet. */
  account: Schema.NullOr(Schema.String),
  /** Paid in the last 24 hours, per seller, biggest first. */
  bySeller: Schema.Array(BuyerSellerSpendSchema),
  /** Null until the buyer saves limits; the gateway then applies none. */
  policy: Schema.NullOr(BuyerPolicySchema),
  /** Newest first, at most 25. */
  recent: Schema.Array(PaidRequestSchema),
  /** Paid in the last 24 hours, all sellers. */
  spentLast24hUsdc: MicrosSchema,
});
export type BuyerOverview = typeof BuyerOverviewSchema.Type;
