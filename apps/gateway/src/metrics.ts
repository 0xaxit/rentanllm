/**
 * Gateway metrics. Exported over OTLP (see telemetry.ts) to Grafana Alloy, which
 * remote-writes them to Prometheus with `add_metric_suffixes = false`, so these names
 * reach Prometheus unchanged (no `_total`). Counters are `incremental`, so OTLP marks
 * them monotonic and Prometheus treats them as counters. Do not rename: the Grafana
 * dashboard and alerts in deploy/hostinger query these names.
 */
import { Effect, Metric } from "effect";

const LATENCY_BOUNDARIES_MS = [
  50, 100, 250, 500, 1000, 2500, 5000, 10_000, 30_000, 60_000, 120_000, 300_000,
];

/** Finished /v1/messages requests by HTTP status, outcome and status class. */
export const requestsTotal = Metric.counter("gateway_requests", {
  description: "Market requests on /v1/chat/completions, by HTTP status",
  incremental: true,
});

/** Provider-reported tokens, by kind (input, output, cache_read, cache_write). */
export const tokensTotal = Metric.counter("gateway_tokens", {
  description: "Tokens served, as reported by the provider",
  incremental: true,
});

export const costMicrosTotal = Metric.counter("gateway_cost_micros", {
  description: "USDC micros paid to sellers",
  incremental: true,
});

export const requestDurationMs = Metric.histogram(
  "gateway_request_duration_ms",
  {
    boundaries: LATENCY_BOUNDARIES_MS,
    description: "Time from dispatch to the node until the response finished",
  }
);

/** Open tunnel sockets, including ones still waiting for NodeHello. */
export const activeTunnels = Metric.gauge("gateway_active_tunnels", {
  description: "Open node tunnel WebSockets",
});

/** Nodes that said hello and are connected to this process. */
export const nodesConnected = Metric.gauge("gateway_nodes_connected", {
  description: "Nodes connected to this gateway process",
});

/** Heartbeat frames received from nodes. */
export const nodeHeartbeatsTotal = Metric.counter("gateway_node_heartbeats", {
  description: "Heartbeat frames received from node agents",
  incremental: true,
});

export const countRequest = (status: number, outcome: string) =>
  Metric.update(
    Metric.withAttributes(requestsTotal, {
      outcome,
      status: String(status),
      status_class: `${Math.floor(status / 100)}xx`,
    }),
    1
  );

export const countTokens = (kind: string, count: number) =>
  count > 0
    ? Metric.update(Metric.withAttributes(tokensTotal, { kind }), count)
    : Effect.void;

export const countHeartbeat = Metric.update(nodeHeartbeatsTotal, 1);
