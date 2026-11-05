/**
 * The market as published on Arkiv, read straight from the chain (server-only): no
 * RentAnLLM API in the path, so anyone can check the same data with the same query.
 */
import { setTimeout as sleep } from "node:timers/promises";

import { arkivReader, readOffers, readReceipts } from "@rentanllm/arkiv";
import type { PublishedOffer, PublishedReceipt } from "@rentanllm/arkiv";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
/** A slow Arkiv RPC must not hold up the page. */
const READ_TIMEOUT_MS = 5000;

const timedOut = async (signal: AbortSignal): Promise<never> => {
  await sleep(READ_TIMEOUT_MS, undefined, { signal });
  throw new Error("Arkiv took too long to answer");
};

const withTimeout = async <A>(work: Promise<A>): Promise<A> => {
  const cancel = new AbortController();
  try {
    return await Promise.race([work, timedOut(cancel.signal)]);
  } finally {
    cancel.abort();
  }
};

/** The gateway's Arkiv writer (ARKIV_WRITER_ADDRESS); only its entities are trusted. */
export const ARKIV_WRITER = ((): `0x${string}` | null => {
  const value = process.env.ARKIV_WRITER_ADDRESS?.trim() ?? "";
  return ADDRESS.test(value) ? (value as `0x${string}`) : null;
})();

export interface ArkivBoard {
  readonly offers: readonly PublishedOffer[];
  readonly receipts: readonly PublishedReceipt[];
  readonly writer: `0x${string}`;
}

export type ArkivRead =
  | { readonly kind: "off" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly board: ArkivBoard; readonly kind: "ok" };

export const getArkivBoard = async (): Promise<ArkivRead> => {
  if (ARKIV_WRITER === null) {
    return { kind: "off" };
  }
  const reader = arkivReader(process.env.ARKIV_ACCESS_KEY?.trim() ?? "");
  try {
    const [offers, receipts] = await withTimeout(
      Promise.all([
        readOffers(reader, ARKIV_WRITER),
        readReceipts(reader, ARKIV_WRITER, 10),
      ])
    );
    return { board: { offers, receipts, writer: ARKIV_WRITER }, kind: "ok" };
  } catch (error) {
    return {
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
};
