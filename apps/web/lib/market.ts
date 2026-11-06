/** Labels for providers and listing models, and the market summarized per model. */
import type { MarketOffer, Provider } from "./api/types";

const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: "CLAUDE",
  google: "GEMINI",
  ollama: "OPEN MODELS",
  openai: "CHATGPT",
  xai: "GROK",
};

export const providerLabel = (provider: Provider): string =>
  PROVIDER_LABEL[provider];

/** "opus-5.5", "opus-5.5 +2". */
export const modelsLabel = (models: readonly string[]): string => {
  const [first, ...rest] = models;
  if (first === undefined) {
    return "any model";
  }
  return rest.length > 0 ? `${first} +${rest.length}` : first;
};

/** One model on the market: its sellers, how many are online, the cheapest prices. */
export interface MarketModel {
  readonly cheapestIn: bigint;
  /** "image": cheapestOut is the price of one image. */
  readonly kind: MarketOffer["kind"];
  readonly cheapestOut: bigint;
  readonly model: string;
  readonly online: number;
  readonly sellers: number;
}

/** One row per model from the listed offers, models with sellers online first. */
export const marketModels = (offers: readonly MarketOffer[]): MarketModel[] => {
  const rows = new Map<string, MarketModel>();
  for (const offer of offers) {
    const online = offer.nodeStatus === "online" ? 1 : 0;
    for (const model of offer.models) {
      const row = rows.get(model);
      rows.set(model, {
        cheapestIn:
          row === undefined || offer.priceInPerMtokUsdc < row.cheapestIn
            ? offer.priceInPerMtokUsdc
            : row.cheapestIn,
        cheapestOut:
          row === undefined || offer.priceOutPerMtokUsdc < row.cheapestOut
            ? offer.priceOutPerMtokUsdc
            : row.cheapestOut,
        kind: offer.kind,
        model,
        online: (row?.online ?? 0) + online,
        sellers: (row?.sellers ?? 0) + 1,
      });
    }
  }
  return [...rows.values()].toSorted(
    (a, b) => b.online - a.online || a.model.localeCompare(b.model)
  );
};

/**
 * A listing's price as people read it: "$0.05 · $0.20" per million tokens in and out,
 * or "$0.002 / image" (an image is billed as one million output tokens).
 */
export const priceLabel = (
  kind: MarketOffer["kind"],
  priceIn: bigint,
  priceOut: bigint,
  format: (micros: bigint) => string
): string =>
  kind === "image"
    ? `${format(priceOut)} / image`
    : `${format(priceIn)} · ${format(priceOut)}`;
