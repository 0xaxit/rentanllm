/**
 * Anthropic adapter. Calls the public Messages API with the owner's API key in the documented
 * `x-api-key` header and an honest `rentanllm-node/<version>` User-Agent.
 */
import type { ProviderUsage, UsageMeters } from "@rentanllm/protocol";
import { Redacted } from "effect";

import { USER_AGENT } from "../version.ts";
import type { ProviderAdapter, UsageTracker } from "./adapter.ts";

const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";
/** Renter headers forwarded upstream. Everything else is dropped. */
const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "anthropic-beta",
  "anthropic-version",
  "content-type",
] as const;
/** Upstream headers forwarded back to the renter. Meter and org headers stay on the node. */
const FORWARDED_RESPONSE_HEADERS = [
  "content-type",
  "request-id",
  "retry-after",
] as const;
/** Cap on how much of a non-streaming JSON body is kept to read `usage`. */
const MAX_JSON_USAGE_BYTES = 8 * 1024 * 1024;
const PERCENT = 100;
const MS_PER_SECOND = 1000;
const PROBE_MODEL = "claude-haiku-4-5";
const LINE_BREAK = /\r?\n/u;
const THOUSAND = 1000;
const MILLION = 1_000_000;

const lower = (
  headers: Readonly<Record<string, string>>
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key.toLowerCase()] = value;
  }
  return out;
};

const isRecord = (u: unknown): u is Record<string, unknown> =>
  typeof u === "object" && u !== null && !Array.isArray(u);

const int = (u: unknown): number | undefined =>
  typeof u === "number" && Number.isInteger(u) ? u : undefined;

interface UsageAccumulator {
  cacheReadTokens: number;
  cacheWriteTokens: number;
  inputTokens: number;
  model: string | null;
  outputTokens: number;
}

/** Applies an Anthropic `usage` object. Later values win: `message_delta` counts are cumulative. */
const applyUsage = (acc: UsageAccumulator, usage: unknown): void => {
  if (!isRecord(usage)) {
    return;
  }
  acc.inputTokens = int(usage.input_tokens) ?? acc.inputTokens;
  acc.outputTokens = int(usage.output_tokens) ?? acc.outputTokens;
  acc.cacheReadTokens =
    int(usage.cache_read_input_tokens) ?? acc.cacheReadTokens;
  acc.cacheWriteTokens =
    int(usage.cache_creation_input_tokens) ?? acc.cacheWriteTokens;
};

const toUsage = (acc: UsageAccumulator): ProviderUsage | null =>
  acc.model === null
    ? null
    : {
        cacheReadTokens: acc.cacheReadTokens,
        cacheWriteTokens: acc.cacheWriteTokens,
        inputTokens: acc.inputTokens,
        model: acc.model,
        outputTokens: acc.outputTokens,
      };

const newAccumulator = (): UsageAccumulator => ({
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  inputTokens: 0,
  model: null,
  outputTokens: 0,
});

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** Parses SSE `message_start` / `message_delta` events, tolerating events split across chunks. */
export const sseUsageTracker = (): UsageTracker => {
  const acc = newAccumulator();
  let pending = "";

  const handleLine = (line: string): void => {
    if (!line.startsWith("data:")) {
      return;
    }
    const event = parseJson(line.slice("data:".length).trim());
    if (!isRecord(event)) {
      return;
    }
    if (event.type === "message_start" && isRecord(event.message)) {
      const { message } = event;
      if (typeof message.model === "string") {
        acc.model = message.model;
      }
      applyUsage(acc, message.usage);
    } else if (event.type === "message_delta") {
      applyUsage(acc, event.usage);
    }
  };

  return {
    feed: (text) => {
      pending += text;
      const lines = pending.split(LINE_BREAK);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        handleLine(line);
      }
    },
    finish: () => {
      if (pending) {
        handleLine(pending);
        pending = "";
      }
      return toUsage(acc);
    },
  };
};

/** Reads `model` + `usage` from a non-streaming JSON body. */
export const jsonUsageTracker = (): UsageTracker => {
  let body = "";
  let overflow = false;
  return {
    feed: (text) => {
      if (overflow) {
        return;
      }
      body += text;
      if (body.length > MAX_JSON_USAGE_BYTES) {
        overflow = true;
        body = "";
      }
    },
    finish: () => {
      const parsed = parseJson(body);
      if (!isRecord(parsed) || typeof parsed.model !== "string") {
        return null;
      }
      const acc = newAccumulator();
      acc.model = parsed.model;
      applyUsage(acc, parsed.usage);
      return toUsage(acc);
    },
  };
};

const pctFromFraction = (value: string | undefined): number | null => {
  if (value === undefined) {
    return null;
  }
  const n = Number(value);
  // Rounded to 0.1 point: 0.58 * 100 is 57.99999999999999 in floating point.
  return Number.isFinite(n) ? Math.round(n * PERCENT * 10) / 10 : null;
};

const isoFromEpochSeconds = (value: string | undefined): string | null => {
  if (value === undefined) {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? new Date(n * MS_PER_SECOND).toISOString() : null;
};

const isoFromAny = (value: string | undefined): string | null => {
  if (value === undefined) {
    return null;
  }
  const asDate = new Date(value);
  return Number.isNaN(asDate.getTime())
    ? isoFromEpochSeconds(value)
    : asDate.toISOString();
};

/** "450K", "2M": a per-minute limit as the plan label shows it. */
const compact = (n: number): string => {
  if (n >= MILLION) {
    return `${Number((n / MILLION).toFixed(1))}M`;
  }
  return n >= THOUSAND ? `${Math.round(n / THOUSAND)}K` : String(n);
};

/**
 * Meter headers, in order of preference:
 * 1. Plan utilization: `anthropic-ratelimit-unified-{5h,7d}-utilization` (fraction 0..1) and
 *    `-reset` (epoch seconds) -> session (5h) and weekly (7d) meters.
 * 2. Documented API token bucket: `anthropic-ratelimit-tokens-{limit,remaining,reset}` -> session
 *    meter only; weekly stays null.
 */
export const readAnthropicMeters = (
  rawHeaders: Readonly<Record<string, string>>,
  now: Date
): UsageMeters | null => {
  const h = lower(rawHeaders);
  const session = pctFromFraction(
    h["anthropic-ratelimit-unified-5h-utilization"]
  );
  const weekly = pctFromFraction(
    h["anthropic-ratelimit-unified-7d-utilization"]
  );
  if (session !== null || weekly !== null) {
    return {
      plan: "Claude subscription",
      readAt: now.toISOString(),
      sessionResetsAt: isoFromAny(h["anthropic-ratelimit-unified-5h-reset"]),
      sessionUsedPct: session,
      source: "plan",
      weeklyResetsAt: isoFromAny(h["anthropic-ratelimit-unified-7d-reset"]),
      weeklyUsedPct: weekly,
    };
  }
  const limit = Number(h["anthropic-ratelimit-tokens-limit"]);
  const remaining = Number(h["anthropic-ratelimit-tokens-remaining"]);
  if (Number.isFinite(limit) && Number.isFinite(remaining) && limit > 0) {
    return {
      plan: `API key · ${compact(limit)} tokens/min`,
      readAt: now.toISOString(),
      sessionResetsAt: isoFromAny(h["anthropic-ratelimit-tokens-reset"]),
      sessionUsedPct: ((limit - remaining) / limit) * PERCENT,
      source: "api_rate_limit",
      weeklyResetsAt: null,
      weeklyUsedPct: null,
    };
  }
  return null;
};

const pickHeaders = (
  headers: Readonly<Record<string, string>>,
  allowed: readonly string[]
): Record<string, string> => {
  const h = lower(headers);
  const out: Record<string, string> = {};
  for (const name of allowed) {
    const value = h[name];
    if (value !== undefined) {
      out[name] = value;
    }
  }
  return out;
};

/** The documented API-key header plus our honest User-Agent. */
const authHeaders = (credential: Redacted.Redacted<string>) => ({
  "user-agent": USER_AGENT,
  "x-api-key": Redacted.value(credential),
});

export const makeAnthropicAdapter = (baseUrl: string): ProviderAdapter => ({
  buildRequest: (request, credential) => {
    const forwarded = pickHeaders(request.headers, FORWARDED_REQUEST_HEADERS);
    return {
      body: request.body,
      headers: {
        "anthropic-version": DEFAULT_ANTHROPIC_VERSION,
        "content-type": "application/json",
        ...forwarded,
        ...authHeaders(credential),
      },
      url: `${baseUrl}${request.path}`,
    };
  },
  cooloffMs: (headers, defaultMs) => {
    const retryAfter = Number(lower(headers)["retry-after"]);
    return Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.max(retryAfter * MS_PER_SECOND, defaultMs)
      : defaultMs;
  },
  forwardHeaders: (headers) => pickHeaders(headers, FORWARDED_RESPONSE_HEADERS),
  meterProbe: (credential) => ({
    body: JSON.stringify({
      messages: [{ content: "ping", role: "user" }],
      model: PROBE_MODEL,
    }),
    headers: {
      "anthropic-version": DEFAULT_ANTHROPIC_VERSION,
      "content-type": "application/json",
      ...authHeaders(credential),
    },
    url: `${baseUrl}/v1/messages/count_tokens`,
  }),
  provider: "anthropic",
  readMeters: readAnthropicMeters,
  usageTracker: (contentType) =>
    contentType.includes("text/event-stream")
      ? sseUsageTracker()
      : jsonUsageTracker(),
});
