/**
 * Browser-side calls for interactive components. The session cookie rides
 * along with `credentials: "include"`.
 */
import { callApi } from "./client";
import type { ApiResult } from "./errors";
import type {
  AgentWallet,
  ApiNode,
  BuyerPolicy,
  Listing,
  NodeIdentity,
  PriceSuggestion,
  Provider,
  ProviderAccount,
  RegisteredNode,
} from "./types";

/** The region is not sent: the gateway infers it from where the agent connects. */
export const registerNode = async (): Promise<ApiResult<RegisteredNode>> =>
  await callApi((api) => api.owner.registerNode({ payload: {} }));

/** Issues a fresh node token (shown once); the old token stops working. */
export const rotateNodeToken = async (
  nodeId: string
): Promise<ApiResult<RegisteredNode>> =>
  await callApi((api) => api.owner.rotateNodeToken({ params: { nodeId } }));

export const listNodes = async (): Promise<ApiResult<readonly ApiNode[]>> =>
  await callApi((api) => api.owner.listNodes());

export const addProviderAccount = async (
  nodeId: string,
  input: {
    readonly provider: Provider;
    readonly credentialRef?: string;
  }
): Promise<ApiResult<ProviderAccount>> =>
  await callApi((api) =>
    api.owner.addProviderAccount({
      params: { nodeId },
      payload: {
        provider: input.provider,
        ...(input.credentialRef ? { credentialRef: input.credentialRef } : {}),
      },
    })
  );

export interface ListingPrices {
  readonly priceInPerMtokUsdc: bigint;
  readonly priceOutPerMtokUsdc: bigint;
  readonly priceCacheReadPerMtokUsdc: bigint | null;
  /** Null: 1.25× the input price. */
  readonly priceCacheWritePerMtokUsdc: bigint | null;
}

export const createListing = async (
  input: ListingPrices & {
    readonly kind?: "chat" | "image";
    readonly providerAccountId: string;
    readonly models: readonly string[];
    readonly sessionCutoffPct: number;
    readonly weeklyCutoffPct: number;
    readonly status: "draft" | "live";
  }
): Promise<ApiResult<Listing>> =>
  await callApi((api) =>
    api.owner.createListing({
      payload: {
        ...(input.kind === undefined ? {} : { kind: input.kind }),
        models: input.models,
        priceCacheReadPerMtokUsdc: input.priceCacheReadPerMtokUsdc,
        priceCacheWritePerMtokUsdc: input.priceCacheWritePerMtokUsdc,
        priceInPerMtokUsdc: input.priceInPerMtokUsdc,
        priceOutPerMtokUsdc: input.priceOutPerMtokUsdc,
        providerAccountId: input.providerAccountId,
        sessionCutoffPct: input.sessionCutoffPct,
        status: input.status,
        weeklyCutoffPct: input.weeklyCutoffPct,
      },
    })
  );

export interface ListingPatch {
  readonly models?: readonly string[];
  readonly priceInPerMtokUsdc?: bigint;
  readonly priceOutPerMtokUsdc?: bigint;
  readonly priceCacheReadPerMtokUsdc?: bigint | null;
  readonly priceCacheWritePerMtokUsdc?: bigint | null;
  readonly sessionCutoffPct?: number;
  readonly weeklyCutoffPct?: number;
  readonly status?: "draft" | "live" | "paused";
}

export const updateListing = async (
  listingId: string,
  patch: ListingPatch
): Promise<ApiResult<Listing>> =>
  await callApi((api) =>
    api.owner.updateListing({ params: { listingId }, payload: patch })
  );

export const pauseListing = async (
  listingId: string
): Promise<ApiResult<Listing>> =>
  await callApi((api) => api.owner.pauseListing({ params: { listingId } }));

export const getPriceSuggestion = async (input: {
  readonly provider: Provider;
  readonly model: string;
  readonly inputPerMtokUsdc?: bigint;
  readonly outputPerMtokUsdc?: bigint;
}): Promise<ApiResult<PriceSuggestion>> =>
  await callApi((api) =>
    api.pricing.suggestion({
      query: {
        model: input.model,
        provider: input.provider,
        ...(input.inputPerMtokUsdc === undefined
          ? {}
          : { inputPerMtokUsdc: input.inputPerMtokUsdc }),
        ...(input.outputPerMtokUsdc === undefined
          ? {}
          : { outputPerMtokUsdc: input.outputPerMtokUsdc }),
      },
    })
  );

/** Saves the signed-in buyer's spending limits; the gateway applies them at once. */
export const updateBuyerPolicy = async (
  policy: BuyerPolicy
): Promise<ApiResult<BuyerPolicy>> =>
  await callApi((api) => api.buyer.updatePolicy({ payload: policy }));

/** Links the ERC-8004 agent the owner registered; the API checks it on chain. */
export const linkNodeIdentity = async (
  nodeId: string,
  agentId: string
): Promise<ApiResult<NodeIdentity>> =>
  await callApi((api) =>
    api.owner.linkNodeIdentity({ params: { nodeId }, payload: { agentId } })
  );

/** Creates the buyer's agent wallet, or returns the one they have. */
export const createAgentWallet = async (): Promise<ApiResult<AgentWallet>> =>
  await callApi((api) => api.buyer.createAgentWallet());

/** Approves a connector; the browser then follows `redirectUrl` back to the client. */
export const approveConnection = async (
  grantId: string
): Promise<ApiResult<{ readonly redirectUrl: string }>> =>
  await callApi((api) => api.oauth.approve({ params: { grantId } }));

export const denyConnection = async (
  grantId: string
): Promise<ApiResult<{ readonly redirectUrl: string }>> =>
  await callApi((api) => api.oauth.deny({ params: { grantId } }));
