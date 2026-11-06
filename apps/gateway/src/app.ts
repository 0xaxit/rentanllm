/**
 * Routes and server wiring. `gatewayLayer` builds the whole gateway over a set of store
 * layers, so main.ts and the tests share exactly the same graph.
 */
import { createServer } from "node:http";

import { NodeHttpServer } from "@effect/platform-node";
import { TUNNEL_PATH } from "@rentanllm/protocol";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { Settings } from "./config.ts";
import type { GatewaySettings } from "./config.ts";
import { errorBody, toErrorResponse } from "./errors.ts";
import type { GatewayError } from "./errors.ts";
import { sha256Hex } from "./hash.ts";
import { ArkivMirrorLive } from "./market/arkiv-mirror.ts";
import { MirrorNodeAccounts } from "./market/hedera-accounts.ts";
import { handleListModels } from "./market/models.ts";
import {
  CHAT_COMPLETIONS_PATH,
  IMAGE_GENERATIONS_PATH,
  handleChatCompletions,
  handleImageGenerations,
} from "./market/route.ts";
import { SpendAuditLive } from "./market/spend-audit.ts";
import { MarketTermsLive } from "./market/terms.ts";
import { countRequest } from "./metrics.ts";
import { clientAddress, lookupRegion } from "./region.ts";
import type { MarketStore } from "./services/market-store.ts";
import { NodeRegistry } from "./services/node-registry.ts";
import type { RateLimiter } from "./services/rate-limiter.ts";
import type { StoreError } from "./services/store-error.ts";
import { TunnelHub, TunnelHubLive } from "./tunnel/tunnel-hub.ts";
import type { FacilitatorError } from "./x402/facilitator-error.ts";
import type { X402Facilitator } from "./x402/facilitator.ts";

const BEARER_PREFIX = /^bearer\s+/iu;

/** Node token from `Authorization: Bearer <token>` or `x-node-token`. */
const extractNodeToken = (
  headers: Readonly<Record<string, string | undefined>>
): string | null => {
  const direct = headers["x-node-token"]?.trim();
  if (direct !== undefined && direct.length > 0) {
    return direct;
  }
  const auth = headers.authorization?.trim();
  if (auth !== undefined && BEARER_PREFIX.test(auth)) {
    const token = auth.replace(BEARER_PREFIX, "").trim();
    return token.length > 0 ? token : null;
  }
  return null;
};

const internalError = HttpServerResponse.jsonUnsafe(
  errorBody("api_error", "Internal error. Please retry."),
  { status: 500 }
);

const facilitatorUnavailable = HttpServerResponse.jsonUnsafe(
  errorBody(
    "api_error",
    "The payment facilitator is unavailable, so the x402 payment was not settled. Retry later with the same payment."
  ),
  { status: 502 }
);

/** Maps a refused or failed market request to its HTTP response. */
const failureResponse = (
  failure: GatewayError | StoreError | FacilitatorError
) => {
  switch (failure._tag) {
    case "StoreError": {
      return Effect.as(
        Effect.logError("store failure", failure.store, failure.cause),
        internalError
      );
    }
    case "FacilitatorError": {
      return Effect.as(
        Effect.logError(
          "x402 facilitator failure",
          failure.operation,
          failure.cause
        ),
        facilitatorUnavailable
      );
    }
    default: {
      return Effect.succeed(toErrorResponse(failure));
    }
  }
};

/** Turns a refused request into its response and counts it. */
const answerFailures = <R>(
  handler: Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    GatewayError | StoreError | FacilitatorError,
    R
  >
) =>
  handler.pipe(
    Effect.matchEffect({
      onFailure: (failure) =>
        failureResponse(failure).pipe(
          Effect.tap((response) => countRequest(response.status, "refused"))
        ),
      onSuccess: Effect.succeed,
    })
  );

const chatCompletionsRoute = HttpRouter.add(
  "POST",
  CHAT_COMPLETIONS_PATH,
  answerFailures(handleChatCompletions)
);

const imageGenerationsRoute = HttpRouter.add(
  "POST",
  IMAGE_GENERATIONS_PATH,
  answerFailures(handleImageGenerations)
);

const modelsRoute = HttpRouter.add(
  "GET",
  "/v1/models",
  answerFailures(handleListModels)
);

const unauthorizedNode = HttpServerResponse.jsonUnsafe(
  errorBody("authentication_error", "Invalid node token."),
  { status: 401 }
);

const tunnelRoute = HttpRouter.add(
  "GET",
  TUNNEL_PATH,
  Effect.gen(function* handleTunnel() {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const token = extractNodeToken(request.headers);
    if (token === null) {
      return unauthorizedNode;
    }
    const node = yield* (yield* NodeRegistry).findByTokenHash(sha256Hex(token));
    if (node === null) {
      yield* Effect.logWarning("tunnel connection with unknown node token");
      return unauthorizedNode;
    }
    const socket = yield* request.upgrade;
    const registry = yield* NodeRegistry;
    yield* lookupRegion(
      clientAddress(request.headers["x-forwarded-for"], request.remoteAddress)
    ).pipe(
      Effect.flatMap((region) =>
        region === null
          ? Effect.void
          : registry.recordRegion(node.nodeId, region)
      ),
      Effect.catchTag("StoreError", (cause) =>
        Effect.logWarning("failed to record node region", cause)
      ),
      Effect.forkDetach
    );
    yield* (yield* TunnelHub).serve(node, socket);
    return HttpServerResponse.empty();
  }).pipe(
    Effect.catchTag("StoreError", () => Effect.succeed(internalError)),
    Effect.catchTag("HttpServerError", () =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe(
          errorBody("invalid_request_error", "Expected a WebSocket upgrade."),
          { status: 426 }
        )
      )
    )
  )
);

const healthRoute = HttpRouter.add(
  "GET",
  "/healthz",
  Effect.gen(function* health() {
    const nodes = yield* (yield* TunnelHub).connected;
    return HttpServerResponse.jsonUnsafe({
      nodesConnected: nodes.length,
      status: "ok",
    });
  })
);

const Routes = Layer.mergeAll(
  chatCompletionsRoute,
  imageGenerationsRoute,
  modelsRoute,
  tunnelRoute,
  healthRoute
);

export type StoreServices = MarketStore | NodeRegistry | RateLimiter;

export interface GatewayOptions<E> {
  readonly facilitator: Layer.Layer<X402Facilitator>;
  readonly host?: string;
  readonly port: number;
  readonly settings: GatewaySettings;
  readonly stores: Layer.Layer<StoreServices, E, Settings>;
}

/** The full gateway: HTTP server, routes, tunnel hub, market and stores. */
export const gatewayLayer = <E>(options: GatewayOptions<E>) => {
  const settings = Layer.succeed(Settings)(options.settings);
  const market = MarketTermsLive.pipe(Layer.provide(MirrorNodeAccounts));
  const hubAndMarket = Layer.mergeAll(TunnelHubLive, market);
  const arkiv = ArkivMirrorLive.pipe(Layer.provide(hubAndMarket));
  const core = Layer.mergeAll(hubAndMarket, arkiv, SpendAuditLive).pipe(
    Layer.provideMerge(options.stores),
    Layer.provideMerge(options.facilitator),
    Layer.provideMerge(settings)
  );
  return HttpRouter.serve(Routes).pipe(
    Layer.provide(core),
    Layer.provideMerge(
      NodeHttpServer.layer(createServer, {
        host: options.host ?? "0.0.0.0",
        port: options.port,
      })
    )
  );
};
