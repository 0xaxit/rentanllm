/**
 * CLIProxyAPI upstream (https://github.com/router-for-me/CLIProxyAPI): a local proxy that serves
 * the owner's own CLI logins (Codex, Claude Code, Gemini, ...) behind an Anthropic-compatible
 * `/v1/messages`. It is the node's only upstream: the owner rents out their subscription, never
 * an API key. The node talks to it like the Anthropic API, with CLIProxyAPI's own access key
 * (read from its config.yaml) as the credential.
 *
 * Meters only arrive when CLIProxyAPI runs with `passthrough-headers: true`, which forwards the
 * upstream's quota headers (`x-codex-*` for Codex, `anthropic-ratelimit-unified-*` for Claude).
 * CLIProxyAPI answers `count_tokens` locally, so the meter probe is a one-token message instead.
 */
import type { Provider, UsageMeters } from "@rentanllm/protocol";
import { Effect, Redacted } from "effect";

import { ConfigError } from "../config-error.ts";
import type { ProviderAdapter } from "./adapter.ts";
import { makeAnthropicAdapter, readAnthropicMeters } from "./anthropic.ts";

const MS_PER_SECOND = 1000;
/** Windows up to a day long are the session meter; longer ones are the weekly meter. */
const SESSION_WINDOW_MAX_MINUTES = 24 * 60;

export const CLI_PROXY_API_METER_HINT =
  "set `passthrough-headers: true` in the CLIProxyAPI config so it forwards the plan's quota headers";

interface CodexWindow {
  readonly minutes: number;
  readonly resetsAt: string | null;
  readonly usedPct: number;
}

const lower = (
  headers: Readonly<Record<string, string>>
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key.toLowerCase()] = value;
  }
  return out;
};

const finite = (value: string | undefined): number | null => {
  if (value === undefined || value.trim() === "") {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** One `x-codex-{primary,secondary}-*` window; null when absent or zero minutes long. */
const codexWindow = (
  h: Record<string, string>,
  name: "primary" | "secondary"
): CodexWindow | null => {
  const usedPct = finite(h[`x-codex-${name}-used-percent`]);
  const minutes = finite(h[`x-codex-${name}-window-minutes`]);
  if (usedPct === null || minutes === null || minutes <= 0) {
    return null;
  }
  const resetAt = finite(h[`x-codex-${name}-reset-at`]);
  return {
    minutes,
    resetsAt:
      resetAt === null ? null : new Date(resetAt * MS_PER_SECOND).toISOString(),
    usedPct,
  };
};

/**
 * Codex plan meters from ChatGPT's `x-codex-*` headers. Each window says how long it is, so
 * windows of a day or less map to the session meter and longer ones to the weekly meter. A
 * plan with only a weekly window reports it as the session meter too, because admission needs
 * a session reading and the weekly window is then the tightest limit there is.
 */
export const readCodexMeters = (
  rawHeaders: Readonly<Record<string, string>>,
  now: Date
): UsageMeters | null => {
  const h = lower(rawHeaders);
  const windows = [codexWindow(h, "primary"), codexWindow(h, "secondary")]
    .filter((w): w is CodexWindow => w !== null)
    .toSorted((a, b) => a.minutes - b.minutes);
  if (windows.length === 0) {
    return null;
  }
  const session =
    windows.find((w) => w.minutes <= SESSION_WINDOW_MAX_MINUTES) ?? null;
  const weekly = windows.findLast(
    (w) => w.minutes > SESSION_WINDOW_MAX_MINUTES
  );
  const sessionOrWeekly = session ?? weekly ?? null;
  const planType = h["x-codex-plan-type"];
  return {
    plan: planType ? `ChatGPT ${planType}` : "ChatGPT subscription",
    readAt: now.toISOString(),
    sessionResetsAt: sessionOrWeekly?.resetsAt ?? null,
    sessionUsedPct: sessionOrWeekly?.usedPct ?? null,
    source: "plan",
    weeklyResetsAt: weekly?.resetsAt ?? null,
    weeklyUsedPct: weekly?.usedPct ?? null,
  };
};

export interface CliProxyApiOptions {
  /** CLIProxyAPI's access key (first of its `api-keys`); null when its config has none. */
  readonly apiKey: Redacted.Redacted<string> | null;
  readonly baseUrl: string;
  /** CLIProxyAPI's config.yaml, named in error messages. */
  readonly configPath: string;
  /**
   * The subscriptions this node serves: provider -> the model its meter probe asks for, one
   * CLIProxyAPI actually answers with usage meters. Empty until `detectSubscriptions` fills
   * it in at start-up.
   */
  readonly probeModels: Readonly<Partial<Record<Provider, string>>>;
}

/**
 * Serves one provider's subscription through CLIProxyAPI's Anthropic-compatible
 * `/v1/messages`: CLIProxyAPI translates for non-Claude logins (Codex), so renters use the
 * Messages API whichever plan they rent. No probe is sent while `probeModel` is null.
 */
export const makeCliProxyApiAdapter = (options: {
  readonly baseUrl: string;
  readonly probeModel: string | null;
  readonly provider: Provider;
}): ProviderAdapter => {
  const anthropic = makeAnthropicAdapter(options.baseUrl);
  return {
    ...anthropic,
    meterProbe: (credential) =>
      options.probeModel === null
        ? null
        : anthropic.buildRequest(
            {
              _tag: "ProxyRequest",
              body: JSON.stringify({
                max_tokens: 1,
                messages: [{ content: "ping", role: "user" }],
                model: options.probeModel,
              }),
              bookingId: "meter-probe",
              headers: {},
              method: "POST",
              path: "/v1/messages",
              provider: options.provider,
              requestId: "meter-probe",
            },
            credential
          ),
    missingMetersHint: CLI_PROXY_API_METER_HINT,
    provider: options.provider,
    readMeters: (headers, now) =>
      readAnthropicMeters(headers, now) ?? readCodexMeters(headers, now),
  };
};

/** Dated ids (claude-sonnet-4-20250514) are pinned snapshots, often retired upstream. */
const DATED_MODEL = /-\d{8}$/u;
const UNKNOWN_RANK = 9;
/** Models tried per provider at start-up before giving up; each try is one tiny message. */
const MAX_PROBE_CANDIDATES = 6;

interface ProbeFamily {
  /** Ids served by this provider's login. */
  readonly matches: (id: string) => boolean;
  /** Name fragments from lightest to heaviest, so probes use as little quota as possible. */
  readonly lightToHeavy: readonly string[];
}

/** The subscriptions CLIProxyAPI can serve, and how to tell their models apart. */
const PROBE_FAMILIES: Readonly<Partial<Record<Provider, ProbeFamily>>> = {
  anthropic: {
    lightToHeavy: ["haiku", "sonnet", "opus"],
    matches: (id) => id.startsWith("claude-"),
  },
  openai: {
    lightToHeavy: ["luna", "terra", "sol", "astra"],
    matches: (id) => id.startsWith("gpt-") && !id.startsWith("gpt-image"),
  },
};

const weight = (family: ProbeFamily, id: string): number => {
  const index = family.lightToHeavy.findIndex((name) => id.includes(name));
  return index === -1 ? UNKNOWN_RANK : index;
};

/**
 * One provider's probe candidates, most likely to work and lightest on the owner's quota
 * first: current (undated) ids before snapshots, lighter models first, newest version first.
 */
export const probeCandidates = (
  provider: Provider,
  models: readonly string[]
): string[] => {
  const family = PROBE_FAMILIES[provider];
  if (family === undefined) {
    return [];
  }
  return models
    .filter((id) => family.matches(id))
    .toSorted(
      (a, b) =>
        Number(DATED_MODEL.test(a)) - Number(DATED_MODEL.test(b)) ||
        weight(family, a) - weight(family, b) ||
        b.localeCompare(a, "en", { numeric: true })
    );
};

const listModels = (
  options: CliProxyApiOptions,
  apiKey: Redacted.Redacted<string>
): Effect.Effect<string[], ConfigError> =>
  Effect.gen(function* list() {
    const response = yield* Effect.tryPromise({
      catch: () =>
        new ConfigError({
          message: `CLIProxyAPI is not reachable at ${options.baseUrl}: start it (brew services start cliproxyapi) or pass --cliproxyapi-url`,
        }),
      try: () =>
        fetch(`${options.baseUrl}/v1/models`, {
          headers: { authorization: `Bearer ${Redacted.value(apiKey)}` },
        }),
    });
    if (response.status === 401 || response.status === 403) {
      return yield* new ConfigError({
        message: `CLIProxyAPI refused its access key: check api-keys in ${options.configPath}`,
      });
    }
    const body = yield* Effect.tryPromise({
      catch: () =>
        new ConfigError({
          message: `CLIProxyAPI at ${options.baseUrl} did not return its model list (HTTP ${response.status})`,
        }),
      try: () => response.json() as Promise<{ data?: { id?: unknown }[] }>,
    });
    return (body.data ?? []).flatMap((model) =>
      typeof model.id === "string" ? [model.id] : []
    );
  });

/** True when a one-token message to `model` comes back with the plan's usage meters. */
const answersWithMeters = (
  options: CliProxyApiOptions,
  apiKey: Redacted.Redacted<string>,
  provider: Provider,
  model: string
): Effect.Effect<boolean> => {
  const adapter = makeCliProxyApiAdapter({
    baseUrl: options.baseUrl,
    probeModel: model,
    provider,
  });
  const request = adapter.meterProbe(apiKey);
  if (request === null) {
    return Effect.succeed(false);
  }
  return Effect.tryPromise(async () => {
    const response = await fetch(request.url, {
      body: request.body,
      headers: request.headers,
      method: "POST",
    });
    await response.body?.cancel();
    const headers: Record<string, string> = {};
    for (const [key, value] of response.headers) {
      headers[key] = value;
    }
    return response.ok && adapter.readMeters(headers, new Date()) !== null;
  }).pipe(Effect.orElseSucceed(() => false));
};

/** The first candidate that answers with usage meters, or null. */
const firstWorkingModel = (
  options: CliProxyApiOptions,
  apiKey: Redacted.Redacted<string>,
  provider: Provider,
  candidates: readonly string[]
): Effect.Effect<string | null> =>
  Effect.gen(function* firstWorking() {
    for (const model of candidates.slice(0, MAX_PROBE_CANDIDATES)) {
      if (yield* answersWithMeters(options, apiKey, provider, model)) {
        return model;
      }
    }
    return null;
  });

/**
 * Finds which subscriptions CLIProxyAPI can serve (Claude -> `anthropic`, Codex ->
 * `openai`) and, for each, a model that actually answers with usage meters, since
 * CLIProxyAPI also lists models its logins cannot serve. Fails clearly when CLIProxyAPI is
 * not running, has no usable login, or does not forward the quota headers.
 */
export const detectSubscriptions = (
  options: CliProxyApiOptions
): Effect.Effect<Partial<Record<Provider, string>>, ConfigError> =>
  Effect.gen(function* detect() {
    const { apiKey } = options;
    if (apiKey === null) {
      return yield* new ConfigError({
        message: `no CLIProxyAPI access key: add one under api-keys in ${options.configPath}, or pass --cliproxyapi-config`,
      });
    }
    const models = yield* listModels(options, apiKey);
    const found: Partial<Record<Provider, string>> = {};
    const tried: string[] = [];
    for (const provider of Object.keys(PROBE_FAMILIES) as Provider[]) {
      const candidates = probeCandidates(provider, models);
      const model = yield* firstWorkingModel(
        options,
        apiKey,
        provider,
        candidates
      );
      if (model === null) {
        tried.push(...candidates.slice(0, MAX_PROBE_CANDIDATES));
      } else {
        found[provider] = model;
      }
    }
    if (Object.keys(found).length > 0) {
      return found;
    }
    return yield* new ConfigError({
      message:
        tried.length === 0
          ? "CLIProxyAPI has no Claude or Codex login, so there is no subscription to serve: run `cliproxyapi --claude-login` or `cliproxyapi --codex-login`, then start the node again"
          : `no model on CLIProxyAPI answered with usage meters (tried ${tried.join(", ")}): check its logins, and ${CLI_PROXY_API_METER_HINT}`,
    });
  });
