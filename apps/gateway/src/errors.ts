/* oxlint-disable max-classes-per-file -- one Data.TaggedError class per failure is the Effect idiom */
/**
 * Typed failures of the market API. Each maps to one HTTP status and an
 * Anthropic-style error body: `{"type":"error","error":{"type":"...","message":"..."}}`.
 */
import { formatUsdc } from "@rentanllm/core";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired as X402PaymentRequired } from "@x402/core/types";
import { Data } from "effect";
import { HttpServerResponse } from "effect/http";

const MS_PER_SECOND = 1000;

/**
 * 402 on the market route: the request has a price and must be paid before it runs.
 * `x402` lists the online sellers' terms; `message` says why (no payment yet, or why the
 * payment sent did not count).
 */
export class PaymentDue extends Data.TaggedError("PaymentDue")<{
  readonly message: string;
  readonly x402: X402PaymentRequired;
}> {}

/** 404: nothing on the market sells the requested model. */
export class NotFound extends Data.TaggedError("NotFound")<{
  readonly message: string;
}> {}

/** 429: the seller's concurrency limit is used up. */
export class RateLimited extends Data.TaggedError("RateLimited")<{
  readonly message: string;
  /** When the caller may retry; null when unknown. */
  readonly resetAt: Date | null;
  readonly retryAfterMs: number | null;
}> {}

/** 503: the owner's node is offline or its meters cannot be trusted. */
export class NodeUnavailable extends Data.TaggedError("NodeUnavailable")<{
  readonly message: string;
}> {}

/** 400: malformed request body. */
export class InvalidRequest extends Data.TaggedError("InvalidRequest")<{
  readonly message: string;
}> {}

/** Upstream (node or provider) failure before any response byte was sent. */
export class UpstreamFailed extends Data.TaggedError("UpstreamFailed")<{
  readonly errorType: string;
  readonly message: string;
  readonly status: number;
}> {}

export type GatewayError =
  | RateLimited
  | NodeUnavailable
  | InvalidRequest
  | NotFound
  | PaymentDue
  | UpstreamFailed;

export const errorBody = (type: string, message: string) => ({
  error: { message, type },
  type: "error" as const,
});

const json = (
  status: number,
  type: string,
  message: string,
  headers: Record<string, string> = {}
) =>
  HttpServerResponse.jsonUnsafe(errorBody(type, message), { headers, status });

const rateLimitHeaders = (error: RateLimited): Record<string, string> => {
  const headers: Record<string, string> = {};
  if (error.retryAfterMs !== null) {
    headers["retry-after"] = String(
      Math.max(1, Math.ceil(error.retryAfterMs / MS_PER_SECOND))
    );
  }
  if (error.resetAt !== null) {
    headers["x-rentanllm-reset-at"] = error.resetAt.toISOString();
  }
  return headers;
};

/**
 * A 402 offering x402 terms. The body stays an Anthropic error (its `error` is an
 * object), plus the x402 fields clients look for (`x402Version`, `resource`, `accepts`);
 * the full x402 PaymentRequired (with its `error` string) is base64 JSON in the
 * PAYMENT-REQUIRED header.
 */
export const x402Response = (prefix: string, x402: X402PaymentRequired) => {
  const [terms] = x402.accepts;
  const amount =
    terms === undefined ? "" : ` of ${formatUsdc(BigInt(terms.amount))} USDC`;
  const { error: _reason, ...x402Fields } = x402;
  return HttpServerResponse.jsonUnsafe(
    {
      ...errorBody(
        "billing_error",
        `${prefix} Pay the x402 price${amount} (see "accepts"), then retry with the PAYMENT-SIGNATURE (or X-PAYMENT) header.`
      ),
      ...x402Fields,
    },
    {
      headers: {
        "cache-control": "no-store",
        "payment-required": encodePaymentRequiredHeader(x402),
      },
      status: 402,
    }
  );
};

export const toErrorResponse = (
  error: GatewayError
): HttpServerResponse.HttpServerResponse => {
  switch (error._tag) {
    case "RateLimited": {
      return json(
        429,
        "rate_limit_error",
        error.message,
        rateLimitHeaders(error)
      );
    }
    case "NodeUnavailable": {
      return json(503, "overloaded_error", error.message);
    }
    case "InvalidRequest": {
      return json(400, "invalid_request_error", error.message);
    }
    case "NotFound": {
      return json(404, "not_found_error", error.message);
    }
    case "PaymentDue": {
      return x402Response(error.message, error.x402);
    }
    case "UpstreamFailed": {
      return json(error.status, error.errorType, error.message);
    }
    default: {
      return json(500, "api_error", "Internal error");
    }
  }
};
