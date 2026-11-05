/**
 * Traces and logs over OTLP/HTTP (JSON) with Effect's built-in exporters
 * (`effect/observability`, same as the gateway; no OpenTelemetry SDK). A no-op unless
 * OTEL_EXPORTER_OTLP_ENDPOINT is set, e.g. https://otel.<domain>.
 *
 * Env:
 * - OTEL_EXPORTER_OTLP_ENDPOINT  base URL; /v1/traces and /v1/logs are appended
 * - OTEL_EXPORTER_OTLP_HEADERS   "k=v,k2=v2", values URL-encoded
 *                                (Authorization=Bearer%20<token>)
 * - OTEL_SERVICE_NAME            default "rentanllm-api"
 *
 * Serverless instances can freeze right after a response, so `flushTelemetry` drains the
 * exporters; the Vercel entry runs it inside `waitUntil` after every invocation.
 */
import { Config, Effect, Layer, Logger, Option } from "effect";
import { FetchHttpClient } from "effect/http";
import {
  OtlpExporter,
  OtlpLogger,
  OtlpSerialization,
  OtlpTracer,
} from "effect/observability";

const DEFAULT_SERVICE_NAME = "rentanllm-api";
const EXPORT_INTERVAL = "2 seconds";
const FLUSH_TIMEOUT = "5 seconds";

let flushExporters: (() => Promise<void>) | undefined;

/**
 * Drains buffered spans and logs; a no-op when export is off. Never rejects: Effect's
 * `Flusher.flush` cannot fail, and it is bounded by FLUSH_TIMEOUT.
 */
export const flushTelemetry = async (): Promise<void> => {
  await flushExporters?.();
};

/** "k=v,k2=v2" with URL-encoded values, per the OTLP exporter env spec. */
export const parseOtlpHeaders = (raw: string): Record<string, string> => {
  const headers: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const separator = pair.indexOf("=");
    if (separator > 0) {
      const key = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      headers[key] = decodeURIComponent(value);
    }
  }
  return headers;
};

const registerFlusher = Layer.effectDiscard(
  Effect.gen(function* registerFlusherGen() {
    const flusher = yield* OtlpExporter.Flusher;
    flushExporters = () =>
      Effect.runPromise(
        flusher.flush.pipe(Effect.timeoutOption(FLUSH_TIMEOUT), Effect.asVoid)
      );
  })
);

const otlpLayer = (options: {
  readonly endpoint: string;
  readonly environment: string;
  readonly headers: Record<string, string>;
  readonly serviceName: string;
  readonly version: string;
}) => {
  const base = options.endpoint.replace(/\/+$/u, "");
  const resource = {
    attributes: { "deployment.environment": options.environment },
    serviceName: options.serviceName,
    serviceVersion: options.version,
  };
  const exporters = Layer.mergeAll(
    OtlpTracer.layer({
      exportInterval: EXPORT_INTERVAL,
      headers: options.headers,
      resource,
      url: `${base}/v1/traces`,
    }),
    OtlpLogger.layer({
      exportInterval: EXPORT_INTERVAL,
      headers: options.headers,
      mergeWithExisting: true,
      resource,
      url: `${base}/v1/logs`,
    })
  ).pipe(
    Layer.provide(OtlpSerialization.layerJson),
    Layer.provide(FetchHttpClient.layer)
  );
  return registerFlusher.pipe(Layer.provideMerge(exporters));
};

/** OTLP export when configured, plus JSON console logs outside development. */
export const ObservabilityLive = Layer.unwrap(
  Effect.gen(function* makeObservability() {
    const endpoint = yield* Config.option(
      Config.String("OTEL_EXPORTER_OTLP_ENDPOINT")
    );
    const headers = yield* Config.String("OTEL_EXPORTER_OTLP_HEADERS").pipe(
      Config.withDefault("")
    );
    const serviceName = yield* Config.String("OTEL_SERVICE_NAME").pipe(
      Config.withDefault(DEFAULT_SERVICE_NAME)
    );
    const environment = yield* Config.String("VERCEL_ENV").pipe(
      Config.withDefault("development")
    );
    const version = yield* Config.String("VERCEL_GIT_COMMIT_SHA").pipe(
      Config.withDefault("dev")
    );
    const console =
      environment === "development"
        ? Layer.empty
        : Logger.layer([Logger.consoleJson], { mergeWithExisting: false });
    if (Option.isNone(endpoint) || endpoint.value.trim().length === 0) {
      return console;
    }
    return otlpLayer({
      endpoint: endpoint.value.trim(),
      environment,
      headers: parseOtlpHeaders(headers),
      serviceName,
      version,
    }).pipe(Layer.provideMerge(console));
  })
);
