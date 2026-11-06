/**
 * Server Component loaders. Each returns an `ApiResult` of plain data; the
 * signed-in ones forward the session cookie.
 */
import { Effect } from "effect";

import type { ApiResult } from "./errors";
import { publicApi, serverApi } from "./server";
import type {
  AgentWallet,
  BuyerOverview,
  Listing,
  MarketOffer,
  ModelRef,
  NodeIdentity,
  NodeUptime,
  OAuthGrant,
  OwnerDashboard,
  OwnerSales,
  PaidRequest,
  PriceSuggestion,
  Provider,
  User,
} from "./types";

/** The signed-in buyer's paying account, limits and last 24 hours of spend. */
export const getBuyerOverview = async (): Promise<ApiResult<BuyerOverview>> =>
  await serverApi((api) => api.buyer.overview());

/** The signed-in buyer's agent wallet (null before it exists). */
export const getAgentWallet = async (): Promise<
  ApiResult<AgentWallet | null>
> => await serverApi((api) => api.buyer.agentWallet());

/** A pending connector authorization, for the consent page. */
export const getOAuthGrant = async (
  grantId: string
): Promise<ApiResult<OAuthGrant>> =>
  await serverApi((api) => api.oauth.grant({ params: { grantId } }));

export const getMe = async (): Promise<ApiResult<User>> =>
  await serverApi((api) => api.auth.me());

export interface OwnerOverview {
  readonly me: User;
  readonly dashboard: OwnerDashboard;
  readonly listings: readonly Listing[];
  readonly sales: OwnerSales;
}

export const getOwnerOverview = async (): Promise<ApiResult<OwnerOverview>> =>
  await serverApi((api) =>
    Effect.all(
      {
        dashboard: api.owner.dashboard(),
        listings: api.owner.listListings(),
        me: api.auth.me(),
        sales: api.owner.sales(),
      },
      { concurrency: "unbounded" }
    )
  );

/** Uptime per node id; a node whose uptime could not be read maps to null. */
export const getNodeUptimes = async (
  nodeIds: readonly string[]
): Promise<ReadonlyMap<string, NodeUptime | null>> => {
  const results = await Promise.all(
    nodeIds.map(
      async (nodeId) =>
        [
          nodeId,
          await serverApi((api) =>
            api.owner.nodeUptime({ params: { nodeId } })
          ),
        ] as const
    )
  );
  return new Map(
    results.map(([nodeId, result]) => [nodeId, result.ok ? result.data : null])
  );
};

/** The node's ERC-8004 agent and what to register it with. */
export const getNodeIdentity = async (
  nodeId: string
): Promise<ApiResult<NodeIdentity>> =>
  await serverApi((api) => api.owner.nodeIdentity({ params: { nodeId } }));

export const getMarketOffers = async (): Promise<
  ApiResult<readonly MarketOffer[]>
> => await publicApi((api) => api.market.offers());

/** The latest paid market requests, newest first. */
export const getPaidRequests = async (): Promise<
  ApiResult<readonly PaidRequest[]>
> => await publicApi((api) => api.market.requests({ query: {} }));

export const getModelCatalog = async (): Promise<readonly ModelRef[]> => {
  const result = await publicApi((api) => api.pricing.models());
  return result.ok ? result.data : [];
};

/** Suggested price for a provider/model; null when there is no reference price. */
export const getSuggestion = async (input: {
  readonly provider: Provider;
  readonly model: string;
}): Promise<PriceSuggestion | null> => {
  const result = await publicApi((api) =>
    api.pricing.suggestion({
      query: { model: input.model, provider: input.provider },
    })
  );
  return result.ok ? result.data : null;
};
