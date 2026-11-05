import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { ConfigProvider, Effect, Layer } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  flushTelemetry,
  ObservabilityLive,
  parseOtlpHeaders,
} from "../src/observability";

interface Received {
  readonly authorization: string | undefined;
  readonly body: string;
  readonly path: string;
}

describe("OTLP export", () => {
  const received: Received[] = [];
  const collector = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      received.push({
        authorization: req.headers.authorization,
        body,
        path: req.url ?? "",
      });
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  let endpoint = "";

  beforeAll(async () => {
    collector.listen(0);
    await once(collector, "listening");
    endpoint = `http://localhost:${(collector.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    collector.close();
  });

  it("parses URL-encoded OTLP headers", () => {
    expect(parseOtlpHeaders("Authorization=Bearer%20abc, x-team=core")).toEqual(
      {
        Authorization: "Bearer abc",
        "x-team": "core",
      }
    );
  });

  it("exports spans to /v1/traces on flush, with the configured headers", async () => {
    const config = ConfigProvider.fromUnknown({
      OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
      OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer%20test-token",
      VERCEL_ENV: "development",
    });
    const program = Effect.gen(function* traced() {
      yield* Effect.void.pipe(Effect.withSpan("test.span"));
      yield* Effect.promise(flushTelemetry);
    });
    await Effect.runPromise(
      program.pipe(
        Effect.provide(
          ObservabilityLive.pipe(Layer.provide(ConfigProvider.layer(config)))
        )
      )
    );
    const traces = received.filter((item) => item.path === "/v1/traces");
    expect(traces.length).toBeGreaterThan(0);
    expect(traces[0]?.authorization).toBe("Bearer test-token");
    expect(traces.some((item) => item.body.includes("test.span"))).toBe(true);
  });
});
