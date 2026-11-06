import { Config, Context, Effect, Layer, Redacted } from "effect";

import { HEDERA_TESTNET } from "./x402/chains.ts";
import type { PaymentChain } from "./x402/chains.ts";

/**
 * Mirroring the market to Arkiv (Rabdi testnet): live offers, re-published every
 * `syncIntervalMs`, and one receipt per paid request. Null leaves Arkiv out.
 */
export interface ArkivSettings {
  /** Arkiv Hub access key; empty uses the rate-limited public RPC. */
  readonly accessKey: string;
  /** The writer's key (ARKIV_PRIVATE_KEY); it needs testnet tGLM for gas. */
  readonly privateKey: Redacted.Redacted<`0x${string}`>;
  readonly syncIntervalMs: number;
}

/**
 * The spend audit log: one message per settled payment on a Hedera Consensus Service
 * topic. The operator account holds the topic's submit key and pays the message fees.
 * Null leaves the log out.
 */
export interface AuditSettings {
  readonly operatorId: string;
  /** The operator's ECDSA key (hex, or DER-encoded). */
  readonly operatorKey: Redacted.Redacted<string>;
  readonly topicId: string;
}

/**
 * Pay-per-request market terms (`POST /v1/chat/completions`). Null turns the route off.
 * Every request is quoted from its size and paid in full over x402 to the seller's
 * wallet before it is forwarded.
 */
export interface MarketSettings {
  readonly arkiv: ArkivSettings | null;
  readonly audit: AuditSettings | null;
  /** Chain buyers pay on: Hedera testnet. */
  readonly chain: PaymentChain;
  /** max_tokens quoted (and enforced) when a request does not set one. */
  readonly defaultMaxTokens: number;
  /** Mirror node used to find a seller's Hedera account from their EVM wallet. */
  readonly hederaMirrorUrl: string;
  /** Cheapest online offers listed in one 402, so the payer can pick. */
  readonly maxQuotedOffers: number;
  /** Largest max_tokens a request may ask for. */
  readonly maxTokensCeiling: number;
  /** How long the payer's signed payment stays valid. */
  readonly maxTimeoutSeconds: number;
  /** Absolute URL of the paid resource, shown to x402 clients. */
  readonly resourceUrl: string;
}

/** Runtime settings, read from environment variables (see README). */
export interface GatewaySettings {
  /** How long the market's offer lookups are cached in process. */
  readonly authCacheTtlMs: number;
  /**
   * After cancelling a request (the buyer went away), how long to wait for the node's
   * final frame with the usage so far before recording the gateway's estimate instead.
   */
  readonly cancelUsageWaitMs: number;
  /** Lease on a Redis concurrency slot; refreshed while the request runs. */
  readonly concurrencyLeaseMs: number;
  /** How long to wait for the node's ResponseHead before answering 504. */
  readonly headTimeoutMs: number;
  /** Max request body accepted from buyers. */
  readonly maxBodyBytes: number;
  readonly market: MarketSettings | null;
  /** How often node meters and heartbeats are written to Postgres, per node. */
  readonly meterPersistIntervalMs: number;
  /** How long a node may take to send NodeHello after connecting. */
  readonly nodeHelloTimeoutMs: number;
}

export class Settings extends Context.Service<Settings, GatewaySettings>()(
  "@rentanllm/gateway/Settings"
) {}

export const defaultSettings: GatewaySettings = {
  authCacheTtlMs: 5000,
  cancelUsageWaitMs: 2000,
  concurrencyLeaseMs: 600_000,
  headTimeoutMs: 120_000,
  market: null,
  maxBodyBytes: 10 * 1024 * 1024,
  meterPersistIntervalMs: 30_000,
  nodeHelloTimeoutMs: 10_000,
};

const DEFAULT_PAYMENT_TIMEOUT_SECONDS = 300;
const DEFAULT_PUBLIC_URL = "http://localhost:8787";
const DEFAULT_MARKET_MAX_TOKENS = 1024;
const DEFAULT_MARKET_MAX_TOKENS_CEILING = 32_768;
const DEFAULT_MARKET_QUOTED_OFFERS = 3;
const DEFAULT_HEDERA_MIRROR_URL = "https://testnet.mirrornode.hedera.com";

const TRAILING_SLASHES = /\/+$/u;

const intWithDefault = (name: string, fallback: number) =>
  Config.Int(name).pipe(Config.withDefault(fallback));

const DEFAULT_ARKIV_SYNC_SECONDS = 180;
const MS_PER_SECOND = 1000;
const HEX_KEY = /^0x[0-9a-fA-F]{64}$/u;

const arkivFromEnv = Effect.gen(function* readArkivSettings() {
  const key = yield* Config.String("ARKIV_PRIVATE_KEY").pipe(
    Config.withDefault("")
  );
  if (key === "") {
    return null;
  }
  if (!HEX_KEY.test(key)) {
    return yield* Effect.die(
      new Error("ARKIV_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key")
    );
  }
  return {
    accessKey: yield* Config.String("ARKIV_ACCESS_KEY").pipe(
      Config.withDefault("")
    ),
    privateKey: Redacted.make(key as `0x${string}`),
    syncIntervalMs:
      (yield* intWithDefault(
        "ARKIV_SYNC_SECONDS",
        DEFAULT_ARKIV_SYNC_SECONDS
      )) * MS_PER_SECOND,
  } satisfies ArkivSettings;
});

const HEDERA_ID = /^\d+\.\d+\.\d+$/u;

/** A trimmed optional string setting; empty when unset. */
const optionalString = (name: string) =>
  Config.String(name).pipe(
    Config.withDefault(""),
    Config.map((value) => value.trim())
  );

/** HCS_AUDIT_TOPIC_ID + HEDERA_OPERATOR_ID + HEDERA_OPERATOR_KEY, all or none. */
const auditFromEnv = Effect.gen(function* readAuditSettings() {
  const topicId = yield* optionalString("HCS_AUDIT_TOPIC_ID");
  const operatorId = yield* optionalString("HEDERA_OPERATOR_ID");
  const operatorKey = yield* optionalString("HEDERA_OPERATOR_KEY");
  const set = [topicId, operatorId, operatorKey].filter((v) => v !== "");
  if (set.length === 0) {
    return null;
  }
  if (
    set.length < 3 ||
    !HEDERA_ID.test(topicId) ||
    !HEDERA_ID.test(operatorId)
  ) {
    return yield* Effect.die(
      new Error(
        "the spend audit log needs HCS_AUDIT_TOPIC_ID and HEDERA_OPERATOR_ID (0.0.x) and HEDERA_OPERATOR_KEY together"
      )
    );
  }
  return {
    operatorId,
    operatorKey: Redacted.make(operatorKey),
    topicId,
  } satisfies AuditSettings;
});

const marketFromEnv = Effect.gen(function* readMarketSettings() {
  const enabled = yield* Config.Boolean("MARKET_ENABLED").pipe(
    Config.withDefault(true)
  );
  if (!enabled) {
    return null;
  }
  const publicUrl = yield* Config.String("GATEWAY_PUBLIC_URL").pipe(
    Config.withDefault(DEFAULT_PUBLIC_URL)
  );
  return {
    arkiv: yield* arkivFromEnv,
    audit: yield* auditFromEnv,
    chain: HEDERA_TESTNET,
    defaultMaxTokens: yield* intWithDefault(
      "MARKET_DEFAULT_MAX_TOKENS",
      DEFAULT_MARKET_MAX_TOKENS
    ),
    hederaMirrorUrl: (yield* Config.String("HEDERA_MIRROR_URL").pipe(
      Config.withDefault(DEFAULT_HEDERA_MIRROR_URL)
    )).replace(TRAILING_SLASHES, ""),
    maxQuotedOffers: yield* intWithDefault(
      "MARKET_QUOTED_OFFERS",
      DEFAULT_MARKET_QUOTED_OFFERS
    ),
    maxTimeoutSeconds: yield* intWithDefault(
      "X402_MAX_TIMEOUT_SECONDS",
      DEFAULT_PAYMENT_TIMEOUT_SECONDS
    ),
    maxTokensCeiling: yield* intWithDefault(
      "MARKET_MAX_TOKENS_CEILING",
      DEFAULT_MARKET_MAX_TOKENS_CEILING
    ),
    resourceUrl: `${publicUrl.replace(TRAILING_SLASHES, "")}/v1/chat/completions`,
  } satisfies MarketSettings;
});

export const SettingsFromEnv = Layer.effect(Settings)(
  Effect.gen(function* settingsFromEnv() {
    const d = defaultSettings;
    return {
      authCacheTtlMs: yield* intWithDefault(
        "GATEWAY_AUTH_CACHE_TTL_MS",
        d.authCacheTtlMs
      ),
      cancelUsageWaitMs: yield* intWithDefault(
        "GATEWAY_CANCEL_USAGE_WAIT_MS",
        d.cancelUsageWaitMs
      ),
      concurrencyLeaseMs: yield* intWithDefault(
        "GATEWAY_CONCURRENCY_LEASE_MS",
        d.concurrencyLeaseMs
      ),
      headTimeoutMs: yield* intWithDefault(
        "GATEWAY_HEAD_TIMEOUT_MS",
        d.headTimeoutMs
      ),
      market: yield* marketFromEnv,
      maxBodyBytes: yield* intWithDefault(
        "GATEWAY_MAX_BODY_BYTES",
        d.maxBodyBytes
      ),
      meterPersistIntervalMs: yield* intWithDefault(
        "GATEWAY_METER_PERSIST_INTERVAL_MS",
        d.meterPersistIntervalMs
      ),
      nodeHelloTimeoutMs: yield* intWithDefault(
        "GATEWAY_NODE_HELLO_TIMEOUT_MS",
        d.nodeHelloTimeoutMs
      ),
    } satisfies GatewaySettings;
  })
);
