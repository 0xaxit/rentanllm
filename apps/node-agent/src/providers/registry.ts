import type { Provider } from "@rentanllm/protocol";
import { Context, Layer } from "effect";

import { NodeConfig } from "../config.ts";
import type { ProviderAdapter } from "./adapter.ts";
import { makeCliProxyApiAdapter } from "./cliproxyapi.ts";
import { makeOllamaAdapter } from "./ollama.ts";

export interface ProvidersShape {
  readonly adapters: ReadonlyMap<Provider, ProviderAdapter>;
}

/** The provider adapters this node serves. Only providers listed here are advertised in NodeHello. */
export class Providers extends Context.Service<Providers, ProvidersShape>()(
  "rentanllm/Providers"
) {}

export const makeProviders = (
  adapters: readonly ProviderAdapter[]
): ProvidersShape => ({
  adapters: new Map(adapters.map((a) => [a.provider, a])),
});

export const ProvidersLive = Layer.effect(
  Providers,
  NodeConfig.useSync((config) =>
    makeProviders([
      ...Object.entries(config.cliProxyApi.probeModels).map(
        ([provider, probeModel]) =>
          makeCliProxyApiAdapter({
            baseUrl: config.cliProxyApi.baseUrl,
            probeModel,
            provider: provider as Provider,
          })
      ),
      ...(config.ollama === null ? [] : [makeOllamaAdapter(config.ollama)]),
    ])
  )
);
