/**
 * Buying one inference request, in order:
 *
 *   quote (the gateway's 402) -> caps (per request, per day, the caller's own limit)
 *   -> the person approves this exact payment -> sign -> paid call -> log the spend
 *
 * Nothing is signed until every cap passes and the person has approved; a refusal at any
 * step costs nothing. The parts that touch the network or the person are passed in, so the
 * order of steps can be tested on its own.
 */
import type { PaymentPayload } from "@x402/core/types";

import { formatUsdc } from "./config.ts";
import type { ChatRequest, PaidAnswer, Quote } from "./market.ts";
import type { Caps, SpendEntry } from "./spend.ts";
import { capRefusal, spentLastDay } from "./spend.ts";

export interface BuyParts {
  /** Returns the key once this payment may go ahead; throws to stop it. */
  readonly approve: (reason: string, quote: Quote) => Promise<string>;
  readonly call: (payment: PaymentPayload) => Promise<PaidAnswer>;
  readonly caps: Caps;
  readonly log: (entry: SpendEntry) => void;
  readonly now: () => Date;
  readonly quote: () => Promise<Quote>;
  readonly sign: (key: string, quote: Quote) => Promise<PaymentPayload>;
  readonly spends: () => readonly SpendEntry[];
}

export type BuyResult =
  | {
      readonly kind: "paid";
      readonly answer: PaidAnswer;
      readonly paidMicros: bigint;
      readonly payTo: string;
      readonly spentTodayMicros: bigint;
    }
  | { readonly kind: "refused"; readonly reason: string };

const NETWORK_NAMES: Readonly<Record<string, string>> = {
  "hedera:testnet": "Hedera testnet",
};

/** What the approval prompt says: amount, recipient, network, purpose, today's spend. */
export const approvalReason = (
  quote: Quote,
  request: ChatRequest,
  spentMicros: bigint,
  caps: Caps
): string => {
  const { terms } = quote;
  const network = NETWORK_NAMES[terms.network] ?? terms.network;
  return [
    `pay ${formatUsdc(BigInt(terms.amount))} USDC to ${terms.payTo} on ${network}`,
    `for one ${request.model} answer of up to ${request.maxTokens} tokens.`,
    `Spent in the last 24h: ${formatUsdc(spentMicros)} of ${formatUsdc(caps.maxPerDayMicros)} USDC.`,
  ].join(" ");
};

export const buyInference = async (
  parts: BuyParts,
  request: ChatRequest,
  maxPriceMicros: bigint | null
): Promise<BuyResult> => {
  const quote = await parts.quote();
  const amount = BigInt(quote.terms.amount);
  const spent = spentLastDay(parts.spends(), parts.now());
  const refusal = capRefusal(amount, parts.caps, spent, maxPriceMicros);
  if (refusal !== null) {
    return { kind: "refused", reason: refusal };
  }
  const key = await parts.approve(
    approvalReason(quote, request, spent, parts.caps),
    quote
  );
  const payment = await parts.sign(key, quote);
  const answer = await parts.call(payment);
  parts.log({
    amountMicros: amount,
    at: parts.now(),
    model: request.model,
    network: quote.terms.network,
    payTo: quote.terms.payTo,
    requestId: answer.requestId,
    tx: answer.tx,
  });
  return {
    answer,
    kind: "paid",
    paidMicros: amount,
    payTo: quote.terms.payTo,
    spentTodayMicros: spent + amount,
  };
};
