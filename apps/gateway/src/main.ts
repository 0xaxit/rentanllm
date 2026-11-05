/**
 * Gateway entry point. Reads env, picks the stores (STORE=memory|postgres), starts
 * telemetry and serves until SIGINT/SIGTERM.
 */
import { NodeRuntime } from "@effect/platform-node";
import { Config, Effect, Layer, Logger } from "effect";

import { gatewayLayer } from "./app.ts";
import { Settings, SettingsFromEnv } from "./config.ts";
import { StoresFromEnv } from "./stores.ts";
import { TelemetryFromEnv } from "./telemetry.ts";
import { FacilitatorFromEnv } from "./x402/facilitator.ts";

const DEFAULT_PORT = 8787;

const loggerLayer = Layer.unwrap(
  Effect.gen(function* chooseLogger() {
    const format = yield* Config.Literals(
      ["json", "pretty"],
      "LOG_FORMAT"
    ).pipe(Config.withDefault("json"));
    return Logger.layer([
      format === "json" ? Logger.consoleJson : Logger.consolePretty(),
    ]);
  })
);

const main = Layer.unwrap(
  Effect.gen(function* buildGateway() {
    const port = yield* Config.Port("PORT").pipe(
      Config.withDefault(DEFAULT_PORT)
    );
    const host = yield* Config.String("HOST").pipe(
      Config.withDefault("0.0.0.0")
    );
    const settings = yield* Settings;
    yield* Effect.logInfo("starting gateway").pipe(
      Effect.annotateLogs({
        host,
        market:
          settings.market === null ? "disabled" : settings.market.chain.name,
        port,
      })
    );
    return gatewayLayer({
      facilitator: FacilitatorFromEnv.pipe(Layer.orDie),
      host,
      port,
      settings,
      stores: StoresFromEnv,
    });
  })
).pipe(
  Layer.provide(SettingsFromEnv),
  Layer.provide(TelemetryFromEnv),
  Layer.provide(loggerLayer)
);

NodeRuntime.runMain(Layer.launch(main));
