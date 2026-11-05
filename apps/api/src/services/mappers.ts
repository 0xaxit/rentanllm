/** Row -> API contract shape conversions. */
import type {
  Listing,
  Node,
  ProviderAccount,
  User,
} from "@rentanllm/api-contract";
import type {
  listings,
  nodes,
  providerAccounts,
  users,
} from "@rentanllm/db/schema";

type UserRow = typeof users.$inferSelect;
type NodeRow = typeof nodes.$inferSelect;
type ProviderAccountRow = typeof providerAccounts.$inferSelect;
type ListingRow = typeof listings.$inferSelect;

export const toUser = (row: UserRow): User => ({
  createdAt: row.createdAt,
  id: row.id,
  isOwner: row.isOwner,
  isRenter: row.isRenter,
  walletAddress: row.walletAddress,
});

export const toNode = (row: NodeRow): Node => ({
  connectedAt: row.connectedAt,
  createdAt: row.createdAt,
  detectedPlans: row.detectedPlans,
  id: row.id,
  lastHeartbeatAt: row.lastHeartbeatAt,
  mode: row.mode,
  region: row.region,
  status: row.status,
  version: row.version,
});

export const toProviderAccount = (
  row: ProviderAccountRow
): ProviderAccount => ({
  authKind: row.authKind,
  id: row.id,
  lastLimitHitAt: row.lastLimitHitAt,
  nodeId: row.nodeId,
  planTier: row.planTier,
  provider: row.provider,
  sessionResetsAt: row.sessionResetsAt,
  sessionUsedPct: row.sessionUsedPct,
  status: row.status,
  usageReadAt: row.usageReadAt,
  weeklyResetsAt: row.weeklyResetsAt,
  weeklyUsedPct: row.weeklyUsedPct,
});

export const toListing = (
  row: ListingRow,
  provider: Listing["provider"]
): Listing => ({
  id: row.id,
  maxConcurrency: row.maxConcurrency,
  models: row.models,
  priceCacheReadPerMtokUsdc: row.priceCacheReadPerMtokUsdc,
  priceCacheWritePerMtokUsdc: row.priceCacheWritePerMtokUsdc,
  priceInPerMtokUsdc: row.priceInPerMtokUsdc,
  priceOutPerMtokUsdc: row.priceOutPerMtokUsdc,
  provider,
  providerAccountId: row.providerAccountId,
  sessionCutoffPct: row.sessionCutoffPct,
  status: row.status,
  weeklyCutoffPct: row.weeklyCutoffPct,
});
