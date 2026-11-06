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
import { AgentWalletChainLive } from "./hedera/agent-wallets";
import { HederaMirrorLive } from "./hedera/mirror";
import { AuthenticationLive } from "./http/authentication";
import { CronAuthLive } from "./http/cron-auth";
import { AgentsHandlers } from "./http/handlers/agents";
import { AuthHandlers } from "./http/handlers/auth";
import { BuyerHandlers } from "./http/handlers/buyer";
import { CronHandlers } from "./http/handlers/cron";
import { MarketHandlers } from "./http/handlers/market";
import { OAuthHandlers } from "./http/handlers/oauth";
import { OwnerHandlers } from "./http/handlers/owner";
import { PricingHandlers } from "./http/handlers/pricing";
import { SystemHandlers } from "./http/handlers/system";
import { McpRoutes } from "./http/mcp-routes";
import { ObservabilityLive } from "./observability";
import { Erc8004Live } from "./reputation/erc8004";

/** All endpoint handlers; requires the app services (Db, AuthStore, ...). */
export const HandlersLayer = Layer.mergeAll(
  SystemHandlers,
  AuthHandlers,
  PricingHandlers,
  MarketHandlers,
  OwnerHandlers,
  BuyerHandlers,
  AgentsHandlers,
  OAuthHandlers,
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
  McpRoutes,
  CorsLayer
).pipe(
  Layer.provide(HandlersLayer),
  Layer.provide([AuthenticationLive, CronAuthLive])
);

/** Production services: Postgres (DATABASE_URL), SIWE verification, the Hedera mirror node, ERC-8004 over Hashio, env config. */
export const ServicesLive = Layer.mergeAll(
  AuthStorePg,
  SignatureVerifierLive,
  HederaMirrorLive,
  Erc8004Live,
  AgentWalletChainLive
).pipe(Layer.provideMerge(DbLive), Layer.provideMerge(ApiConfigLive));

export const AppLive = RoutesLayer.pipe(
  Layer.provide(ServicesLive),
  Layer.provideMerge(ObservabilityLive),
  Layer.provide(HttpServer.layerServices)
);

/** A `(Request) => Promise<Response>` for serverless runtimes, plus `dispose`. */
export const makeWebHandler = () => HttpRouter.toWebHandler(AppLive);
