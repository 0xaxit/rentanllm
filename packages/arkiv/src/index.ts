/**
 * RentAnLLM's public market data on Arkiv (Rabdi testnet). The gateway writes two kinds
 * of entity, and anyone can read them without an account or our API:
 *
 * - `rentanllm.offer`: one per (listing, model) for sale right now, with its prices and
 *   the wallet buyers pay. Short-lived: the gateway re-publishes them every few minutes,
 *   so a seller that stops being listed simply expires.
 * - `rentanllm.receipt`: one per paid request, pointing at its on-chain payment.
 *
 * Readers filter by the gateway's writer address: anyone can write entities under the
 * same schema names, so only the writer's own count.
 */
import {
  createPublicClient,
  createWalletClient,
  ExpirationTime,
} from "@arkiv-network/sdk";
import type { PublicArkivClient, WalletArkivClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { desc, eq } from "@arkiv-network/sdk/query";
import { bool, defineSchema, str, u64 } from "@arkiv-network/sdk/schema";
import { http } from "viem";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const OfferSchema = defineSchema("rentanllm.offer", {
  /** `${listingId}:${model}`: one entity per model a listing sells. */
  id: str().indexed(),
  listing: str().indexed(),
  model: str().indexed(),
  /** CAIP-2 network buyers pay on, e.g. "hedera:testnet". */
  network: str().indexed(),
  online: bool().indexed(),
  /** The seller's wallet (EVM address); on Hedera, its 0.0.x account is looked up. */
  payTo: str(),
  /** Micro-USDC per million tokens. */
  priceIn: u64().indexed(),
  priceOut: u64().indexed(),
  /** Where to send the request: the gateway's OpenAI-compatible base URL. */
  url: str(),
});

export const ReceiptSchema = defineSchema("rentanllm.receipt", {
  /** Unix milliseconds the request was paid. */
  at: u64().indexed(),
  inputTokens: u64(),
  listing: str().indexed(),
  model: str().indexed(),
  network: str().indexed(),
  outputTokens: u64(),
  /** Micro-USDC paid to the seller before the request ran. */
  paid: u64().indexed(),
  payTo: str().indexed(),
  /** The settlement transaction (EVM hash or Hedera transaction id). */
  paymentTx: str(),
  requestId: str().indexed(),
  status: str().indexed(),
});

/** Offers live this long unless re-published; the gateway refreshes well before. */
export const OFFER_TTL_SECONDS = 15 * 60;
/** Receipts stay readable for this long. */
export const RECEIPT_TTL_DAYS = 30;
/** Arkiv's query page size cap. */
const MAX_PAGE = 100;

export const EXPLORER_URL = "https://rabdi.explorer.arkiv.network";
export const entityUrl = (key: string): string =>
  `${EXPLORER_URL}/entity/${key}`;
export const txUrl = (hash: string): string => `${EXPLORER_URL}/tx/${hash}`;

/** An offer as the gateway knows it; written to Arkiv as one entity. */
export interface Offer {
  readonly listing: string;
  readonly model: string;
  readonly network: string;
  readonly online: boolean;
  readonly payTo: string;
  readonly priceIn: bigint;
  readonly priceOut: bigint;
  readonly url: string;
}

/** An offer read back from Arkiv, with its entity key. */
export interface PublishedOffer extends Offer {
  readonly key: Hex;
}

export interface Receipt {
  readonly at: Date;
  readonly inputTokens: number;
  readonly listing: string;
  readonly model: string;
  readonly network: string;
  readonly outputTokens: number;
  readonly paid: bigint;
  readonly payTo: string;
  readonly paymentTx: string;
  readonly requestId: string;
  readonly status: string;
}

export interface PublishedReceipt extends Receipt {
  readonly key: Hex;
}

export const offerId = (offer: Pick<Offer, "listing" | "model">): string =>
  `${offer.listing}:${offer.model}`;

const chainFor = (accessKey: string) => rabdi({ accessKey });

/** Read-only client: no key needed. An empty access key uses Arkiv's rate-limited public RPC. */
export const arkivReader = (accessKey = ""): PublicArkivClient =>
  createPublicClient({ chain: chainFor(accessKey), transport: http() });

export const arkivWriter = (
  privateKey: Hex,
  accessKey = ""
): WalletArkivClient =>
  createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: chainFor(accessKey),
    transport: http(),
  });

export const writerAddress = (privateKey: Hex): Hex =>
  privateKeyToAccount(privateKey).address;

const offerValues = (offer: Offer) => ({
  id: offerId(offer),
  listing: offer.listing,
  model: offer.model,
  network: offer.network,
  online: offer.online,
  payTo: offer.payTo,
  priceIn: u64(offer.priceIn),
  priceOut: u64(offer.priceOut),
  url: offer.url,
});

export interface OfferPlan {
  readonly create: readonly Offer[];
  /** Existing entities to rewrite and give a fresh TTL. */
  readonly refresh: readonly { readonly key: Hex; readonly offer: Offer }[];
  readonly remove: readonly Hex[];
}

/**
 * What one sync writes: every wanted offer is created or refreshed (so its TTL restarts),
 * and published offers no longer wanted are deleted rather than left to expire.
 * Duplicates of one id (from an interrupted earlier sync) are deleted too.
 */
export const planOfferSync = (
  published: readonly Pick<PublishedOffer, "key" | "listing" | "model">[],
  wanted: readonly Offer[]
): OfferPlan => {
  const byId = new Map<string, Hex>();
  const remove: Hex[] = [];
  for (const entity of published) {
    const id = offerId(entity);
    if (byId.has(id)) {
      remove.push(entity.key);
    } else {
      byId.set(id, entity.key);
    }
  }
  const create: Offer[] = [];
  const refresh: { key: Hex; offer: Offer }[] = [];
  const wantedIds = new Set<string>();
  for (const offer of wanted) {
    const id = offerId(offer);
    if (wantedIds.has(id)) {
      continue;
    }
    wantedIds.add(id);
    const key = byId.get(id);
    if (key === undefined) {
      create.push(offer);
    } else {
      refresh.push({ key, offer });
    }
  }
  for (const [id, key] of byId) {
    if (!wantedIds.has(id)) {
      remove.push(key);
    }
  }
  return { create, refresh, remove };
};

const toOffer = (row: Record<string, { value: unknown } | unknown>) => {
  const value = (name: string) =>
    (row[name] as { value: unknown } | undefined)?.value;
  return {
    key: row.$key as Hex,
    listing: String(value("listing")),
    model: String(value("model")),
    network: String(value("network")),
    online: value("online") === true,
    payTo: String(value("payTo")),
    priceIn: BigInt(value("priceIn") as bigint),
    priceOut: BigInt(value("priceOut") as bigint),
    url: String(value("url")),
  } satisfies PublishedOffer;
};

/** Every offer the writer has published, cheapest output first. */
export const readOffers = async (
  reader: PublicArkivClient,
  writer: Hex,
  model?: string
): Promise<PublishedOffer[]> => {
  const offers: PublishedOffer[] = [];
  for (let offset = 0; ; offset += MAX_PAGE) {
    let query = reader
      .select({
        $key: true,
        listing: true,
        model: true,
        network: true,
        online: true,
        payTo: true,
        priceIn: true,
        priceOut: true,
        url: true,
      })
      .from(OfferSchema)
      .ownedBy(writer);
    if (model !== undefined) {
      query = query.where(eq("model", model));
    }
    // oxlint-disable-next-line no-await-in-loop -- offset pages, one after another
    const page = await query
      .orderBy(desc("$key"))
      .limit(MAX_PAGE)
      .offset(offset)
      .fetch();
    for (const row of page.entities) {
      offers.push(toOffer(row as Record<string, unknown>));
    }
    if (page.entities.length < MAX_PAGE) {
      break;
    }
  }
  return offers.toSorted((a, b) => Number(a.priceOut - b.priceOut));
};

/** Brings the writer's published offers in line with `wanted`, in one transaction. */
export const syncOffers = async (
  reader: PublicArkivClient,
  writer: WalletArkivClient,
  wanted: readonly Offer[]
): Promise<{ readonly plan: OfferPlan; readonly txHash: Hex | null }> => {
  const owner = writer.account?.address;
  if (owner === undefined) {
    throw new Error("the Arkiv writer has no account");
  }
  const published = await readOffers(reader, owner);
  const plan = planOfferSync(published, wanted);
  const expiration = ExpirationTime.fromSeconds(OFFER_TTL_SECONDS);
  const nothing =
    plan.create.length + plan.refresh.length + plan.remove.length === 0;
  if (nothing) {
    return { plan, txHash: null };
  }
  const { txHash } = await writer.executeBatch({
    creates: plan.create.map((offer) => ({
      expiration,
      schema: OfferSchema,
      values: offerValues(offer),
    })),
    deletes: plan.remove.map((entityKey) => ({ entityKey })),
    extensions: plan.refresh.map(({ key }) => ({ entityKey: key, expiration })),
    patches: plan.refresh.map(({ key, offer }) => ({
      entityKey: key,
      schema: OfferSchema,
      set: offerValues(offer),
    })),
  });
  return { plan, txHash };
};

/** Writes one paid request's receipt; returns its entity key. */
export const publishReceipt = async (
  writer: WalletArkivClient,
  receipt: Receipt
): Promise<{ readonly key: Hex; readonly txHash: Hex }> => {
  const { entityKey, txHash } = await writer.createEntity(
    ReceiptSchema,
    {
      at: u64(receipt.at.getTime()),
      inputTokens: u64(receipt.inputTokens),
      listing: receipt.listing,
      model: receipt.model,
      network: receipt.network,
      outputTokens: u64(receipt.outputTokens),
      paid: u64(receipt.paid),
      payTo: receipt.payTo,
      paymentTx: receipt.paymentTx,
      requestId: receipt.requestId,
      status: receipt.status,
    },
    { expiration: ExpirationTime.fromDays(RECEIPT_TTL_DAYS) }
  );
  return { key: entityKey, txHash };
};

/** The writer's latest receipts, newest first. */
export const readReceipts = async (
  reader: PublicArkivClient,
  writer: Hex,
  limit = 25
): Promise<PublishedReceipt[]> => {
  const page = await reader
    .select({
      $key: true,
      at: true,
      inputTokens: true,
      listing: true,
      model: true,
      network: true,
      outputTokens: true,
      paid: true,
      payTo: true,
      paymentTx: true,
      requestId: true,
      status: true,
    })
    .from(ReceiptSchema)
    .ownedBy(writer)
    .orderBy(desc("at"))
    .limit(Math.min(limit, MAX_PAGE))
    .fetch();
  return page.entities.map((entity) => {
    const row = entity as Record<string, unknown>;
    const value = (name: string) =>
      (row[name] as { value: unknown } | undefined)?.value;
    return {
      at: new Date(Number(value("at"))),
      inputTokens: Number(value("inputTokens")),
      key: row.$key as Hex,
      listing: String(value("listing")),
      model: String(value("model")),
      network: String(value("network")),
      outputTokens: Number(value("outputTokens")),
      paid: BigInt(value("paid") as bigint),
      payTo: String(value("payTo")),
      paymentTx: String(value("paymentTx")),
      requestId: String(value("requestId")),
      status: String(value("status")),
    };
  });
};
