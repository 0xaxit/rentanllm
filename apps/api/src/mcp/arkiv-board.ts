/**
 * Reads the gateway's offers from Arkiv for list_models. A slow or unreachable Arkiv must
 * not stall Claude, so a read gives up after a few seconds and the caller falls back.
 */
import { setTimeout as sleep } from "node:timers/promises";

import { arkivReader, readOffers } from "@rentanllm/arkiv";
import type { PublishedOffer } from "@rentanllm/arkiv";

/** The gateway's Arkiv writer (public; see README). */
const DEFAULT_WRITER = "0x9d8942916A81159596BD37384403d90466e8E84b";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const READ_TIMEOUT_MS = 5000;

export const arkivBoardReader = () => {
  const configured = process.env.ARKIV_WRITER_ADDRESS?.trim() ?? "";
  const writer = (
    ADDRESS.test(configured) ? configured : DEFAULT_WRITER
  ) as `0x${string}`;
  const reader = arkivReader(process.env.ARKIV_ACCESS_KEY?.trim() ?? "");
  return async (): Promise<{
    readonly offers: readonly PublishedOffer[];
    readonly writer: string;
  } | null> => {
    const cancel = new AbortController();
    const timeout = sleep(READ_TIMEOUT_MS, null, { signal: cancel.signal });
    try {
      const offers = await Promise.race([readOffers(reader, writer), timeout]);
      return offers === null ? null : { offers, writer };
    } catch {
      return null;
    } finally {
      cancel.abort();
    }
  };
};
