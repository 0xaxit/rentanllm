/**
 * Handles one ProxyRequest: allowlist + fail-closed gate, upstream call with the owner's
 * credential, chunk-by-chunk passthrough, usage extraction, 429 circuit breaker.
 */
import { ALLOWED_PATHS } from "@rentanllm/protocol";
import type { NodeToGateway, Provider } from "@rentanllm/protocol";
import { Effect, Ref, Stream } from "effect";

import { evaluateAdmission } from "./admission.ts";
import type { Refusal } from "./admission.ts";
import { NodeConfig } from "./config.ts";
import { CredentialStore } from "./credentials.ts";
import { MeterReader } from "./meters.ts";
import type { ProxyRequestMessage, UsageTracker } from "./providers/adapter.ts";
import { Providers } from "./providers/registry.ts";
import { NodeState, tripCircuit } from "./state.ts";
import { UpstreamHttp } from "./upstream.ts";

const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;

export type Send = (message: NodeToGateway) => Effect.Effect<void>;

/** Static checks that need no state: provider served, POST only, path on the allowlist. */
export const checkRequestShape = (
  request: ProxyRequestMessage,
  served: ReadonlySet<Provider>
): Refusal | null => {
  if (!served.has(request.provider)) {
    return {
      code: "not_allowed",
      message: `provider ${request.provider} is not served by this node`,
    };
  }
  if (request.method !== "POST") {
    return { code: "not_allowed", message: "only POST is allowed" };
  }
  if (!ALLOWED_PATHS[request.provider].includes(request.path)) {
    return {
      code: "not_allowed",
      message: `path ${request.path} is not allowed`,
    };
  }
  return null;
};

const refuse = (send: Send, requestId: string, refusal: Refusal) =>
  send({
    _tag: "ResponseError",
    code: refusal.code,
    message: refusal.message,
    requestId,
  });

/** The usage tracker of a request whose response is streaming; read if it is cut off. */
export interface RequestProgress {
  tracker: UsageTracker | null;
}

/** Usage seen so far, for a request that ends early (cancel or failure mid-stream). */
const usageSoFar = (progress: RequestProgress) => {
  const usage = progress.tracker?.finish() ?? null;
  progress.tracker = null;
  return usage === null ? {} : { usage };
};

export const handleProxyRequest = Effect.fnUntraced(
  function* handleProxyRequest(
    request: ProxyRequestMessage,
    send: Send,
    progress: RequestProgress
  ) {
    const { requestId } = request;
    const providers = yield* Providers;
    const shape = checkRequestShape(
      request,
      new Set(providers.adapters.keys())
    );
    const adapter = providers.adapters.get(request.provider);
    if (shape !== null || adapter === undefined) {
      return yield* refuse(
        send,
        requestId,
        shape ?? { code: "not_allowed", message: "provider not served" }
      );
    }

    const state = yield* NodeState;
    const meters = yield* MeterReader;
    const config = yield* NodeConfig;
    const nowMs = Date.now();
    const refusal = evaluateAdmission({
      availability: yield* Ref.get(state.availability),
      circuitOpenUntilMs:
        (yield* Ref.get(state.circuitOpenUntil)).get(request.provider) ?? 0,
      meters: yield* meters.read(request.provider),
      nowMs,
    });
    if (refusal !== null) {
      return yield* refuse(send, requestId, refusal);
    }

    const credentialResult = yield* Effect.result(
      (yield* CredentialStore).get(request.provider)
    );
    if (credentialResult._tag === "Failure") {
      yield* Effect.logError(credentialResult.failure.message);
      return yield* refuse(send, requestId, {
        code: "internal",
        message: "node credential unavailable",
      });
    }

    const upstream = yield* UpstreamHttp;
    const response = yield* upstream.post(
      adapter.buildRequest(request, credentialResult.success)
    );
    yield* meters.observe(request.provider, response.headers);

    if (response.status === HTTP_TOO_MANY_REQUESTS) {
      const cooloff = adapter.cooloffMs(
        response.headers,
        config.rateLimitCooloffMs
      );
      yield* tripCircuit(state, request.provider, Date.now() + cooloff);
      yield* Effect.logWarning(
        `provider ${request.provider} returned 429; refusing new requests for ${cooloff}ms`
      );
      return yield* refuse(send, requestId, {
        code: "provider_rate_limited",
        message: "provider rate limited",
      });
    }
    if (
      response.status === HTTP_UNAUTHORIZED ||
      response.status === HTTP_FORBIDDEN
    ) {
      yield* Effect.logError(
        `provider ${request.provider} rejected the owner credential (HTTP ${response.status})`
      );
      return yield* refuse(send, requestId, {
        code: "provider_error",
        message: "provider rejected the node credential",
      });
    }

    yield* send({
      _tag: "ResponseHead",
      headers: adapter.forwardHeaders(response.headers),
      requestId,
      status: response.status,
    });

    const tracker = adapter.usageTracker(
      response.headers["content-type"] ?? ""
    );
    progress.tracker = tracker;
    const decoder = new TextDecoder();
    const forward = (text: string) => {
      if (text === "") {
        return Effect.void;
      }
      tracker.feed(text);
      return send({ _tag: "ResponseChunk", data: text, requestId });
    };
    yield* Stream.runForEach(response.body, (bytes) =>
      forward(decoder.decode(bytes, { stream: true }))
    );
    yield* forward(decoder.decode());
    progress.tracker = null;
    yield* send({ _tag: "ResponseEnd", requestId, usage: tracker.finish() });
  }
);

/**
 * Runs a request to completion, converting failures into ResponseError and reporting
 * cancellation. Either way the ResponseError carries the usage the provider reported so
 * far, so the gateway bills what was actually used. Tracks the in-flight count.
 */
export const serveProxyRequest = (request: ProxyRequestMessage, send: Send) =>
  Effect.gen(function* serveProxyRequestProgram() {
    const state = yield* NodeState;
    const progress: RequestProgress = { tracker: null };
    yield* Ref.update(state.inFlight, (n) => n + 1);
    yield* handleProxyRequest(request, send, progress).pipe(
      Effect.scoped,
      Effect.catch((error) =>
        send({
          _tag: "ResponseError",
          code: "provider_error",
          message: error.message,
          requestId: request.requestId,
          ...usageSoFar(progress),
        })
      ),
      Effect.onInterrupt(() =>
        send({
          _tag: "ResponseError",
          code: "cancelled",
          message: "request cancelled",
          requestId: request.requestId,
          ...usageSoFar(progress),
        })
      ),
      Effect.ensuring(Ref.update(state.inFlight, (n) => n - 1))
    );
  });
