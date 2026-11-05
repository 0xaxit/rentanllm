/**
 * OpenTelemetry export. When OTEL_EXPORTER_OTLP_ENDPOINT is set (e.g. Grafana Alloy at
 * http://alloy:4318), traces, metrics and logs go there over OTLP/HTTP using Effect's
 * built-in exporter (`effect/observability/Otlp`; no OpenTelemetry SDK needed). Logs
 * also stay on stdout. Unset, telemetry stays local (logs only).
 */
import { Config, Effect, Layer, Option } from "effect";
import { FetchHttpClient } from "effect/http";
import { Otlp } from "effect/observability";

const DEFAULT_SERVICE_NAME = "rentanllm-gateway";
const EXPORT_INTERVAL = "10 seconds";

export const TelemetryFromEnv = Layer.unwrap(
  Effect.gen(function* telemetryFromEnv() {
    const endpoint = yield* Config.option(
      Config.String("OTEL_EXPORTER_OTLP_ENDPOINT")
    );
    if (Option.isNone(endpoint) || endpoint.value.trim().length === 0) {
      return Layer.empty;
    }
    const serviceName = yield* Config.String("OTEL_SERVICE_NAME").pipe(
      Config.withDefault(DEFAULT_SERVICE_NAME)
    );
    const serviceVersion = yield* Config.String("GATEWAY_VERSION").pipe(
      Config.withDefault("dev")
    );
    const environment = yield* Config.String("DEPLOY_ENV").pipe(
      Config.withDefault("development")
    );
    yield* Effect.logInfo("exporting telemetry over OTLP").pipe(
      Effect.annotateLogs({ endpoint: endpoint.value, serviceName })
    );
    return Otlp.layerJson({
      baseUrl: endpoint.value.trim(),
      loggerMergeWithExisting: true,
      metricsExportInterval: EXPORT_INTERVAL,
      resource: {
        attributes: { "deployment.environment.name": environment },
        serviceName,
        serviceVersion,
      },
    }).pipe(Layer.provide(FetchHttpClient.layer));
  })
);
