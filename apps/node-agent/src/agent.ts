import { BunSocket } from "@effect/platform-bun";
import { Effect, Layer } from "effect";

import { NodeConfig } from "./config.ts";
import type { AgentConfig } from "./config.ts";
import type { CredentialStore } from "./credentials.ts";
import { CredentialStoreCliProxyApi } from "./credentials.ts";
import type { MeterReader } from "./meters.ts";
import { MeterReaderHeaders } from "./meters.ts";
import { ProvidersLive } from "./providers/registry.ts";
import { NodeStateLive } from "./state.ts";
import { runTunnel } from "./tunnel.ts";
import { UpstreamHttpFetch } from "./upstream.ts";
import type { WakeLock } from "./wake-lock.ts";
import { WakeLockLive } from "./wake-lock.ts";

export interface AgentLayerOptions {
  readonly credentials?: Layer.Layer<CredentialStore, never, NodeConfig>;
  readonly meters?: Layer.Layer<
    MeterReader,
    never,
    NodeConfig | CredentialStore
  >;
  readonly wakeLock?: Layer.Layer<WakeLock, never, NodeConfig>;
}

/** Wires every service the agent needs. Tests swap credentials, meters and the wake lock. */
export const agentLayer = (
  config: AgentConfig,
  options: AgentLayerOptions = {}
) => {
  const configLayer = Layer.succeed(NodeConfig, config);
  const base = Layer.mergeAll(
    UpstreamHttpFetch,
    options.credentials ?? CredentialStoreCliProxyApi,
    ProvidersLive,
    NodeStateLive,
    options.wakeLock ?? WakeLockLive,
    // Bun's WebSocket client, which can send the Authorization header on the handshake.
    BunSocket.layerWebSocketConstructor
  ).pipe(Layer.provideMerge(configLayer));
  return (options.meters ?? MeterReaderHeaders).pipe(Layer.provideMerge(base));
};

/** Runs the agent until interrupted. */
export const runAgent = (config: AgentConfig, options?: AgentLayerOptions) =>
  runTunnel.pipe(Effect.provide(agentLayer(config, options)));
