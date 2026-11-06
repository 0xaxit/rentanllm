/**
 * MCP server settings, from the environment (an MCP client passes them in its server
 * config). Every payment is capped per request and per rolling 24 hours. Who approves a
 * payment depends on `Approval`.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The one network the market pays on. */
export type PayNetwork = "hedera:testnet";

/** How a payment is approved before its key is released. */
/**
 * - `touchid`: the person approves every payment with Touch ID.
 * - `threshold`: payments up to `autoApproveMicros` go through on their own; larger ones
 *   wait for the person to confirm in the MCP client (see approval.ts).
 * - `world`: like `threshold`, but the person approves larger payments with World ID Agent
 *   Pass, validated by the RentAnLLM API (see world.ts).
 * - `none`: no person; the caps are the only limit (the autonomous `agent` command).
 */
export type Approval = "touchid" | "threshold" | "world" | "none";

export interface McpConfig {
  /** Hedera account that pays (0.0.x). */
  readonly account: string;
  /** RentAnLLM API base URL, for World ID approvals (approval "world"). */
  readonly apiUrl: string | null;
  readonly approval: Approval;
  /** With approval "threshold" or "world": the largest payment made without asking the person. */
  readonly autoApproveMicros: bigint;
  /** Gateway base URL, without /v1. */
  readonly gatewayUrl: string;
  /** With approval "threshold", "world" or "none": the payer key, from env or a key file. */
  readonly insecureKey: string | null;
  readonly maxPerDayMicros: bigint;
  readonly maxPerRequestMicros: bigint;
  readonly network: PayNetwork;
  /** The Touch ID helper (signer/main.swift, built by `bun run build:signer`). */
  readonly signerPath: string;
  /** Where the spend log lives. */
  readonly stateDir: string;
}

const DEFAULT_GATEWAY_URL = "http://localhost:8787";
const DEFAULT_MAX_PER_REQUEST_USDC = "0.05";
const DEFAULT_MAX_PER_DAY_USDC = "1";
const DEFAULT_AUTO_APPROVE_USDC = "0.001";
const MICROS_PER_USDC = 1_000_000n;
const USDC_AMOUNT = /^(?<whole>\d+)(?:\.(?<fraction>\d{1,6}))?$/u;
const HEDERA_ACCOUNT = /^\d+\.\d+\.\d+$/u;
const TRAILING_SLASHES = /\/+$/u;
const V1_SUFFIX = /\/v1$/u;
const HOME_PREFIX = /^~\//u;

export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

/** "0.05" -> 50_000n micro-USDC. */
export const usdcToMicros = (value: string): bigint => {
  const groups = USDC_AMOUNT.exec(value.trim())?.groups;
  if (groups?.whole === undefined) {
    throw new ConfigError(`not a USDC amount: ${value}`);
  }
  const fraction = (groups.fraction ?? "").padEnd(6, "0");
  return BigInt(groups.whole) * MICROS_PER_USDC + BigInt(fraction);
};

/** 750n -> "0.00075" */
export const formatUsdc = (micros: bigint): string => {
  const whole = micros / MICROS_PER_USDC;
  const fraction = (micros % MICROS_PER_USDC)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/u, "");
  return fraction.length === 0 ? whole.toString() : `${whole}.${fraction}`;
};

const DEFAULT_SIGNER = fileURLToPath(
  new URL("../dist/rentanllm-signer", import.meta.url)
);

const parseNetwork = (env: NodeJS.ProcessEnv): PayNetwork => {
  const network = env.RENTANLLM_MCP_NETWORK ?? "hedera:testnet";
  if (network !== "hedera:testnet") {
    throw new ConfigError(
      `RENTANLLM_MCP_NETWORK must be hedera:testnet (the only network the market pays on), not ${network}`
    );
  }
  return network;
};

const parseAccount = (env: NodeJS.ProcessEnv): string => {
  const account = env.RENTANLLM_MCP_ACCOUNT?.trim() ?? "";
  if (!HEDERA_ACCOUNT.test(account)) {
    throw new ConfigError(
      "RENTANLLM_MCP_ACCOUNT must be the paying Hedera account id (0.0.x)"
    );
  }
  return account;
};

/**
 * The payer key without Touch ID: `RENTANLLM_MCP_PRIVATE_KEY`, or `RENTANLLM_MCP_KEY_FILE`
 * holding either the raw key or JSON with a `privateKeyHex` field.
 */
const keyWithoutApproval = (env: NodeJS.ProcessEnv): string | null => {
  const inline = env.RENTANLLM_MCP_PRIVATE_KEY?.trim();
  if (inline !== undefined && inline.length > 0) {
    return inline;
  }
  const file = env.RENTANLLM_MCP_KEY_FILE?.trim();
  if (file === undefined || file.length === 0) {
    return null;
  }
  const text = readFileSync(
    file.replace(HOME_PREFIX, `${homedir()}/`),
    "utf-8"
  ).trim();
  if (!text.startsWith("{")) {
    return text;
  }
  const parsed = JSON.parse(text) as { privateKeyHex?: unknown };
  if (typeof parsed.privateKeyHex !== "string") {
    throw new ConfigError(`${file} has no "privateKeyHex" field`);
  }
  return parsed.privateKeyHex.trim();
};

/**
 * Touch ID unless set otherwise. "threshold" and "none" read the key without Touch ID, so
 * they need it in RENTANLLM_MCP_PRIVATE_KEY or RENTANLLM_MCP_KEY_FILE.
 */
const parseApproval = (
  env: NodeJS.ProcessEnv
): { readonly approval: Approval; readonly insecureKey: string | null } => {
  const mode = env.RENTANLLM_MCP_APPROVAL ?? "touchid";
  if (mode === "none" || mode === "threshold" || mode === "world") {
    const insecureKey = keyWithoutApproval(env);
    if (insecureKey === null) {
      throw new ConfigError(
        `RENTANLLM_MCP_APPROVAL=${mode} needs RENTANLLM_MCP_PRIVATE_KEY or RENTANLLM_MCP_KEY_FILE`
      );
    }
    return { approval: mode, insecureKey };
  }
  if (mode !== "touchid") {
    throw new ConfigError(
      `RENTANLLM_MCP_APPROVAL must be touchid, threshold, world or none, not ${mode}`
    );
  }
  if (process.platform !== "darwin") {
    throw new ConfigError(
      "Touch ID approval needs macOS; elsewhere set RENTANLLM_MCP_APPROVAL=threshold, world or none"
    );
  }
  return { approval: "touchid", insecureKey: null };
};

/** World approvals need the API that holds World's client secret. */
const parseApiUrl = (
  env: NodeJS.ProcessEnv,
  approval: Approval
): string | null => {
  const url = env.RENTANLLM_API_URL?.trim().replace(TRAILING_SLASHES, "") ?? "";
  if (url.length > 0) {
    return url;
  }
  if (approval === "world") {
    throw new ConfigError(
      "RENTANLLM_MCP_APPROVAL=world needs RENTANLLM_API_URL, the RentAnLLM API that validates World ID approvals"
    );
  }
  return null;
};

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): McpConfig => {
  const network = parseNetwork(env);
  const approval = parseApproval(env);
  return {
    account: parseAccount(env),
    apiUrl: parseApiUrl(env, approval.approval),
    ...approval,
    autoApproveMicros: usdcToMicros(
      env.RENTANLLM_MCP_AUTO_APPROVE_USDC ?? DEFAULT_AUTO_APPROVE_USDC
    ),
    gatewayUrl: (env.RENTANLLM_GATEWAY_URL ?? DEFAULT_GATEWAY_URL)
      .replace(TRAILING_SLASHES, "")
      .replace(V1_SUFFIX, ""),
    maxPerDayMicros: usdcToMicros(
      env.RENTANLLM_MCP_MAX_PER_DAY_USDC ?? DEFAULT_MAX_PER_DAY_USDC
    ),
    maxPerRequestMicros: usdcToMicros(
      env.RENTANLLM_MCP_MAX_PER_REQUEST_USDC ?? DEFAULT_MAX_PER_REQUEST_USDC
    ),
    network,
    signerPath: env.RENTANLLM_MCP_SIGNER ?? DEFAULT_SIGNER,
    stateDir:
      env.RENTANLLM_MCP_STATE_DIR ??
      path.join(homedir(), ".config", "rentanllm", "mcp"),
  };
};

/** The keychain entry the payer key lives under. */
export const keychainAccount = (config: McpConfig): string =>
  `${config.network}:${config.account}`;
