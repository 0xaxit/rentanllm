#!/usr/bin/env bun
/**
 * ral (rentanllm-node): the owner's node agent.
 *
 *   ral start --gateway wss://gw.example/tunnel --node-id <id>   (token in env)
 *   ral status
 */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Option } from "effect";
import { Command, Flag } from "effect/cli";

import { runAgent } from "./agent.ts";
import { configDirFromEnv, loadConfig } from "./config.ts";
import { detectSubscriptions } from "./providers/cliproxyapi.ts";
import { formatStatus } from "./status.ts";
import { AGENT_VERSION } from "./version.ts";

const optionalString = (name: string, description: string) =>
  Flag.String(name).pipe(Flag.withDescription(description), Flag.optional);

const start = Command.make(
  "start",
  {
    cliProxyApiConfig: optionalString(
      "cliproxyapi-config",
      "CLIProxyAPI's config.yaml, read for its port and access key (default ~/.cli-proxy-api/config.yaml; env RENTANLLM_CLIPROXYAPI_CONFIG)"
    ),
    cliProxyApiUrl: optionalString(
      "cliproxyapi-url",
      "The local CLIProxyAPI serving your subscription login (default http://127.0.0.1:<port from its config>; env RENTANLLM_CLIPROXYAPI_URL)"
    ),
    gateway: optionalString(
      "gateway",
      "Gateway tunnel URL, e.g. wss://gw.rentanllm.com/tunnel; a bare host gets /tunnel appended (env RENTANLLM_GATEWAY_URL)"
    ),
    keepAwake: Flag.Boolean("keep-awake").pipe(
      Flag.withDescription(
        "Keep the machine awake while open for rentals (default on; --no-keep-awake to disable)"
      ),
      Flag.optional
    ),
    meterProbe: Flag.Boolean("meter-probe").pipe(
      Flag.withDescription(
        "Probe the provider for fresh usage meters while open (default on; --no-meter-probe to disable)"
      ),
      Flag.optional
    ),
    nodeId: optionalString(
      "node-id",
      "Node id from the dashboard, shown with the node token when you register the node (required; env RENTANLLM_NODE_ID)"
    ),
    nodeToken: optionalString(
      "node-token",
      "Node token from the RentAnLLM dashboard (prefer env RENTANLLM_NODE_TOKEN: flags are visible in `ps`)"
    ),
    ollamaModel: optionalString(
      "ollama-model",
      "Serve open models through your local Ollama, e.g. llama3.1:8b; the model must be pulled (env RENTANLLM_OLLAMA_MODEL)"
    ),
    ollamaUrl: optionalString(
      "ollama-url",
      "Your local Ollama (default http://127.0.0.1:11434; env RENTANLLM_OLLAMA_URL)"
    ),
  },
  (flags) =>
    Effect.gen(function* startProgram() {
      const loaded = yield* loadConfig({
        cliProxyApiConfig: Option.getOrUndefined(flags.cliProxyApiConfig),
        cliProxyApiUrl: Option.getOrUndefined(flags.cliProxyApiUrl),
        gatewayUrl: Option.getOrUndefined(flags.gateway),
        keepAwake: Option.getOrUndefined(flags.keepAwake),
        meterProbe: Option.getOrUndefined(flags.meterProbe),
        nodeId: Option.getOrUndefined(flags.nodeId),
        nodeToken: Option.getOrUndefined(flags.nodeToken),
        ollamaModel: Option.getOrUndefined(flags.ollamaModel),
        ollamaUrl: Option.getOrUndefined(flags.ollamaUrl),
      });
      yield* Effect.logInfo(
        `ral ${AGENT_VERSION} starting; gateway ${loaded.gatewayUrl}; config dir ${loaded.configDir}`
      );
      // With Ollama serving open models, a subscription through CLIProxyAPI is optional.
      const probeModels =
        loaded.ollama === null
          ? yield* detectSubscriptions(loaded.cliProxyApi)
          : yield* detectSubscriptions(loaded.cliProxyApi).pipe(
              Effect.catchTag("ConfigError", (failure) =>
                Effect.as(
                  Effect.logInfo(
                    `not serving a subscription: ${failure.message}`
                  ),
                  {}
                )
              )
            );
      const config = {
        ...loaded,
        cliProxyApi: { ...loaded.cliProxyApi, probeModels },
      };
      if (config.ollama !== null) {
        yield* Effect.logInfo(
          `serving open models through Ollama at ${config.ollama.baseUrl} (meter probe model ${config.ollama.probeModel})`
        );
      }
      for (const [provider, model] of Object.entries(probeModels)) {
        yield* Effect.logInfo(
          `serving your ${provider} subscription through CLIProxyAPI at ${config.cliProxyApi.baseUrl} (meter probe model ${model})`
        );
      }
      return yield* runAgent(config);
    }).pipe(
      Effect.catchTag("ConfigError", (failure) =>
        Effect.andThen(
          Console.error(`ral: ${failure.message}`),
          Effect.sync(() => {
            process.exitCode = 1;
          })
        )
      )
    )
).pipe(
  Command.withDescription(
    "Connect to the gateway and serve rentals from your subscription, through your local CLIProxyAPI"
  )
);

const status = Command.make("status", {}, () =>
  Console.log(formatStatus(configDirFromEnv(process.env)))
).pipe(Command.withDescription("Show the running agent's status"));

const root = Command.make("ral").pipe(
  Command.withDescription("RentAnLLM node agent"),
  Command.withSubcommands([start, status])
);

const program = Command.run(root, { version: AGENT_VERSION }).pipe(
  Effect.provide(BunServices.layer)
);

BunRuntime.runMain(program);
