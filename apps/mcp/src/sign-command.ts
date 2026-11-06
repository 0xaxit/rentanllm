/**
 * `rentanllm-mcp sign-payment <PAYMENT-REQUIRED header>`: signs one x402 payment by hand,
 * for testing the gateway with curl. Prints the PAYMENT-SIGNATURE header value on stdout;
 * what is being paid goes to stderr.
 *
 * It signs the cheapest terms on our network, refuses anything above the per-request
 * cap, and gets the key the configured way (Touch ID asks first).
 */
import { readFileSync } from "node:fs";

import {
  decodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";

import { ConfigError, formatUsdc } from "./config.ts";
import type { McpConfig } from "./config.ts";
import { MarketError } from "./market.ts";
import type { Quote } from "./market.ts";
import { approvedKey, signPayment } from "./payer.ts";

const readHeader = (argv: readonly string[]): string => {
  const [arg] = argv;
  const raw = arg === undefined || arg === "-" ? readFileSync(0, "utf-8") : arg;
  // Accept the whole header line as copied from `curl -i`, too.
  return raw.trim().replace(/^payment-required:\s*/iu, "");
};

export const runSignPayment = async (
  config: McpConfig,
  argv: readonly string[]
): Promise<void> => {
  const header = readHeader(argv);
  if (header.length === 0) {
    throw new ConfigError(
      "usage: rentanllm-mcp sign-payment <payment-required header value>"
    );
  }
  const paymentRequired = decodePaymentRequiredHeader(header);
  const [terms] = paymentRequired.accepts
    .filter((t) => t.network === config.network)
    .toSorted((a, b) => (BigInt(a.amount) < BigInt(b.amount) ? -1 : 1));
  if (terms === undefined) {
    throw new MarketError(
      `nothing in this 402 can be paid on ${config.network}`
    );
  }
  const amount = BigInt(terms.amount);
  if (amount > config.maxPerRequestMicros) {
    throw new MarketError(
      `${formatUsdc(amount)} USDC is above the ${formatUsdc(config.maxPerRequestMicros)} USDC per-request cap`
    );
  }
  const reason = `sign ${formatUsdc(amount)} USDC to ${terms.payTo} on Hedera testnet (manual test)`;
  process.stderr.write(`${reason}, from ${config.account}\n`);
  const quote: Quote = { paymentRequired, terms };
  const key = await approvedKey(config, reason);
  const payment = await signPayment(config, key, quote);
  process.stdout.write(`${encodePaymentSignatureHeader(payment)}\n`);
};
