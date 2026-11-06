/**
 * Plain data types for components, read off the contract's schemas. Money is
 * `bigint` micros and instants are `Date`, as the client decodes them; both
 * cross the Server -> Client Component boundary intact.
 */
import type {
  BuyerOverviewSchema,
  BuyerPolicySchema,
  ListingSchema,
  MarketOfferSchema,
  NodeIdentitySchema,
  ModelRefSchema,
  NodeSchema,
  NodeUptimeSchema,
  OwnerDashboardSchema,
  OwnerSalesSchema,
  PaidRequestSchema,
  PriceSuggestionSchema,
  PriceVerdictSchema,
  ProviderAccountSchema,
  ProviderSchema,
  RegisterNodeResponseSchema,
  UserSchema,
} from "@rentanllm/api-contract";

export type User = typeof UserSchema.Type;
export type ModelRef = typeof ModelRefSchema.Type;
export type Provider = typeof ProviderSchema.Type;
export type ApiNode = typeof NodeSchema.Type;
export type NodeUptime = typeof NodeUptimeSchema.Type;
export type RegisteredNode = typeof RegisterNodeResponseSchema.Type;
export type ProviderAccount = typeof ProviderAccountSchema.Type;
export type Listing = typeof ListingSchema.Type;
export type MarketOffer = typeof MarketOfferSchema.Type;
export type NodeIdentity = typeof NodeIdentitySchema.Type;
export type AgentIdentity = NonNullable<NodeIdentity["agent"]>;
export type SellerReputation = MarketOffer["reputation"];
export type PaidRequest = typeof PaidRequestSchema.Type;
export type OwnerDashboard = typeof OwnerDashboardSchema.Type;
export type PriceSuggestion = typeof PriceSuggestionSchema.Type;
export type PriceVerdict = typeof PriceVerdictSchema.Type;
export type OwnerSales = typeof OwnerSalesSchema.Type;
export type SalesTotals = OwnerSales["lifetime"];
export type BuyerOverview = typeof BuyerOverviewSchema.Type;
export type BuyerPolicy = typeof BuyerPolicySchema.Type;
