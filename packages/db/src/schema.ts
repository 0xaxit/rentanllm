/**
 * Postgres schema. All money columns are `bigint` USDC micros (1 USDC = 1_000_000),
 * matching `Micros` in @rentanllm/core, even where the column name ends in `_usdc`.
 */
import {
  DEFAULT_SESSION_CUTOFF_PCT,
  DEFAULT_WEEKLY_CUTOFF_PCT,
} from "@rentanllm/core";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const micros = (name: string) => bigint(name, { mode: "bigint" });
const timestamptz = (name: string) =>
  timestamp(name, { mode: "date", withTimezone: true });
const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamptz("created_at").notNull().defaultNow();

export const kycStatus = pgEnum("kyc_status", [
  "none",
  "pending",
  "verified",
  "rejected",
]);
export const nodeMode = pgEnum("node_mode", [
  "owner_hosted",
  "platform_hosted",
]);
export const nodeStatus = pgEnum("node_status", [
  "online",
  "offline",
  "disabled",
]);
export const provider = pgEnum("provider", [
  "anthropic",
  "openai",
  "google",
  "xai",
  "ollama",
]);
/** What a listing sells: chat completions, priced per token, or images, priced per image. */
export const listingKind = pgEnum("listing_kind", ["chat", "image"]);

export const authKind = pgEnum("auth_kind", [
  "oauth",
  "session_token",
  "api_key",
]);
export const providerAccountStatus = pgEnum("provider_account_status", [
  "ok",
  "limited",
  "banned",
  "revoked",
]);
export const listingStatus = pgEnum("listing_status", [
  "draft",
  "live",
  "paused",
]);
export const usageStatus = pgEnum("usage_status", ["ok", "error", "cancelled"]);

export const users = pgTable("users", {
  createdAt: createdAt(),
  displayName: text("display_name"),
  email: text("email").unique(),
  id: id(),
  isOwner: boolean("is_owner").notNull().default(false),
  isRenter: boolean("is_renter").notNull().default(true),
  kycStatus: kycStatus("kyc_status").notNull().default("none"),
  walletAddress: text("wallet_address").unique(),
});

export const nodes = pgTable(
  "nodes",
  {
    /** When the node's current tunnel opened (written by the gateway on NodeHello). */
    connectedAt: timestamptz("connected_at"),
    createdAt: createdAt(),
    /**
     * Provider -> what the agent reported holding ("API key · 450K tokens/min"), read
     * from the provider's own headers. Written by the gateway; owners can't set it.
     */
    detectedPlans: jsonb("detected_plans")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    id: id(),
    lastHeartbeatAt: timestamptz("last_heartbeat_at"),
    mode: nodeMode("mode").notNull(),
    /**
     * Lowercase SHA-256 hex of the node token. The gateway authenticates tunnels with it.
     * The token itself is shown to the owner once and never stored.
     */
    nodeTokenHash: text("node_token_hash").unique(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    region: text("region"),
    status: nodeStatus("status").notNull().default("offline"),
    version: text("version"),
  },
  (t) => [index("nodes_last_heartbeat_at_idx").on(t.lastHeartbeatAt)]
);

/**
 * One row per node tunnel, written by the gateway: opened on NodeHello, closed
 * when the tunnel ends. Uptime is computed from these. A row left open by a
 * gateway restart is closed as `lost` when the node next connects.
 */
export const nodeSessions = pgTable(
  "node_sessions",
  {
    connectedAt: timestamptz("connected_at").notNull(),
    disconnectedAt: timestamptz("disconnected_at"),
    /** closed | stale | replaced | lost */
    endReason: text("end_reason"),
    id: id(),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
  },
  (t) => [index("node_sessions_node_connected_idx").on(t.nodeId, t.connectedAt)]
);

export const providerAccounts = pgTable("provider_accounts", {
  authKind: authKind("auth_kind").notNull(),
  /** Reference into the secret store. Never the credential itself. */
  credentialRef: text("credential_ref"),
  id: id(),
  lastLimitHitAt: timestamptz("last_limit_hit_at"),
  nodeId: uuid("node_id")
    .notNull()
    .references(() => nodes.id),
  planTier: text("plan_tier").notNull(),
  provider: provider("provider").notNull(),
  sessionResetsAt: timestamptz("session_resets_at"),
  sessionUsedPct: doublePrecision("session_used_pct"),
  status: providerAccountStatus("status").notNull().default("ok"),
  usageReadAt: timestamptz("usage_read_at"),
  /** When the plan's weekly meter resets. Written by the gateway from node meter readings. */
  weeklyResetsAt: timestamptz("weekly_resets_at"),
  weeklyUsedPct: doublePrecision("weekly_used_pct"),
});

export const listings = pgTable(
  "listings",
  {
    id: id(),
    /**
     * "image": the model makes images on POST /v1/images/generations, and
     * price_out_per_mtok_usdc is the price of one image (an image is billed as one
     * million output tokens, so every price and receipt path stays the same).
     */
    kind: listingKind("kind").notNull().default("chat"),
    maxConcurrency: integer("max_concurrency").notNull().default(1),
    models: text("models").array().notNull(),
    /** Cache-read price. Null: the gateway prices cache reads at input ÷ 10. */
    priceCacheReadPerMtokUsdc: micros("price_cache_read_per_mtok_usdc"),
    /** Cache-write price. Null: 1.25× the input price (cacheWritePrice in @rentanllm/core). */
    priceCacheWritePerMtokUsdc: micros("price_cache_write_per_mtok_usdc"),
    priceInPerMtokUsdc: micros("price_in_per_mtok_usdc").notNull(),
    priceOutPerMtokUsdc: micros("price_out_per_mtok_usdc").notNull(),
    providerAccountId: uuid("provider_account_id")
      .notNull()
      .references(() => providerAccounts.id),
    sessionCutoffPct: smallint("session_cutoff_pct")
      .notNull()
      .default(DEFAULT_SESSION_CUTOFF_PCT),
    status: listingStatus("status").notNull().default("draft"),
    weeklyCutoffPct: smallint("weekly_cutoff_pct")
      .notNull()
      .default(DEFAULT_WEEKLY_CUTOFF_PCT),
  },
  (t) => [
    check(
      "listings_cutoffs_range",
      sql`${t.sessionCutoffPct} between 0 and 100 and ${t.weeklyCutoffPct} between 0 and 100`
    ),
    check(
      "listings_prices_non_negative",
      sql`${t.priceInPerMtokUsdc} >= 0 and ${t.priceOutPerMtokUsdc} >= 0`
    ),
    check("listings_max_concurrency_positive", sql`${t.maxConcurrency} >= 1`),
    check(
      "listings_cache_prices_non_negative",
      sql`coalesce(${t.priceCacheReadPerMtokUsdc}, 0) >= 0 and coalesce(${t.priceCacheWritePerMtokUsdc}, 0) >= 0`
    ),
  ]
);

/**
 * One pay-per-request purchase on the market route (`POST /v1/chat/completions`). The
 * buyer pays the quoted price over x402 straight to the owner's wallet before the request
 * is forwarded. Written by the gateway when
 * the request finishes; idempotent by request_id and by payment_tx.
 */
export const paidRequests = pgTable(
  "paid_requests",
  {
    /**
     * Sequence number of this payment's message on the spend audit log (an HCS topic);
     * null until the gateway has posted it, or when the log is off.
     */
    auditSequence: bigint("audit_sequence", { mode: "number" }),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    createdAt: createdAt(),
    /** When the response ended (ok, error or cancelled). */
    finishedAt: timestamptz("finished_at").notNull(),
    /** HTTP status the buyer saw. */
    httpStatus: integer("http_status").notNull(),
    id: id(),
    inputTokens: integer("input_tokens").notNull().default(0),
    latencyMs: integer("latency_ms"),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id),
    /** Max output tokens the price was quoted for (the buyer's max_tokens). */
    maxTokens: integer("max_tokens").notNull(),
    model: text("model").notNull(),
    /** CAIP-2 network the payment settled on, e.g. "hedera:testnet". */
    network: text("network").notNull(),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => nodes.id),
    outputTokens: integer("output_tokens").notNull().default(0),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    /** The quoted price, settled in full before the request ran. */
    paidUsdcMicros: micros("paid_usdc_micros").notNull(),
    /** Where the payment went: the owner's wallet. */
    payTo: text("pay_to").notNull(),
    /** Payer's address as the facilitator reported it; null when it did not say. */
    payer: text("payer"),
    /** Settlement transaction (hash or Hedera transaction id). */
    paymentTx: text("payment_tx").notNull().unique(),
    priceInPerMtokUsdc: micros("price_in_per_mtok_usdc").notNull(),
    priceOutPerMtokUsdc: micros("price_out_per_mtok_usdc").notNull(),
    requestId: text("request_id").notNull().unique(),
    status: usageStatus("status").notNull(),
    /** Time to first byte from the node, in ms. */
    ttfbMs: integer("ttfb_ms"),
    /** What the tokens actually used cost at the listing's prices (at most the paid price). */
    usedUsdcMicros: micros("used_usdc_micros").notNull(),
  },
  (t) => [
    index("paid_requests_created_at_idx").on(t.createdAt),
    index("paid_requests_owner_id_created_at_idx").on(t.ownerId, t.createdAt),
    // Buyer budgets: what one payer spent in the last 24 hours, in total and per seller.
    index("paid_requests_payer_created_at_idx").on(t.payer, t.createdAt),
    check("paid_requests_paid_positive", sql`${t.paidUsdcMicros} > 0`),
  ]
);

export const apiPriceRefs = pgTable(
  "api_price_refs",
  {
    cacheReadPerMtokUsdc: micros("cache_read_per_mtok_usdc").notNull(),
    checkedAt: timestamptz("checked_at").notNull(),
    id: id(),
    inputPerMtokUsdc: micros("input_per_mtok_usdc").notNull(),
    model: text("model").notNull(),
    outputPerMtokUsdc: micros("output_per_mtok_usdc").notNull(),
    provider: provider("provider").notNull(),
    sourceUrl: text("source_url").notNull(),
  },
  (t) => [unique("api_price_refs_provider_model_key").on(t.provider, t.model)]
);

/** Single-use Sign-In With Ethereum nonces. */
export const authNonces = pgTable(
  "auth_nonces",
  {
    /** Checksummed address the nonce was issued for. */
    address: text("address").notNull(),
    createdAt: createdAt(),
    expiresAt: timestamptz("expires_at").notNull(),
    nonce: text("nonce").primaryKey(),
    usedAt: timestamptz("used_at"),
  },
  (t) => [index("auth_nonces_expires_at_idx").on(t.expiresAt)]
);

/** Browser sessions. The cookie holds a random token; only its keyed hash is stored. */
export const sessions = pgTable(
  "sessions",
  {
    createdAt: createdAt(),
    expiresAt: timestamptz("expires_at").notNull(),
    id: id(),
    tokenHash: text("token_hash").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [
    index("sessions_user_id_idx").on(t.userId),
    index("sessions_expires_at_idx").on(t.expiresAt),
  ]
);

/**
 * A buyer's spending limits, enforced by the gateway after the facilitator verifies a
 * payment and before it settles: a payment over a limit is refused and nothing moves.
 * Keyed by the paying Hedera account (`paid_requests.payer`), which the API resolves from
 * the buyer's sign-in wallet. Null limits mean "no limit". Written by the API.
 */
export const buyerPolicies = pgTable(
  "buyer_policies",
  {
    /** Sellers (Hedera accounts) this buyer may pay; null means any seller. */
    allowedSellers: text("allowed_sellers").array(),
    /** Most this buyer pays in any rolling 24 hours, across all sellers. */
    dailyBudgetMicros: micros("daily_budget_micros"),
    /** Largest single payment. */
    maxPerRequestMicros: micros("max_per_request_micros"),
    /** True stops every payment from this account. */
    paused: boolean("paused").notNull().default(false),
    /** The paying Hedera account, e.g. "0.0.11331175". */
    payerAccount: text("payer_account").notNull().unique(),
    /** Most this buyer pays one seller in any rolling 24 hours. */
    perSellerDailyMicros: micros("per_seller_daily_micros"),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * Above this, the hosted connector holds a payment until the person approves it with
     * World ID. Null: never ask. The gateway does not read it.
     */
    worldApprovalAboveMicros: micros("world_approval_above_micros"),
  },
  (t) => [
    check(
      "buyer_policies_limits_positive",
      sql`coalesce(${t.dailyBudgetMicros}, 1) > 0 and coalesce(${t.maxPerRequestMicros}, 1) > 0 and coalesce(${t.perSellerDailyMicros}, 1) > 0`
    ),
  ]
);

/**
 * A seller node registered as an ERC-8004 agent on Hedera testnet. The seller's wallet
 * owns the agent NFT on the Identity Registry; the API serves its registration file,
 * which carries the node's HCS-14 UAID. The platform's monitor wallet (never the owner:
 * ERC-8004 forbids self-feedback) posts measured uptime, time to first byte and success
 * rate to the Reputation Registry; `last_reported_at` paces those posts.
 */
export const agentIdentities = pgTable("agent_identities", {
  /** The ERC-8004 agentId (the Identity Registry's token id). */
  agentId: bigint("agent_id", { mode: "bigint" }).notNull().unique(),
  createdAt: createdAt(),
  /** The monitor's last giveFeedback transaction (an EVM hash). */
  lastFeedbackTx: text("last_feedback_tx"),
  /** When the monitor last posted this agent's reputation on chain. */
  lastReportedAt: timestamptz("last_reported_at"),
  nodeId: uuid("node_id")
    .primaryKey()
    .references(() => nodes.id, { onDelete: "cascade" }),
  /** The wallet that owns the agent NFT (the seller's sign-in wallet). */
  ownerWallet: text("owner_wallet").notNull(),
  /** CAIP-10 style registry, e.g. "eip155:296:0x8004A818BFB912233c491871b3d84c89A494BD9e". */
  registry: text("registry").notNull(),
  /** The HCS-14 Universal Agent ID in the registration file. */
  uaid: text("uaid").notNull(),
});

/**
 * A buyer's agent wallet: a Hedera account the platform created for them so a remote MCP
 * client (Claude Desktop) can pay sellers without the buyer's own key. The buyer tops it
 * up with USDC from their wallet; the gateway applies the buyer's limits to it as to their
 * own account. The private key is stored encrypted (AES-256-GCM, AGENT_WALLET_KEK).
 */
export const agentWallets = pgTable("agent_wallets", {
  /** The Hedera account, "0.0.x". */
  accountId: text("account_id").notNull().unique(),
  createdAt: createdAt(),
  /** base64 of iv (12) | tag (16) | ciphertext of the hex ECDSA key. */
  encryptedKey: text("encrypted_key").notNull(),
  /** Lowercase EVM alias of the account's ECDSA key. */
  evmAddress: text("evm_address").notNull().unique(),
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
});

/** OAuth 2.1 clients registered dynamically (RFC 7591), e.g. Claude Desktop's connector. */
export const oauthClients = pgTable("oauth_clients", {
  createdAt: createdAt(),
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  redirectUris: text("redirect_uris").array().notNull(),
});

/**
 * One authorization request: created at /oauth/authorize, approved by a signed-in user on
 * the web consent page (which sets `user_id` and the code), redeemed once at /oauth/token.
 */
export const oauthGrants = pgTable("oauth_grants", {
  approvedAt: timestamptz("approved_at"),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClients.id, { onDelete: "cascade" }),
  /** PKCE S256 challenge. */
  codeChallenge: text("code_challenge").notNull(),
  /** SHA-256 hex of the authorization code; null until approved. */
  codeHash: text("code_hash").unique(),
  createdAt: createdAt(),
  expiresAt: timestamptz("expires_at").notNull(),
  id: text("id").primaryKey(),
  redirectUri: text("redirect_uri").notNull(),
  resource: text("resource"),
  scope: text("scope"),
  state: text("state"),
  usedAt: timestamptz("used_at"),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
});

/** Access and refresh tokens issued to OAuth clients; only their SHA-256 hashes are kept. */
export const oauthTokens = pgTable(
  "oauth_tokens",
  {
    accessExpiresAt: timestamptz("access_expires_at").notNull(),
    accessHash: text("access_hash").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    refreshExpiresAt: timestamptz("refresh_expires_at").notNull(),
    refreshHash: text("refresh_hash").notNull().unique(),
    revokedAt: timestamptz("revoked_at"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [index("oauth_tokens_user_id_idx").on(t.userId)]
);

/**
 * World ID approval states. `used` means the approval released exactly one payment; the
 * other end states never release one.
 */
export const worldApprovalStatus = pgEnum("world_approval_status", [
  "pending",
  "approved",
  "denied",
  "expired",
  "cancelled",
  "failed",
  "used",
]);

/**
 * One person-approval of one agent payment, through World ID Agent Pass (World IdP, OIDC
 * device authorization). World cannot bind the amount or payee to its token, so the exact
 * payment is stored here and the approval releases only that payment, once.
 */
export const worldApprovals = pgTable(
  "world_approvals",
  {
    acr: text("acr"),
    amountMicros: micros("amount_micros").notNull(),
    amr: jsonb("amr").$type<readonly string[]>(),
    /** When World says the person authenticated (the ID token's auth_time). */
    authTime: timestamptz("auth_time"),
    createdAt: createdAt(),
    decidedAt: timestamptz("decided_at"),
    /** What the agent is paying for, shown back to the agent and in logs. */
    description: text("description").notNull(),
    /** World's private device code, needed to poll. Cleared once the approval is decided. */
    deviceCode: text("device_code"),
    /** When set, World must authenticate this subject (the person linked to the payer). */
    expectedSubject: text("expected_subject"),
    expiresAt: timestamptz("expires_at").notNull(),
    failureReason: text("failure_reason"),
    id: id(),
    network: text("network").notNull(),
    /** No poll of World's token endpoint before this (its interval, plus slow_down). */
    nextPollAt: timestamptz("next_poll_at").notNull(),
    /**
     * The signed-in user a hosted-connector approval belongs to. Set only for those: the
     * hosted MCP server authorizes by this user instead of handing out the secret, and
     * the first person to approve is pinned for the user.
     */
    ownerUserId: uuid("owner_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    payTo: text("pay_to").notNull(),
    /** The paying account (Hedera 0.0.x). */
    payer: text("payer").notNull(),
    pollIntervalSeconds: integer("poll_interval_seconds").notNull(),
    /** SHA-256 hex of the secret handed to the agent; only it can check or use this approval. */
    secretHash: text("secret_hash").notNull(),
    status: worldApprovalStatus("status").notNull().default("pending"),
    usedAt: timestamptz("used_at"),
    userCode: text("user_code").notNull(),
    verificationUri: text("verification_uri").notNull(),
    verificationUriComplete: text("verification_uri_complete"),
    /** World's pairwise subject of the person who approved. */
    worldSubject: text("world_subject"),
  },
  (t) => [
    index("world_approvals_expires_at_idx").on(t.expiresAt),
    index("world_approvals_owner_user_id_idx").on(t.ownerUserId),
    check("world_approvals_amount_positive", sql`${t.amountMicros} > 0`),
  ]
);
