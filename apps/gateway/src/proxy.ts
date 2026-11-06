/**
 * Forwards one admitted request over the owner's tunnel and streams the node's response
 * back chunk by chunk. How a finished request is recorded (a booking's usage and credit, or
 * a paid market request) is the caller's `record`, run exactly once when the request ends:
 * completed, failed, or the caller went away.
 */
import type { Provider, ProviderUsage } from "@rentanllm/protocol";
import { Clock, Effect, Queue, Stream } from "effect";
import { HttpServerResponse } from "effect/http";

import { Settings } from "./config.ts";
import type { UsageStatus } from "./domain.ts";
import { errorBody, UpstreamFailed } from "./errors.ts";
import { renterResponseHeaders } from "./headers.ts";
import { makeJsonTokenCounter, makeSseTokenCounter } from "./token-estimate.ts";
import { TunnelHub } from "./tunnel/tunnel-hub.ts";
import type { NodeEvent } from "./tunnel/tunnel-hub.ts";

type NodeErrorCode = Extract<NodeEvent, { _tag: "ResponseError" }>["code"];

/** How a node-side failure before any byte was sent looks to the caller. */
const upstreamFailure = (code: NodeErrorCode, message: string) => {
  switch (code) {
    case "provider_rate_limited":
    case "cutoff_reached": {
      return new UpstreamFailed({
        errorType: "rate_limit_error",
        message,
        status: 429,
      });
    }
    case "meters_unreadable":
    case "node_closed": {
      return new UpstreamFailed({
        errorType: "overloaded_error",
        message,
        status: 503,
      });
    }
    case "not_allowed": {
      return new UpstreamFailed({
        errorType: "permission_error",
        message,
        status: 403,
      });
    }
    default: {
      return new UpstreamFailed({
        errorType: "api_error",
        message,
        status: 502,
      });
    }
  }
};

const sseErrorEvent = (code: NodeErrorCode, message: string) => {
  const type =
    code === "provider_rate_limited" || code === "cutoff_reached"
      ? "rate_limit_error"
      : "api_error";
  return `event: error\ndata: ${JSON.stringify(errorBody(type, message))}\n\n`;
};

/**
 * A stream cut off by the caller reports output tokens only up to the provider's last
 * usage event (Anthropic sends output_tokens in message_start and again only at the end),
 * so for a cancel count at least the output the gateway counted itself.
 */
const cancelledOutputFloor = (
  usage: ProviderUsage | null,
  status: UsageStatus,
  estimate: number
): ProviderUsage | null =>
  usage !== null && status === "cancelled" && estimate > usage.outputTokens
    ? { ...usage, outputTokens: estimate }
    : usage;

/** How one proxied request ended, handed to the caller's `record`. */
export interface Finished {
  /** Output tokens the gateway counted from the response body (rough). */
  readonly estimate: number;
  readonly finishedAt: Date;
  /** HTTP status the caller saw. */
  readonly httpStatus: number;
  readonly status: UsageStatus;
  /** Milliseconds from dispatch until the first response byte; null if none arrived. */
  readonly ttfbMs: number | null;
  readonly totalLatencyMs: number;
  /** Provider usage (possibly partial; floored by the estimate on a cancel), or null. */
  readonly usage: ProviderUsage | null;
}

export interface ProxyCall {
  /** Booking id, or for a market request the listing id. Routing and logs only. */
  readonly bookingId: string;
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly nodeId: string;
  readonly path: string;
  readonly provider: Provider;
  /**
   * Runs once the node has answered with a status, before any of the body is sent. Its
   * headers join the response; failing it fails the request and cancels it on the node.
   * The market settles the buyer's payment here, so a node that fails first costs nothing.
   */
  readonly onHead?: (
    status: number
  ) => Effect.Effect<Readonly<Record<string, string>>, UpstreamFailed>;
  readonly record: (finished: Finished) => Effect.Effect<void>;
  readonly requestId: string;
  /** Extra headers on the response (payment receipts, ids). */
  readonly responseHeaders: Readonly<Record<string, string>>;
  readonly stream: boolean;
}

/** Mutable per-request bookkeeping shared by the body stream and the finalizer. */
interface Flight {
  /** Usage the node reported after a cancel; set once the request was dispatched. */
  cancelledUsage: () => ProviderUsage | null;
  firstByteAtMs: number | null;
  finalized: boolean;
  httpStatus: number;
  outcome: UsageStatus | null;
  usage: ProviderUsage | null;
}

/**
 * Dispatches `call` and returns the streaming response. Needs a request scope: the
 * finalizer that records a cancelled request runs when it closes.
 */
export const proxyToNode = (call: ProxyCall) =>
  Effect.gen(function* proxy() {
    const settings = yield* Settings;
    const hub = yield* TunnelHub;
    const flight: Flight = {
      cancelledUsage: () => null,
      finalized: false,
      firstByteAtMs: null,
      httpStatus: 502,
      outcome: null,
      usage: null,
    };
    const counter = call.stream
      ? makeSseTokenCounter()
      : makeJsonTokenCounter();
    const dispatchedAtMs = yield* Clock.currentTimeMillis;

    const finish = (fallback: UsageStatus) =>
      Effect.gen(function* finishRequest() {
        if (flight.finalized) {
          return;
        }
        flight.finalized = true;
        const status = flight.outcome ?? fallback;
        const estimate = counter.estimate();
        // On a cancel the node's partial usage arrives after the cancel (the dispatch
        // finalizer, which runs before this one, waits for it).
        const usage = cancelledOutputFloor(
          flight.usage ??
            (flight.outcome === null ? flight.cancelledUsage() : null),
          status,
          estimate
        );
        const nowMs = yield* Clock.currentTimeMillis;
        yield* call.record({
          estimate,
          finishedAt: new Date(nowMs),
          httpStatus: flight.httpStatus,
          status,
          totalLatencyMs: nowMs - dispatchedAtMs,
          ttfbMs:
            flight.firstByteAtMs === null
              ? null
              : flight.firstByteAtMs - dispatchedAtMs,
          usage,
        });
      }).pipe(Effect.uninterruptible);

    // Runs when the request scope closes: after the body is fully sent, or when the
    // caller disconnects (then the outcome is still unset, so it counts as cancelled).
    yield* Effect.addFinalizer(() => finish("cancelled"));

    const { cancelledUsage, events } = yield* hub.dispatch(call.nodeId, {
      body: call.body,
      bookingId: call.bookingId,
      headers: call.headers,
      method: "POST",
      path: call.path,
      provider: call.provider,
      requestId: call.requestId,
    });
    flight.cancelledUsage = cancelledUsage;

    const first = yield* Queue.take(events).pipe(
      Effect.timeoutOrElse({
        duration: settings.headTimeoutMs,
        orElse: () =>
          Effect.fail(
            new UpstreamFailed({
              errorType: "api_error",
              message: "The owner's node did not respond in time.",
              status: 504,
            })
          ),
      }),
      Effect.catchTag("Done", () =>
        Effect.fail(
          new UpstreamFailed({
            errorType: "api_error",
            message: "The owner's node closed the request.",
            status: 502,
          })
        )
      ),
      Effect.tapError((error) =>
        Effect.sync(() => {
          flight.outcome = "error";
          flight.httpStatus = error.status;
        })
      )
    );
    if (first._tag !== "ResponseHead") {
      flight.outcome = "error";
      if (first._tag === "ResponseError") {
        // Count whatever the provider used before failing.
        flight.usage = first.usage ?? null;
      }
      const failure =
        first._tag === "ResponseError"
          ? upstreamFailure(first.code, first.message)
          : new UpstreamFailed({
              errorType: "api_error",
              message: "The owner's node sent an invalid response.",
              status: 502,
            });
      flight.httpStatus = failure.status;
      return yield* failure;
    }

    flight.httpStatus = first.status;
    const headHeaders =
      call.onHead === undefined
        ? {}
        : yield* call.onHead(first.status).pipe(
            Effect.tapError((error) =>
              Effect.sync(() => {
                flight.outcome = "error";
                flight.httpStatus = error.status;
              })
            )
          );
    const isSse = (first.headers["content-type"] ?? "").includes(
      "text/event-stream"
    );
    const toText = (event: NodeEvent): Effect.Effect<string> =>
      Effect.gen(function* eventToText() {
        switch (event._tag) {
          case "ResponseChunk": {
            if (flight.firstByteAtMs === null) {
              flight.firstByteAtMs = yield* Clock.currentTimeMillis;
            }
            counter.feed(event.data);
            return event.data;
          }
          case "ResponseEnd": {
            flight.usage = event.usage;
            flight.outcome = first.status < 400 ? "ok" : "error";
            return "";
          }
          case "ResponseError": {
            flight.outcome = "error";
            // Count what the provider reported before the stream broke off.
            flight.usage = event.usage ?? flight.usage;
            yield* Effect.logWarning("node failed mid-response").pipe(
              Effect.annotateLogs({ code: event.code })
            );
            return isSse ? sseErrorEvent(event.code, event.message) : "";
          }
          default: {
            return "";
          }
        }
      });

    const responseBody = Stream.fromQueue(events).pipe(
      Stream.mapEffect(toText),
      Stream.filter((text) => text.length > 0),
      Stream.encodeText,
      // Record before the response ends, so a caller that reads to the end always
      // sees its usage applied.
      Stream.onEnd(finish("error"))
    );

    return HttpServerResponse.stream(responseBody, {
      headers: {
        ...renterResponseHeaders(first.headers),
        ...call.responseHeaders,
        ...headHeaders,
        "cache-control": "no-cache",
        "x-rentanllm-request-id": call.requestId,
      },
      status: first.status,
    });
  });
