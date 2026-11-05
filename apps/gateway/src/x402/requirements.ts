/** Checks a payer's x402 v2 payload against the terms it claims to pay. Pure. */
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";

export const X402_VERSION = 2;

const sameAddress = (a: string, b: string) =>
  a.toLowerCase() === b.toLowerCase();

/** Why `payload` does not pay `requirements`, or null when it matches. */
export const mismatch = (
  payload: PaymentPayload,
  requirements: PaymentRequirements
): string | null => {
  if (payload.x402Version !== X402_VERSION) {
    return `unsupported x402Version ${String(payload.x402Version)} (expected ${X402_VERSION})`;
  }
  const { accepted } = payload;
  if (accepted.scheme !== requirements.scheme) {
    return `scheme must be "${requirements.scheme}"`;
  }
  if (accepted.network !== requirements.network) {
    return `network must be ${requirements.network}`;
  }
  if (!sameAddress(accepted.asset, requirements.asset)) {
    return `asset must be ${requirements.asset}`;
  }
  if (!sameAddress(accepted.payTo, requirements.payTo)) {
    return `payTo must be ${requirements.payTo}`;
  }
  if (accepted.amount !== requirements.amount) {
    return `amount must be ${requirements.amount}`;
  }
  return null;
};
