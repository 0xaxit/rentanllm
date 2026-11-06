import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { HEARTBEAT_INTERVAL_MS, TUNNEL_PATH } from "@rentanllm/protocol";
import { Context, Effect, Redacted } from "effect";

import { ConfigError } from "./config-error.ts";
import type { CliProxyApiOptions } from "./providers/cliproxyapi.ts";
import { DEFAULT_OLLAMA_URL } from "./providers/ollama.ts";
import type { OllamaOptions } from "./providers/ollama.ts";

/** CLIProxyAPI's default port, used when its config file does not set one. */
export const DEFAULT_CLIPROXYAPI_PORT = 8317;
const DEFAULT_BACKOFF_BASE_MS = 1000;
const DEFAULT_BACKOFF_MAX_MS = 60_000;
const DEFAULT_RATE_LIMIT_COOLOFF_MS = 60_000;
const DEFAULT_STABLE_AFTER_MS = 30_000;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Fully resolved agent configuration. */
export interface AgentConfig {
  readonly backoffBaseMs: number;
  readonly backoffMaxMs: number;
  /** The local CLIProxyAPI that serves the owner's own subscription login. */
  readonly cliProxyApi: CliProxyApiOptions;
  readonly configDir: string;
  readonly gatewayUrl: string;
  readonly heartbeatIntervalMs: number;
  /** Keep the machine awake (caffeinate / systemd-inhibit) while the node is open. */
  readonly keepAwake: boolean;
  /** Probe the provider for fresh meter headers when the reading is stale and the node is open. */
  readonly meterProbe: boolean;
  readonly nodeId: string;
  readonly nodeToken: Redacted.Redacted<string>;
  /** The local Ollama serving open models; null when the owner serves none. */
  readonly ollama: OllamaOptions | null;
  readonly rateLimitCooloffMs: number;
  /** A connection that drops sooner than this counts as a failed attempt for backoff purposes. */
  readonly stableAfterMs: number;
}

export class NodeConfig extends Context.Service<NodeConfig, AgentConfig>()(
  "rentanllm/NodeConfig"
) {}

/** Values a user can set, from any source. All optional; later sources lose to earlier ones. */
export interface ConfigInput {
  /** Path to CLIProxyAPI's config.yaml (default ~/.cli-proxy-api/config.yaml). */
  readonly cliProxyApiConfig?: string | undefined;
  /** Read from CLIProxyAPI's config.yaml, never set by hand. */
  readonly cliProxyApiKey?: string | undefined;
  /** Read from CLIProxyAPI's config.yaml, never set by hand. */
  readonly cliProxyApiPort?: number | undefined;
  readonly cliProxyApiUrl?: string | undefined;
  readonly gatewayUrl?: string | undefined;
  readonly keepAwake?: boolean | undefined;
  readonly meterProbe?: boolean | undefined;
  readonly nodeId?: string | undefined;
  readonly nodeToken?: string | undefined;
  /** A model Ollama has pulled, e.g. "llama3.1:8b". Setting it turns the Ollama upstream on. */
  readonly ollamaModel?: string | undefined;
  /** Ollama's address (default http://127.0.0.1:11434). */
  readonly ollamaUrl?: string | undefined;
  /** A local OpenAI-compatible image server (e.g. sd-server); turns image listings on. */
  readonly imageUrl?: string | undefined;
  readonly rateLimitCooloffMs?: number | undefined;
}

export const configDirFromEnv = (env: NodeJS.ProcessEnv): string => {
  const explicit = env.RENTANLLM_CONFIG_DIR;
  if (explicit) {
    return explicit;
  }
  const xdg = env.XDG_CONFIG_HOME;
  return path.join(xdg || path.join(homedir(), ".config"), "rentanllm");
};

const parseBool = (value: string | undefined): boolean | undefined => {
  if (value === undefined || value === "") {
    return undefined;
  }
  return value === "1" || value.toLowerCase() === "true";
};

const parseNumber = (value: string | undefined): number | undefined => {
  if (value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const configFromEnv = (env: NodeJS.ProcessEnv): ConfigInput => ({
  cliProxyApiConfig: env.RENTANLLM_CLIPROXYAPI_CONFIG,
  cliProxyApiUrl: env.RENTANLLM_CLIPROXYAPI_URL,
  gatewayUrl: env.RENTANLLM_GATEWAY_URL,
  imageUrl: env.RENTANLLM_IMAGE_URL,
  keepAwake: parseBool(env.RENTANLLM_KEEP_AWAKE),
  meterProbe: parseBool(env.RENTANLLM_METER_PROBE),
  nodeId: env.RENTANLLM_NODE_ID,
  nodeToken: env.RENTANLLM_NODE_TOKEN,
  ollamaModel: env.RENTANLLM_OLLAMA_MODEL,
  ollamaUrl: env.RENTANLLM_OLLAMA_URL,
  rateLimitCooloffMs: parseNumber(env.RENTANLLM_RATE_LIMIT_COOLOFF_MS),
});

const isRecord = (u: unknown): u is Record<string, unknown> =>
  typeof u === "object" && u !== null && !Array.isArray(u);

const str = (u: unknown): string | undefined =>
  typeof u === "string" ? u : undefined;
const bool = (u: unknown): boolean | undefined =>
  typeof u === "boolean" ? u : undefined;
const num = (u: unknown): number | undefined =>
  typeof u === "number" && Number.isFinite(u) ? u : undefined;

/** Reads `<configDir>/config.json` if present. Missing file is not an error. */
export const readConfigFile = (configDir: string): ConfigInput => {
  let raw: string;
  try {
    raw = readFileSync(path.join(configDir, "config.json"), "utf-8");
  } catch {
    return {};
  }
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) {
    return {};
  }
  return {
    cliProxyApiConfig: str(parsed.cliProxyApiConfig),
    cliProxyApiUrl: str(parsed.cliProxyApiUrl),
    gatewayUrl: str(parsed.gatewayUrl),
    imageUrl: str(parsed.imageUrl),
    keepAwake: bool(parsed.keepAwake),
    meterProbe: bool(parsed.meterProbe),
    nodeId: str(parsed.nodeId),
    nodeToken: str(parsed.nodeToken),
    ollamaModel: str(parsed.ollamaModel),
    ollamaUrl: str(parsed.ollamaUrl),
    rateLimitCooloffMs: num(parsed.rateLimitCooloffMs),
  };
};

/** Picks the first defined value for every key: flags, then env, then the config file. */
export const mergeInputs = (...inputs: readonly ConfigInput[]): ConfigInput => {
  const pick = <K extends keyof ConfigInput>(key: K): ConfigInput[K] => {
    for (const input of inputs) {
      const value = input[key];
      if (value !== undefined) {
        return value;
      }
    }
    return undefined;
  };
  return {
    cliProxyApiConfig: pick("cliProxyApiConfig"),
    cliProxyApiKey: pick("cliProxyApiKey"),
    cliProxyApiPort: pick("cliProxyApiPort"),
    cliProxyApiUrl: pick("cliProxyApiUrl"),
    gatewayUrl: pick("gatewayUrl"),
    imageUrl: pick("imageUrl"),
    keepAwake: pick("keepAwake"),
    meterProbe: pick("meterProbe"),
    nodeId: pick("nodeId"),
    nodeToken: pick("nodeToken"),
    ollamaModel: pick("ollamaModel"),
    ollamaUrl: pick("ollamaUrl"),
    rateLimitCooloffMs: pick("rateLimitCooloffMs"),
  };
};

const isLocalHost = (url: URL): boolean => LOCAL_HOSTS.has(url.hostname);

/** Rejects plaintext transports except to localhost, so tokens and credentials never travel unencrypted. */
export const validateUrl = (
  label: string,
  value: string,
  secure: string,
  insecure: string
): URL => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError({ message: `${label} is not a valid URL` });
  }
  const ok =
    url.protocol === secure || (url.protocol === insecure && isLocalHost(url));
  if (!ok) {
    throw new ConfigError({
      message: `${label} must use ${secure}// (${insecure}// is only allowed for localhost)`,
    });
  }
  return url;
};

/**
 * The gateway's tunnel URL. A bare host (`wss://gw.example` or `wss://gw.example/`) gets
 * the protocol's tunnel path appended; any other path is used as given.
 */
export const tunnelUrl = (gateway: URL): string => {
  const url = new URL(gateway.toString());
  if (url.pathname === "" || url.pathname === "/") {
    url.pathname = TUNNEL_PATH;
  }
  return url.toString();
};

export const defaultCliProxyApiConfigPath = (): string =>
  path.join(homedir(), ".cli-proxy-api", "config.yaml");

const QUOTED = /^(?<quote>["'])(?<inner>.*)\k<quote>$/u;
const TOP_LEVEL_KEY = /^[A-Za-z0-9_-]+:/u;
const LIST_ITEM = /^\s+-\s*(?<value>.+)$/u;
const TRAILING_COMMENT = /\s+#.*$/u;

const unquote = (value: string): string => {
  const trimmed = value.trim();
  return QUOTED.exec(trimmed)?.groups?.inner ?? trimmed;
};

/**
 * The two values the agent needs from CLIProxyAPI's config.yaml: its `port` and the first of
 * its `api-keys` (the key clients use to reach it). Missing file or keys are not errors here.
 */
export const readCliProxyApiConfig = (
  filePath: string
): { readonly apiKey?: string; readonly port?: number } => {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return {};
  }
  let port: number | undefined;
  let apiKey: string | undefined;
  let inApiKeys = false;
  for (const line of raw.split("\n")) {
    const content = line.replace(TRAILING_COMMENT, "");
    if (TOP_LEVEL_KEY.test(content)) {
      const [key = "", ...rest] = content.split(":");
      const value = rest.join(":").trim();
      inApiKeys = key === "api-keys" && value === "";
      if (key === "port") {
        port = parseNumber(unquote(value));
      }
      continue;
    }
    const item = LIST_ITEM.exec(content)?.groups?.value;
    if (inApiKeys && item !== undefined && apiKey === undefined) {
      apiKey = unquote(item) || undefined;
    }
  }
  return {
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(port === undefined ? {} : { port }),
  };
};

/** CLIProxyAPI is a local process, so plain http is fine for localhost only, like other upstreams. */
const resolveCliProxyApi = (input: ConfigInput): CliProxyApiOptions => {
  const configPath = input.cliProxyApiConfig ?? defaultCliProxyApiConfigPath();
  const url = validateUrl(
    "CLIProxyAPI URL",
    input.cliProxyApiUrl ??
      `http://127.0.0.1:${input.cliProxyApiPort ?? DEFAULT_CLIPROXYAPI_PORT}`,
    "https:",
    "http:"
  );
  return {
    apiKey: input.cliProxyApiKey ? Redacted.make(input.cliProxyApiKey) : null,
    baseUrl: url.origin,
    configPath,
    probeModels: {},
  };
};

/** Ollama is a local process too, so plain http is fine for localhost only. */
const resolveOllama = (input: ConfigInput): OllamaOptions | null => {
  const model = input.ollamaModel?.trim();
  if (!model) {
    return null;
  }
  const url = validateUrl(
    "Ollama URL",
    input.ollamaUrl ?? DEFAULT_OLLAMA_URL,
    "https:",
    "http:"
  );
  const imageUrl = input.imageUrl?.trim();
  return {
    baseUrl: url.origin,
    imageBaseUrl: imageUrl
      ? validateUrl("image server URL", imageUrl, "https:", "http:").origin
      : null,
    probeModel: model,
  };
};

export const resolveConfig = (
  input: ConfigInput,
  configDir: string
): AgentConfig => {
  if (!input.gatewayUrl) {
    throw new ConfigError({
      message:
        "gateway URL is required (--gateway, RENTANLLM_GATEWAY_URL or config.json gatewayUrl)",
    });
  }
  const nodeId = input.nodeId?.trim();
  if (!nodeId) {
    throw new ConfigError({
      message:
        "node id is required (--node-id, RENTANLLM_NODE_ID or config.json nodeId): use the node id shown when you registered the node in the dashboard, next to its token",
    });
  }
  if (!input.nodeToken) {
    throw new ConfigError({
      message:
        "node token is required (--node-token, RENTANLLM_NODE_TOKEN or config.json nodeToken)",
    });
  }
  const gateway = validateUrl("gateway URL", input.gatewayUrl, "wss:", "ws:");
  const cliProxyApi = resolveCliProxyApi(input);
  return {
    backoffBaseMs: DEFAULT_BACKOFF_BASE_MS,
    backoffMaxMs: DEFAULT_BACKOFF_MAX_MS,
    cliProxyApi,
    configDir,
    gatewayUrl: tunnelUrl(gateway),
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    keepAwake: input.keepAwake ?? true,
    meterProbe: input.meterProbe ?? true,
    nodeId,
    nodeToken: Redacted.make(input.nodeToken),
    ollama: resolveOllama(input),
    rateLimitCooloffMs:
      input.rateLimitCooloffMs ?? DEFAULT_RATE_LIMIT_COOLOFF_MS,
    stableAfterMs: DEFAULT_STABLE_AFTER_MS,
  };
};

/**
 * Loads config from flags > env > `<configDir>/config.json`, then fills CLIProxyAPI's port
 * and access key from its own config.yaml.
 */
export const loadConfig = (
  flags: ConfigInput,
  env: NodeJS.ProcessEnv = process.env
): Effect.Effect<AgentConfig, ConfigError> =>
  Effect.try({
    catch: (cause) =>
      cause instanceof ConfigError
        ? cause
        : new ConfigError({
            message: `could not load config: ${String(cause)}`,
          }),
    try: () => {
      const configDir = configDirFromEnv(env);
      const merged = mergeInputs(
        flags,
        configFromEnv(env),
        readConfigFile(configDir)
      );
      const proxy = readCliProxyApiConfig(
        merged.cliProxyApiConfig ?? defaultCliProxyApiConfigPath()
      );
      return resolveConfig(
        {
          ...merged,
          cliProxyApiKey: proxy.apiKey,
          cliProxyApiPort: proxy.port,
        },
        configDir
      );
    },
  });
