/**
 * Vercel Node.js function entry. scripts/build-vercel.ts bundles this file into
 * .vercel/output/functions/index.func/index.mjs (Build Output API v3); every path is
 * routed to it. Layers (Postgres pool, config, OTLP exporters) are built on the first
 * request and reused by later requests on the same instance (Fluid compute).
 */
import { waitUntil } from "@vercel/functions";

import { makeWebHandler } from "./app";
import { toNodeHandler } from "./node-adapter";
import { flushTelemetry } from "./observability";

const { dispose, handler } = makeWebHandler();

process.once("SIGTERM", () => {
  void dispose();
});

/** Keeps the invocation alive until buffered spans and logs are exported. */
const flushAfterResponse = async (): Promise<void> => {
  waitUntil(flushTelemetry());
  await Promise.resolve();
};

export default toNodeHandler(handler, flushAfterResponse);
