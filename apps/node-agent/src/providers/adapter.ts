import type {
  Provider,
  ProviderUsage,
  ProxyRequest,
  UsageMeters,
} from "@rentanllm/protocol";
import type { Redacted } from "effect";

export type ProxyRequestMessage = typeof ProxyRequest.Type;

/** A fully built request to the provider's public API. */
export interface UpstreamRequest {
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly url: string;
}

/** Incrementally reads usage out of a response body as it streams past. */
export interface UsageTracker {
  readonly feed: (text: string) => void;
  readonly finish: () => ProviderUsage | null;
}

/** Everything provider-specific the node needs. Add one per provider. */
export interface ProviderAdapter {
  readonly buildRequest: (
    request: ProxyRequestMessage,
    credential: Redacted.Redacted<string>
  ) => UpstreamRequest;
  /** Cool-off before new requests after a 429, from the provider's headers or the default. */
  readonly cooloffMs: (
    headers: Readonly<Record<string, string>>,
    defaultMs: number
  ) => number;
  /** Response headers safe to forward to the renter (no owner-identifying or meter headers). */
  readonly forwardHeaders: (
    headers: Readonly<Record<string, string>>
  ) => Record<string, string>;
  /** A cheap, non-billable request whose response carries meter headers, if the provider has one. */
  readonly meterProbe: (
    credential: Redacted.Redacted<string>
  ) => UpstreamRequest | null;
  /** What to tell the owner when a meter probe succeeds but carries no meter headers. */
  readonly missingMetersHint?: string;
  readonly provider: Provider;
  /** Reads usage meters from response headers; null if the headers are absent. */
  readonly readMeters: (
    headers: Readonly<Record<string, string>>,
    now: Date
  ) => UsageMeters | null;
  readonly usageTracker: (contentType: string) => UsageTracker;
}
