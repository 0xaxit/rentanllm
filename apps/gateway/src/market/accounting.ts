/**
 * What a finished market request used, for its paid_requests row, logs and metrics.
 * The price was settled before the request ran; this only measures what was used.
 */
import { priceUsage } from "@rentanllm/core";
import type { Micros, TokenPrices } from "@rentanllm/core";
import type { ProviderUsage } from "@rentanllm/protocol";
import { Effect, Metric } from "effect";
import type { HttpServerRequest } from "effect/http";

import type { UsageStatus } from "../domain.ts";
import { InvalidRequest } from "../errors.ts";
import {
  costMicrosTotal,
  countRequest,
  countTokens,
  requestDurationMs,
} from "../metrics.ts";
import type { Finished } from "../proxy.ts";
import { isLargeMismatch } from "../token-estimate.ts";

/**
 * What the usage cost at the listing's prices: the provider's (possibly partial) usage
 * when it arrived; for a cancel with no usage at all, the gateway's own output estimate.
 */
export const costOf = (
  prices: TokenPrices,
  usage: ProviderUsage | null,
  status: UsageStatus,
  estimate: number
): Micros => {
  if (usage !== null) {
    return priceUsage(usage, prices);
  }
  if (status === "cancelled") {
    return priceUsage(
      { cacheReadTokens: 0, inputTokens: 0, outputTokens: estimate },
      prices
    );
  }
  return 0n;
};

/** Counts one finished request: status, duration, what was paid and the tokens. */
export const countFinished = (finished: Finished, paidMicros: Micros) =>
  Effect.gen(function* countFinishedRequest() {
    yield* countRequest(finished.httpStatus, finished.status);
    yield* Metric.update(requestDurationMs, finished.totalLatencyMs);
    yield* Metric.update(costMicrosTotal, Number(paidMicros));
    const { usage } = finished;
    if (usage !== null) {
      yield* countTokens("input", usage.inputTokens);
      yield* countTokens("output", usage.outputTokens);
      yield* countTokens("cache_read", usage.cacheReadTokens);
      yield* countTokens("cache_write", usage.cacheWriteTokens);
    }
  });

/** Logs when the provider's output count is far from what the gateway counted itself. */
export const warnOnTokenMismatch = (finished: Finished): Effect.Effect<void> =>
  finished.usage !== null &&
  isLargeMismatch(finished.usage.outputTokens, finished.estimate)
    ? Effect.logWarning("output token mismatch").pipe(
        Effect.annotateLogs({
          gateway_estimate_tokens: finished.estimate,
          provider_output_tokens: finished.usage.outputTokens,
        })
      )
    : Effect.void;

export const readBody = (request: HttpServerRequest.HttpServerRequest) =>
  request.text.pipe(
    Effect.catchTag("HttpServerError", () =>
      Effect.fail(
        new InvalidRequest({ message: "Could not read request body." })
      )
    )
  );
