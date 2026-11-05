/**
 * Pricing one market request before it runs. x402's `exact` scheme needs the amount up
 * front, but nobody knows how long an answer will be, so the buyer pays for the prompt
 * (estimated, with headroom) plus the full `max_tokens` they asked for at the seller's
 * prices. The gateway enforces that cap on the node, so the answer can never cost more
 * than was paid. Pure functions.
 */
import { priceUsage } from "@rentanllm/core";
import type { Micros, TokenPrices } from "@rentanllm/core";
import { Effect } from "effect";

import { InvalidRequest } from "../errors.ts";
import { estimateInputTokens } from "../token-estimate.ts";

/** Headroom on the ~4 chars/token prompt estimate, since tokenizers differ (percent). */
const INPUT_HEADROOM_PCT = 125;
const PERCENT = 100;
/** Chat templates add a few tokens of framing around every message. */
const TOKENS_PER_MESSAGE = 8;
/** x402 cannot carry a zero amount, so the cheapest request costs one micro-USDC. */
const MIN_PRICE_MICROS = 1n;

export interface ChatBody {
  /** The body as sent, minus nothing; re-encoded with the enforced max_tokens. */
  readonly json: Record<string, unknown>;
  /** The output cap the price covers (the buyer's, or the market default). */
  readonly maxTokens: number;
  readonly messages: readonly unknown[];
  readonly model: string;
  readonly stream: boolean;
}

export interface ChatLimits {
  readonly defaultMaxTokens: number;
  readonly maxTokensCeiling: number;
}

const isPositiveInt = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1;

/** Reads the parts of an OpenAI chat-completions body the market prices and routes on. */
export const parseChatBody = (raw: string, limits: ChatLimits) =>
  Effect.gen(function* parseChat() {
    let json: unknown = null;
    try {
      json = JSON.parse(raw);
    } catch {
      return yield* new InvalidRequest({
        message: "Request body is not valid JSON.",
      });
    }
    if (typeof json !== "object" || json === null || Array.isArray(json)) {
      return yield* new InvalidRequest({
        message: "Request body must be a JSON object.",
      });
    }
    const body = json as Record<string, unknown>;
    if (typeof body.model !== "string" || body.model.length === 0) {
      return yield* new InvalidRequest({ message: "model: field required" });
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return yield* new InvalidRequest({
        message: "messages: must be a non-empty array",
      });
    }
    const asked = body.max_completion_tokens ?? body.max_tokens;
    if (asked !== undefined && !isPositiveInt(asked)) {
      return yield* new InvalidRequest({
        message: "max_tokens: must be a positive integer",
      });
    }
    const maxTokens = asked ?? limits.defaultMaxTokens;
    if (maxTokens > limits.maxTokensCeiling) {
      return yield* new InvalidRequest({
        message: `max_tokens: at most ${limits.maxTokensCeiling} on this market`,
      });
    }
    return {
      json: body,
      maxTokens,
      messages: body.messages,
      model: body.model,
      stream: body.stream === true,
    } satisfies ChatBody;
  });

/** Prompt tokens the quote assumes: the rough estimate plus headroom and framing. */
export const quotedInputTokens = (messages: readonly unknown[]): number =>
  Math.ceil((estimateInputTokens(messages) * INPUT_HEADROOM_PCT) / PERCENT) +
  messages.length * TOKENS_PER_MESSAGE;

/** The price of one request: quoted prompt plus the full output cap, never zero. */
export const quotePrice = (
  prices: TokenPrices,
  inputTokens: number,
  maxTokens: number
): Micros => {
  const price = priceUsage(
    {
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      inputTokens,
      outputTokens: maxTokens,
    },
    prices
  );
  return price < MIN_PRICE_MICROS ? MIN_PRICE_MICROS : price;
};

/** The body forwarded to the node: the buyer's, with the paid-for cap enforced. */
export const withEnforcedCap = (body: ChatBody): string => {
  const { max_completion_tokens: _dropped, ...rest } = body.json;
  return JSON.stringify({ ...rest, max_tokens: body.maxTokens });
};
