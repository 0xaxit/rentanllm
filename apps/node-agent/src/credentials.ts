/**
 * The credential the node sends upstream: CLIProxyAPI's own access key, read from its
 * config.yaml. The owner's subscription login stays inside CLIProxyAPI; the node never holds
 * a provider API key. The key is kept in a `Redacted` wrapper, sent only to CLIProxyAPI, and
 * never logged or sent to the gateway.
 */
import type { Provider } from "@rentanllm/protocol";
import { Context, Effect, Layer, Redacted } from "effect";

import { NodeConfig } from "./config.ts";
import type { AgentConfig } from "./config.ts";
import { CredentialError } from "./credential-error.ts";

export interface CredentialStoreShape {
  /** Returns the credential for a provider. The error message never contains the secret. */
  readonly get: (
    provider: Provider
  ) => Effect.Effect<Redacted.Redacted<string>, CredentialError>;
}

export class CredentialStore extends Context.Service<
  CredentialStore,
  CredentialStoreShape
>()("rentanllm/CredentialStore") {}

/** Ollama takes no credential; adapters ignore this placeholder. */
const NO_CREDENTIAL = Redacted.make("none");

export const makeCliProxyApiCredentialStore = (
  config: AgentConfig
): CredentialStoreShape => ({
  get: (provider) => {
    if (provider === "ollama") {
      return Effect.succeed(NO_CREDENTIAL);
    }
    const { apiKey, configPath } = config.cliProxyApi;
    return apiKey === null
      ? Effect.fail(
          new CredentialError({
            message: `no CLIProxyAPI access key: add one under api-keys in ${configPath}, or pass --cliproxyapi-config`,
          })
        )
      : Effect.succeed(apiKey);
  },
});

export const CredentialStoreCliProxyApi = Layer.effect(
  CredentialStore,
  NodeConfig.useSync(makeCliProxyApiCredentialStore)
);
