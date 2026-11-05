/**
 * A fake x402 facilitator and payer for tests. No chain, no keys: a payment is "valid"
 * when its signature is VALID_SIGNATURE, and settling it returns a transaction hash
 * derived from the authorization nonce (so the same payment always settles to the same
 * hash, like a real one can only settle once).
 */
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { Effect, Layer } from "effect";

import { X402Facilitator } from "../src/x402/facilitator.ts";

export const VALID_SIGNATURE = "0xfeedface";
export const FAKE_HEDERA_FEE_PAYER = "0.0.9185802";
const SETTLE_DELAY_MS = 30;

export interface FakeFacilitator {
  readonly calls: { settle: number; verify: number };
  readonly layer: Layer.Layer<X402Facilitator>;
}

const signatureOf = (payload: Record<string, unknown>) =>
  typeof payload.signature === "string" ? payload.signature : "";

const nonceOf = (payload: Record<string, unknown>) => {
  const auth = payload.authorization;
  return typeof auth === "object" && auth !== null && "nonce" in auth
    ? String(auth.nonce)
    : "";
};

export const fakeTxHash = (nonce: string) =>
  `0x${createHash("sha256").update(nonce).digest("hex")}`;

export const makeFakeFacilitator = (): FakeFacilitator => {
  const calls = { settle: 0, verify: 0 };
  const layer = Layer.succeed(X402Facilitator)({
    settle: (payload, requirements) =>
      Effect.promise(async () => {
        calls.settle += 1;
        await sleep(SETTLE_DELAY_MS);
        return {
          amount: requirements.amount,
          network: requirements.network,
          payer: "0x00000000000000000000000000000000000000aa",
          success: true,
          transaction: fakeTxHash(nonceOf(payload.payload)),
        };
      }),
    supportedExtra: (network) =>
      Effect.succeed(
        network === "hedera:testnet" ? { feePayer: FAKE_HEDERA_FEE_PAYER } : {}
      ),
    verify: (payload) =>
      Effect.sync(() => {
        calls.verify += 1;
        return signatureOf(payload.payload) === VALID_SIGNATURE
          ? { isValid: true }
          : {
              invalidReason: "invalid_exact_evm_payload_signature",
              isValid: false,
            };
      }),
  });
  return { calls, layer };
};

/** What a payer would send back after a 402: the PAYMENT-SIGNATURE header value. */
export const payFor = (
  requirements: PaymentRequirements,
  nonce: string,
  signature = VALID_SIGNATURE
): string =>
  encodePaymentSignatureHeader({
    accepted: requirements,
    payload: {
      authorization: {
        from: "0x00000000000000000000000000000000000000aa",
        nonce,
        to: requirements.payTo,
        validAfter: "0",
        validBefore: "9999999999",
        value: requirements.amount,
      },
      signature,
    },
    x402Version: 2,
  });

/** Decodes the PAYMENT-REQUIRED header of a 402 response. */
export const paymentRequiredOf = (response: Response): PaymentRequired => {
  const header = response.headers.get("payment-required");
  if (header === null) {
    throw new Error("402 without a PAYMENT-REQUIRED header");
  }
  return JSON.parse(
    Buffer.from(header, "base64").toString("utf-8")
  ) as PaymentRequired;
};
