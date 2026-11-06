/**
 * The models for sale as the site shows them: read from the public Arkiv board (the
 * gateway's `rentanllm.offer` entities), one row per listing and model. Our API only adds
 * what Arkiv does not carry: the seller's uptime, TTFB, slots and ERC-8004 agent. When
 * Arkiv does not answer, the rows come from the API instead and say so.
 */
import { getMarketOffers } from "./api/queries";
import type { MarketOffer } from "./api/types";
import { getArkivOffers } from "./arkiv";

/** A market offer plus the Arkiv entity it was read from (null when read from the API). */
export interface BoardOffer extends MarketOffer {
  readonly arkivEntity: string | null;
}

export interface Board {
  readonly offers: readonly BoardOffer[];
  /** "arkiv": read from Arkiv; "api": Arkiv was off or did not answer. */
  readonly source: "api" | "arkiv";
  /** The Arkiv writer whose entities were trusted; null when read from the API. */
  readonly writer: string | null;
}

const NO_REPUTATION: MarketOffer["reputation"] = {
  requests24h: 0,
  successPct: null,
  ttfbMs: null,
  uptimePct: null,
};

/** Null only when neither Arkiv nor the API answered. */
export const getBoard = async (): Promise<Board | null> => {
  const [arkiv, api] = await Promise.all([getArkivOffers(), getMarketOffers()]);
  const apiOffers = api.ok ? api.data : [];
  if (arkiv.kind !== "ok") {
    return api.ok
      ? {
          offers: apiOffers.map((offer) => ({ ...offer, arkivEntity: null })),
          source: "api",
          writer: null,
        }
      : null;
  }
  const byListing = new Map(apiOffers.map((offer) => [offer.listingId, offer]));
  const offers = arkiv.offers.map((entity): BoardOffer => {
    const known = byListing.get(entity.listing);
    return {
      agent: known?.agent ?? null,
      arkivEntity: entity.key,
      kind: entity.kind,
      listingId: entity.listing,
      maxConcurrency: known?.maxConcurrency ?? 1,
      models: [entity.model],
      nodeId: known?.nodeId ?? "",
      nodeStatus: entity.online ? "online" : "offline",
      priceInPerMtokUsdc: entity.priceIn,
      priceOutPerMtokUsdc: entity.priceOut,
      provider: known?.provider ?? "ollama",
      reputation: known?.reputation ?? NO_REPUTATION,
      sellerWallet: known?.sellerWallet ?? entity.payTo,
    };
  });
  return { offers, source: "arkiv", writer: arkiv.writer };
};
