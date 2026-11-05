/**
 * Signs one x402 payment. The private key is fetched only after the person approves this
 * exact payment (Touch ID through the signer helper), used once to sign, and dropped.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { x402Client } from "@x402/core/client";
import type { PaymentPayload } from "@x402/core/types";
import { createClientHederaSigner, PrivateKey } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";

import { keychainAccount } from "./config.ts";
import type { McpConfig } from "./config.ts";
import type { Quote } from "./market.ts";

const run = promisify(execFile);
/** Long enough for a person to reach the sensor. */
const APPROVAL_TIMEOUT_MS = 120_000;
const EXIT_NOT_APPROVED = 2;
const EXIT_NO_KEY = 3;

/** `not_approved`: the person denied (or ignored) the prompt; `setup`: anything else. */
export class PayerError extends Error {
  override readonly name = "PayerError";
  readonly kind: "not_approved" | "setup";

  constructor(kind: "not_approved" | "setup", message: string) {
    super(message);
    this.kind = kind;
  }
}

const exitCode = (error: unknown): number | null =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  typeof error.code === "number"
    ? error.code
    : null;

/**
 * Shows the system approval prompt with `reason` and returns the key once the person
 * approves; throws a `not_approved` PayerError when they deny or let it time out.
 */
export const approvedKey = async (
  config: McpConfig,
  reason: string
): Promise<string> => {
  if (config.approval === "none") {
    if (config.insecureKey === null) {
      throw new PayerError("setup", "no development key configured");
    }
    return config.insecureKey;
  }
  try {
    const { stdout } = await run(
      config.signerPath,
      ["approve", keychainAccount(config), reason],
      { timeout: APPROVAL_TIMEOUT_MS }
    );
    return stdout.trim();
  } catch (error) {
    const code = exitCode(error);
    if (code === EXIT_NOT_APPROVED) {
      throw new PayerError("not_approved", "the payment was not approved");
    }
    if (code === EXIT_NO_KEY) {
      throw new PayerError(
        "setup",
        "no payer key is stored yet: run `rentanllm-mcp store-key` once"
      );
    }
    throw new PayerError(
      "setup",
      `the approval helper failed (${String(error)}); build it with \`bun run build:signer\``
    );
  }
};

const clientFor = (config: McpConfig, key: string): x402Client => {
  const client = new x402Client();
  // The MCP server enforces its own caps before asking for approval.
  client.setSpendControls(false);
  const signer = createClientHederaSigner(
    config.account,
    PrivateKey.fromStringECDSA(key),
    { network: config.network }
  );
  return client.register(config.network, new ExactHederaScheme(signer));
};

/** Signs exactly the quoted terms with the approved key. */
export const signPayment = async (
  config: McpConfig,
  key: string,
  quote: Quote
): Promise<PaymentPayload> =>
  await clientFor(config, key).createPaymentPayload({
    ...quote.paymentRequired,
    accepts: [quote.terms],
  });
