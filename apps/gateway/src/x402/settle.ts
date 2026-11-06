/**
 * Turns an x402 payment header into a settled payment against one set of terms: decode,
 * check it pays exactly `requirements`, verify, settle. Shared by booking top-ups and
 * pay-per-request market calls; callers decide what the money is for.
 */
import { decodePaymentSignatureHeader } from "@x402/core/http";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
} from "@x402/core/types";
import { Effect, Predicate } from "effect";

import { X402Facilitator } from "./facilitator.ts";
import { PaymentRejected } from "./payment-rejected.ts";
import { mismatch } from "./requirements.ts";

export interface Settlement {
  /** Payer as the facilitator reported it; null when it did not say. */
  readonly payer: string | null;
  readonly settle: SettleResponse;
  /** Transaction hash (lowercased) or Hedera transaction id. */
  readonly transaction: string;
}

export const decodePaymentHeader = (header: string) =>
  Effect.try({
    catch: () =>
      new PaymentRejected({
        reason: "payment header is not valid base64 JSON",
      }),
    try: () => decodePaymentSignatureHeader(header),
  }).pipe(
    Effect.filterOrFail(
      (payload): payload is PaymentPayload =>
        Predicate.isObject(payload) &&
        Predicate.isObject(payload.accepted) &&
        Predicate.isObject(payload.payload),
      () =>
        new PaymentRejected({
          reason: "payment header is not an x402 v2 PaymentPayload",
        })
    )
  );

/** EVM hashes are case-insensitive; Hedera transaction ids are not hex and stay as given. */
const normalizeTransaction = (network: string, transaction: string) =>
  network.startsWith("eip155:") ? transaction.toLowerCase() : transaction;

/**
 * Runs after the facilitator verifies a payment and before it settles, with the payer it
 * reported. Failing it refuses the payment; nothing has moved yet.
 */
export type BeforeSettle<E> = (
  payer: string | null
) => Effect.Effect<void, PaymentRejected | E>;

/**
 * Checks a payment without moving money: it pays exactly `requirements`, the facilitator
 * says it is valid, and `beforeSettle` accepts the payer. Returns the payer it reported.
 */
export const verifyAgainst = <E = never>(
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  beforeSettle?: BeforeSettle<E>
) =>
  Effect.gen(function* verifyPayment() {
    const facilitator = yield* X402Facilitator;
    const wrong = mismatch(payload, requirements);
    if (wrong !== null) {
      return yield* new PaymentRejected({ reason: wrong });
    }
    const verified = yield* facilitator.verify(payload, requirements);
    if (!verified.isValid) {
      return yield* new PaymentRejected({
        reason: verified.invalidMessage ?? verified.invalidReason ?? "invalid",
      });
    }
    const payer = verified.payer ?? null;
    if (beforeSettle !== undefined) {
      yield* beforeSettle(payer);
    }
    return { payer };
  }).pipe(Effect.withSpan("x402.verify"));

/** Settles a payment `verifyAgainst` already accepted: this is when the money moves. */
export const settleVerified = (
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  verifiedPayer: string | null
) =>
  Effect.gen(function* settleVerifiedPayment() {
    const facilitator = yield* X402Facilitator;
    const settled = yield* facilitator.settle(payload, requirements);
    if (!settled.success || settled.transaction.length === 0) {
      return yield* new PaymentRejected({
        reason: `settlement failed: ${settled.errorMessage ?? settled.errorReason ?? "unknown"}`,
      });
    }
    const payer = settled.payer ?? verifiedPayer;
    yield* Effect.logInfo("x402 payment settled").pipe(
      Effect.annotateLogs({
        network: settled.network,
        payer: payer ?? "unknown",
        tx: settled.transaction,
      })
    );
    return {
      payer,
      settle: settled,
      transaction: normalizeTransaction(
        requirements.network,
        settled.transaction
      ),
    } satisfies Settlement;
  }).pipe(Effect.withSpan("x402.settle"));

/** Verify, then settle at once: for payments that buy nothing that can fail afterwards. */
export const settleAgainst = <E = never>(
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  beforeSettle?: BeforeSettle<E>
) =>
  verifyAgainst(payload, requirements, beforeSettle).pipe(
    Effect.flatMap(({ payer }) => settleVerified(payload, requirements, payer))
  );
