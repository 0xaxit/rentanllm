/**
 * Records the gateway reads from its stores. The in-memory layers (services/memory.ts)
 * and the Postgres layers (services/postgres-*.ts) both return these shapes.
 *
 * Money is always integer USDC micros held as `bigint` (`Micros` from @rentanllm/core).
 */
import type { Micros, TokenPrices } from "@rentanllm/core";
import type { Provider, ProviderUsage, UsageMeters } from "@rentanllm/protocol";

export interface NodeAvailability {
  readonly open: boolean;
  readonly sessionCutoffPct: number;
  readonly weeklyCutoffPct: number;
}

/** An owner's node agent. Only the SHA-256 hex digest of its tunnel token is stored. */
export interface NodeRecord {
  /** Sent to the node as `SetAvailability` after it says hello; null sends nothing. */
  readonly availability: NodeAvailability | null;
  readonly nodeId: string;
  readonly tokenHash: string;
}

/** Latest meters a node reported for one provider, plus when the gateway received them. */
export interface MeterReading {
  readonly meters: UsageMeters;
  readonly provider: Provider;
  readonly receivedAt: Date;
}

export type UsageStatus = "ok" | "error" | "cancelled";

/**
 * A live listing as the market route sees it: one owner's node selling `models` at
 * per-million-token prices, paid straight to the owner's wallet.
 */
export interface MarketOffer {
  readonly listingId: string;
  readonly maxConcurrency: number;
  readonly models: readonly string[];
  readonly nodeId: string;
  readonly ownerId: string;
  /** The owner's EVM wallet (sign-in address); payments go here or to its Hedera account. */
  readonly ownerWallet: string;
  readonly prices: TokenPrices;
  readonly provider: Provider;
}

/** One pay-per-request purchase, written once when the request finishes. */
export interface PaidRequestRecord {
  readonly finishedAt: Date;
  readonly httpStatus: number;
  readonly latencyMs: number;
  readonly listingId: string;
  readonly maxTokens: number;
  readonly model: string;
  /** CAIP-2 network the payment settled on. */
  readonly network: string;
  readonly nodeId: string;
  readonly ownerId: string;
  readonly paidMicros: Micros;
  readonly payer: string | null;
  readonly payTo: string;
  readonly paymentTx: string;
  readonly prices: TokenPrices;
  readonly requestId: string;
  readonly status: UsageStatus;
  readonly ttfbMs: number | null;
  readonly usage: ProviderUsage | null;
  /** What the usage cost at the listing's prices. */
  readonly usedMicros: Micros;
}
