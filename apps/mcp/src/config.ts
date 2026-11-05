/**
 * MCP server settings, from the environment (an MCP client passes them in its server
 * config). Every payment is capped per request and per rolling 24 hours, and needs the
 * person's approval unless approval is explicitly turned off for development.
 */
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The one network the market pays on. */
export type PayNetwork = "hedera:testnet";

/** How a payment is approved before its key is released. */
export type Approval = "touchid" | "none";

export interface McpConfig {
  /** Hedera account that pays (0.0.x). */
  readonly account: string;
  readonly approval: Approval;
  /** Gateway base URL, without /v1. */
  readonly gatewayUrl: string;
  /** Development only, with approval "none": the payer key itself. */
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
const MICROS_PER_USDC = 1_000_000n;
const USDC_AMOUNT = /^(?<whole>\d+)(?:\.(?<fraction>\d{1,6}))?$/u;
const HEDERA_ACCOUNT = /^\d+\.\d+\.\d+$/u;
const TRAILING_SLASHES = /\/+$/u;
const V1_SUFFIX = /\/v1$/u;

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

/** Touch ID unless explicitly off; "none" is for development and needs a key in env. */
const parseApproval = (
  env: NodeJS.ProcessEnv
): { readonly approval: Approval; readonly insecureKey: string | null } => {
  if (env.RENTANLLM_MCP_APPROVAL === "none") {
    const insecureKey = env.RENTANLLM_MCP_PRIVATE_KEY?.trim() || null;
    if (insecureKey === null) {
      throw new ConfigError(
        "RENTANLLM_MCP_APPROVAL=none needs RENTANLLM_MCP_PRIVATE_KEY (development only)"
      );
    }
    return { approval: "none", insecureKey };
  }
  if (process.platform !== "darwin") {
    throw new ConfigError(
      "Touch ID approval needs macOS; on other systems set RENTANLLM_MCP_APPROVAL=none for development"
    );
  }
  return { approval: "touchid", insecureKey: null };
};

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): McpConfig => {
  const network = parseNetwork(env);
  return {
    account: parseAccount(env),
    ...parseApproval(env),
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
