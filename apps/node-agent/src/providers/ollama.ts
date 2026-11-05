/**
 * Ollama upstream (https://ollama.com): open models the owner runs on their own machine,
 * served through Ollama's OpenAI-compatible `/v1/chat/completions`. There is no account,
 * plan or quota behind it, so there is no credential and no plan meter: the meter probe is
 * a cheap `/api/show` for the configured model, and any answer to it counts as a fresh
 * "0% used" reading. If Ollama is down the probe fails, the reading goes stale and the
 * node refuses new requests, the same fail-closed path the subscription upstreams use.
 */
import type { ProviderUsage, UsageMeters } from "@rentanllm/protocol";

import { USER_AGENT } from "../version.ts";
import type { ProviderAdapter, UsageTracker } from "./adapter.ts";

const FORWARDED_REQUEST_HEADERS = ["accept", "content-type"] as const;
const FORWARDED_RESPONSE_HEADERS = ["content-type", "retry-after"] as const;
/** Cap on how much of a non-streaming JSON body is kept to read `usage`. */
const MAX_JSON_USAGE_BYTES = 8 * 1024 * 1024;
const MS_PER_SECOND = 1000;
const LINE_BREAK = /\r?\n/u;

export const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";

const lower = (
  headers: Readonly<Record<string, string>>
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key.toLowerCase()] = value;
  }
  return out;
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

const isRecord = (u: unknown): u is Record<string, unknown> =>
  typeof u === "object" && u !== null && !Array.isArray(u);

const int = (u: unknown): number | undefined =>
  typeof u === "number" && Number.isInteger(u) ? u : undefined;

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

interface UsageAccumulator {
  inputTokens: number;
  model: string | null;
  outputTokens: number;
  sawUsage: boolean;
}

/** Applies an OpenAI chat-completions object (a full response or one stream chunk). */
const applyCompletion = (acc: UsageAccumulator, completion: unknown): void => {
  if (!isRecord(completion)) {
    return;
  }
  if (typeof completion.model === "string") {
    acc.model = completion.model;
  }
  const { usage } = completion;
  if (!isRecord(usage)) {
    return;
  }
  acc.sawUsage = true;
  acc.inputTokens = int(usage.prompt_tokens) ?? acc.inputTokens;
  acc.outputTokens = int(usage.completion_tokens) ?? acc.outputTokens;
};

const toUsage = (acc: UsageAccumulator): ProviderUsage | null =>
  acc.model === null || !acc.sawUsage
    ? null
    : {
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        inputTokens: acc.inputTokens,
        model: acc.model,
        outputTokens: acc.outputTokens,
      };

const newAccumulator = (): UsageAccumulator => ({
  inputTokens: 0,
  model: null,
  outputTokens: 0,
  sawUsage: false,
});

/** Reads `usage` from the final SSE chunk (sent because the request asks for it). */
export const openAiSseUsageTracker = (): UsageTracker => {
  const acc = newAccumulator();
  let pending = "";
  const handleLine = (line: string): void => {
    if (!line.startsWith("data:")) {
      return;
    }
    const data = line.slice("data:".length).trim();
    if (data === "[DONE]") {
      return;
    }
    applyCompletion(acc, parseJson(data));
  };
  return {
    feed: (text) => {
      const lines = (pending + text).split(LINE_BREAK);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        handleLine(line);
      }
    },
    finish: () => {
      handleLine(pending);
      pending = "";
      return toUsage(acc);
    },
  };
};

/** Reads `usage` from a non-streaming JSON response. */
export const openAiJsonUsageTracker = (): UsageTracker => {
  let body = "";
  let overflowed = false;
  return {
    feed: (text) => {
      if (overflowed) {
        return;
      }
      body += text;
      if (body.length > MAX_JSON_USAGE_BYTES) {
        overflowed = true;
        body = "";
      }
    },
    finish: () => {
      const acc = newAccumulator();
      applyCompletion(acc, parseJson(body));
      return toUsage(acc);
    },
  };
};

/**
 * Asks Ollama to report usage on streamed responses (`stream_options.include_usage`), so
 * the gateway can record what a paid request actually used. Bodies that are not JSON
 * objects pass through unchanged; Ollama rejects them itself.
 */
export const withStreamUsage = (body: string): string => {
  const json = parseJson(body);
  if (!isRecord(json) || json.stream !== true) {
    return body;
  }
  const options = isRecord(json.stream_options) ? json.stream_options : {};
  return JSON.stringify({
    ...json,
    stream_options: { ...options, include_usage: true },
  });
};

/** Any HTTP answer from Ollama means it is up; there is no quota to read. */
export const readOllamaMeters = (
  headers: Readonly<Record<string, string>>,
  now: Date
): UsageMeters | null =>
  Object.keys(headers).length === 0
    ? null
    : {
        plan: "Open models · self-hosted",
        readAt: now.toISOString(),
        sessionResetsAt: null,
        sessionUsedPct: 0,
        weeklyResetsAt: null,
        weeklyUsedPct: null,
      };

export interface OllamaOptions {
  readonly baseUrl: string;
  /** A model Ollama has pulled; the meter probe asks Ollama about it. */
  readonly probeModel: string;
}

export const makeOllamaAdapter = (options: OllamaOptions): ProviderAdapter => ({
  buildRequest: (request) => ({
    body: withStreamUsage(request.body),
    headers: {
      "content-type": "application/json",
      ...pickHeaders(request.headers, FORWARDED_REQUEST_HEADERS),
      "user-agent": USER_AGENT,
    },
    url: `${options.baseUrl}${request.path}`,
  }),
  cooloffMs: (headers, defaultMs) => {
    const retryAfter = Number(lower(headers)["retry-after"]);
    return Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.max(retryAfter * MS_PER_SECOND, defaultMs)
      : defaultMs;
  },
  forwardHeaders: (headers) => pickHeaders(headers, FORWARDED_RESPONSE_HEADERS),
  meterProbe: () => ({
    body: JSON.stringify({ model: options.probeModel }),
    headers: { "content-type": "application/json", "user-agent": USER_AGENT },
    url: `${options.baseUrl}/api/show`,
  }),
  missingMetersHint: `check that Ollama is running at ${options.baseUrl} and has pulled ${options.probeModel}`,
  provider: "ollama",
  readMeters: readOllamaMeters,
  usageTracker: (contentType) =>
    contentType.includes("text/event-stream")
      ? openAiSseUsageTracker()
      : openAiJsonUsageTracker(),
});
