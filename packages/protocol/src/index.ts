/**
 * Wire protocol for the tunnel between the edge gateway and an owner's node agent.
 *
 * The node dials out to the gateway over a WebSocket. Every frame is one JSON-encoded
 * `TunnelMessage`. Many proxied requests share one socket and are told apart by `requestId`.
 */
import { Schema } from "effect";

export const PROTOCOL_VERSION = 1 as const;

export const ProviderSchema = Schema.Literals([
  "anthropic",
  "openai",
  "google",
  "xai",
  /** Open models the owner runs on their own machine, served by a local Ollama. */
  "ollama",
]);
export type Provider = typeof ProviderSchema.Type;

const Headers = Schema.Record(Schema.String, Schema.String);

/** Token counts as reported by the provider in its own `usage` field. */
export const ProviderUsageSchema = Schema.Struct({
  cacheReadTokens: Schema.Int,
  cacheWriteTokens: Schema.Int,
  inputTokens: Schema.Int,
  model: Schema.String,
  outputTokens: Schema.Int,
});
export type ProviderUsage = typeof ProviderUsageSchema.Type;

/** One reading of the plan's usage meters, as the provider shows them to its own apps. */
export const UsageMetersSchema = Schema.Struct({
  /**
   * What the credential is, read from the provider's own headers rather than typed by the
   * owner, e.g. "API key · 450K tokens/min". The gateway shows it as the plan tier.
   */
  plan: Schema.optionalKey(Schema.String),
  /** ISO timestamp of when the meters were read. Readings older than 2 minutes must stop renting. */
  readAt: Schema.String,
  sessionResetsAt: Schema.NullOr(Schema.String),
  sessionUsedPct: Schema.NullOr(Schema.Finite),
  /**
   * What the session meter measures: the plan's own usage window, or (with a plain API
   * key, which has no plan meters) the per-minute API rate limit.
   */
  source: Schema.optionalKey(Schema.Literals(["plan", "api_rate_limit"])),
  weeklyResetsAt: Schema.NullOr(Schema.String),
  weeklyUsedPct: Schema.NullOr(Schema.Finite),
});
export type UsageMeters = typeof UsageMetersSchema.Type;

// Node -> gateway

export const NodeHello = Schema.TaggedStruct("NodeHello", {
  agentVersion: Schema.String,
  nodeId: Schema.String,
  protocolVersion: Schema.Int,
  providers: Schema.Array(ProviderSchema),
});

export const Heartbeat = Schema.TaggedStruct("Heartbeat", {
  at: Schema.String,
  meters: Schema.Array(
    Schema.Struct({ meters: UsageMetersSchema, provider: ProviderSchema })
  ),
});

export const ResponseHead = Schema.TaggedStruct("ResponseHead", {
  headers: Headers,
  requestId: Schema.String,
  status: Schema.Int,
});

export const ResponseChunk = Schema.TaggedStruct("ResponseChunk", {
  /** Raw response text, e.g. one or more SSE events. Forwarded to the renter unchanged. */
  data: Schema.String,
  requestId: Schema.String,
});

export const ResponseEnd = Schema.TaggedStruct("ResponseEnd", {
  requestId: Schema.String,
  usage: Schema.NullOr(ProviderUsageSchema),
});

/**
 * Ends a request with a failure. It may arrive before any ResponseHead (refused) or after
 * ResponseHead and some ResponseChunks (failed or cancelled mid-stream).
 */
export const ResponseError = Schema.TaggedStruct("ResponseError", {
  code: Schema.Literals([
    "provider_rate_limited",
    "provider_error",
    "cutoff_reached",
    "meters_unreadable",
    "node_closed",
    "not_allowed",
    "cancelled",
    "internal",
  ]),
  message: Schema.String,
  requestId: Schema.String,
  /** Provider usage seen so far, so a stream cut off mid-way is billed for what it used. */
  usage: Schema.optionalKey(Schema.NullOr(ProviderUsageSchema)),
});

// Gateway -> node

export const ProxyRequest = Schema.TaggedStruct("ProxyRequest", {
  body: Schema.String,
  bookingId: Schema.String,
  /** Renter headers after the gateway strips auth and hop-by-hop headers. */
  headers: Headers,
  method: Schema.Literals(["POST"]),
  /** ProviderSchema API path, e.g. "/v1/messages". The node rejects paths outside its allowlist. */
  path: Schema.String,
  provider: ProviderSchema,
  requestId: Schema.String,
});

export const CancelRequest = Schema.TaggedStruct("CancelRequest", {
  requestId: Schema.String,
});

export const SetAvailability = Schema.TaggedStruct("SetAvailability", {
  open: Schema.Boolean,
  sessionCutoffPct: Schema.Finite,
  weeklyCutoffPct: Schema.Finite,
});

export const NodeToGatewaySchema = Schema.Union([
  NodeHello,
  Heartbeat,
  ResponseHead,
  ResponseChunk,
  ResponseEnd,
  ResponseError,
]);
export type NodeToGateway = typeof NodeToGatewaySchema.Type;

export const GatewayToNodeSchema = Schema.Union([
  ProxyRequest,
  CancelRequest,
  SetAvailability,
]);
export type GatewayToNode = typeof GatewayToNodeSchema.Type;

export const NodeToGatewayJson = Schema.fromJsonString(NodeToGatewaySchema);
export const GatewayToNodeJson = Schema.fromJsonString(GatewayToNodeSchema);

/** Paths the node will forward, per provider. Everything else is refused. */
export const ALLOWED_PATHS: Readonly<Record<Provider, readonly string[]>> = {
  anthropic: ["/v1/messages", "/v1/messages/count_tokens"],
  google: [],
  ollama: ["/v1/chat/completions", "/v1/images/generations"],
  // A Codex subscription is served through CLIProxyAPI, which speaks the Messages API.
  openai: ["/v1/chat/completions", "/v1/responses", "/v1/messages"],
  xai: ["/v1/chat/completions", "/v1/responses"],
};

/** Gateway stops new requests this many points below the owner's cut-off. */
export const CUTOFF_SAFETY_MARGIN_PCT = 3;
/** Meter readings older than this stop renting (fail closed). */
export const METER_MAX_AGE_MS = 120_000;
export const HEARTBEAT_INTERVAL_MS = 15_000;
export const MISSED_HEARTBEATS_BEFORE_PAUSE = 3;

/** Gateway path that nodes dial. */
export const TUNNEL_PATH = "/tunnel";
/** Nodes authenticate the WebSocket handshake with `Authorization: Bearer <node token>`. */
export const NODE_AUTH_HEADER = "authorization";
export const nodeAuthHeaderValue = (token: string) => `Bearer ${token}`;

/** WebSocket close codes the gateway uses (4000-4999 are application-defined). */
export const TUNNEL_CLOSE_CODES = {
  heartbeatTimeout: 4008,
  helloTimeout: 4004,
  protocolError: 4002,
  replaced: 4009,
  wrongNode: 4003,
} as const;
