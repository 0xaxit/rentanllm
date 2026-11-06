/**
 * Wires the HttpApi (from @rentanllm/api-contract) to its handlers and services, and turns
 * it into a fetch-style web handler with `HttpRouter.toWebHandler` (Effect 4).
 */
import { RentAnLlmApi } from "@rentanllm/api-contract";
import { layerFromEnv as DbLive } from "@rentanllm/db";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

import { AuthStorePg } from "./auth/auth-store";
import { SignatureVerifierLive } from "./auth/signature-verifier";
import { ApiConfig, ApiConfigLive } from "./config";
import { HederaMirrorLive } from "./hedera/mirror";
import { AuthenticationLive } from "./http/authentication";
import { CronAuthLive } from "./http/cron-auth";
import { AuthHandlers } from "./http/handlers/auth";
import { BuyerHandlers } from "./http/handlers/buyer";
import { CronHandlers } from "./http/handlers/cron";
import { MarketHandlers } from "./http/handlers/market";
import { OwnerHandlers } from "./http/handlers/owner";
import { PricingHandlers } from "./http/handlers/pricing";
import { SystemHandlers } from "./http/handlers/system";
import { ObservabilityLive } from "./observability";

/** All endpoint handlers; requires the app services (Db, AuthStore, ...). */
export const HandlersLayer = Layer.mergeAll(
  SystemHandlers,
  AuthHandlers,
  PricingHandlers,
  MarketHandlers,
  OwnerHandlers,
  BuyerHandlers,
  CronHandlers
);

/** CORS for the web app's origins, with credentials (the session cookie). */
const CorsLayer = Layer.unwrap(
  Effect.map(Effect.service(ApiConfig), (config) =>
    HttpRouter.cors({
      allowedHeaders: ["content-type", "authorization"],
      allowedMethods: ["GET", "POST", "PUT", "PATCH", "OPTIONS"],
      allowedOrigins: config.webOrigins,
      credentials: true,
    })
  )
);

/** Routes, middleware and handlers. Services still to be provided. */
export const RoutesLayer = Layer.mergeAll(
  HttpApiBuilder.layer(RentAnLlmApi, { openapiPath: "/openapi.json" }),
  CorsLayer
).pipe(
  Layer.provide(HandlersLayer),
  Layer.provide([AuthenticationLive, CronAuthLive])
);

/** Production services: Postgres (DATABASE_URL), SIWE verification, the Hedera mirror node, env config. */
export const ServicesLive = Layer.mergeAll(
  AuthStorePg,
  SignatureVerifierLive,
  HederaMirrorLive
).pipe(Layer.provideMerge(DbLive), Layer.provideMerge(ApiConfigLive));

export const AppLive = RoutesLayer.pipe(
  Layer.provide(ServicesLive),
  Layer.provideMerge(ObservabilityLive),
  Layer.provide(HttpServer.layerServices)
);

/** A `(Request) => Promise<Response>` for serverless runtimes, plus `dispose`. */
export const makeWebHandler = () => HttpRouter.toWebHandler(AppLive);
