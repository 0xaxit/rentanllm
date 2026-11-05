/** Fake gateway (WebSocket) + fake Anthropic API (HTTP) + an agent wired to both. */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  GatewayToNode,
  NodeToGateway,
  UsageMeters,
} from "@rentanllm/protocol";
import type { Server, ServerWebSocket } from "bun";
import { Effect, Fiber, Layer, Redacted } from "effect";

import { runAgent } from "../src/agent.ts";
import type { AgentConfig } from "../src/config.ts";
import { CredentialStore } from "../src/credentials.ts";
import { MeterReader } from "../src/meters.ts";
import type { StatusSnapshot } from "../src/status.ts";
import { WakeLockTest } from "../src/wake-lock.ts";

export const TEST_CREDENTIAL = "sk-test-not-a-real-key";
/** The fake CLIProxyAPI answers this model as a meter probe and does not record it. */
export const PROBE_MODEL = "claude-probe-test";
export const NODE_TOKEN = "node-token-for-tests";
const POLL_MS = 10;
const DEFAULT_WAIT_MS = 5000;
const CHUNK_GAP_MS = 15;

export const sleep = (ms: number): Promise<void> => Bun.sleep(ms);

export const waitFor = async <A>(
  probe: () => A | undefined | null | false,
  label: string,
  timeoutMs = DEFAULT_WAIT_MS
): Promise<A> => {
  const value = probe();
  if (value !== undefined && value !== null && value !== false) {
    return value;
  }
  if (timeoutMs <= 0) {
    throw new Error(`timed out waiting for ${label}`);
  }
  await sleep(POLL_MS);
  return waitFor(probe, label, timeoutMs - POLL_MS);
};

// ---------------------------------------------------------------- fake gateway

interface SocketData {
  readonly id: number;
}

export interface FakeGateway {
  readonly close: () => void;
  readonly connections: () => number;
  readonly dropAll: () => void;
  readonly frames: NodeToGateway[];
  readonly handshakes: Headers[];
  readonly raw: string[];
  readonly send: (message: GatewayToNode) => void;
  readonly url: string;
}

export const startFakeGateway = (port = 0): FakeGateway => {
  const frames: NodeToGateway[] = [];
  const raw: string[] = [];
  const handshakes: Headers[] = [];
  const sockets = new Set<ServerWebSocket<SocketData>>();
  let nextId = 0;
  const server: Server<SocketData> = Bun.serve<SocketData>({
    fetch: (req, srv) => {
      handshakes.push(req.headers);
      nextId += 1;
      if (srv.upgrade(req, { data: { id: nextId } })) {
        return;
      }
      return new Response("expected websocket", { status: 400 });
    },
    port,
    websocket: {
      close: (ws) => {
        sockets.delete(ws);
      },
      message: (_ws, message) => {
        const text = typeof message === "string" ? message : message.toString();
        raw.push(text);
        frames.push(JSON.parse(text) as NodeToGateway);
      },
      open: (ws) => {
        sockets.add(ws);
      },
    },
  });
  return {
    close: () => {
      server.stop(true);
    },
    connections: () => sockets.size,
    dropAll: () => {
      for (const ws of sockets) {
        ws.close(1012, "restarting");
      }
    },
    frames,
    handshakes,
    raw,
    send: (message) => {
      for (const ws of sockets) {
        ws.send(JSON.stringify(message));
      }
    },
    url: `ws://127.0.0.1:${server.port}/node`,
  };
};

// ---------------------------------------------------------------- fake Anthropic

export const SSE_EVENTS = [
  `event: message_start\ndata: ${JSON.stringify({ message: { id: "msg_1", model: "claude-test-1", role: "assistant", type: "message", usage: { cache_creation_input_tokens: 3, cache_read_input_tokens: 5, input_tokens: 25, output_tokens: 1 } }, type: "message_start" })}\n\n`,
  `event: content_block_delta\ndata: ${JSON.stringify({ delta: { text: "Hello", type: "text_delta" }, index: 0, type: "content_block_delta" })}\n\n`,
  `event: content_block_delta\ndata: ${JSON.stringify({ delta: { text: " world", type: "text_delta" }, index: 0, type: "content_block_delta" })}\n\n`,
  `event: message_delta\ndata: ${JSON.stringify({ delta: { stop_reason: "end_turn" }, type: "message_delta", usage: { output_tokens: 42 } })}\n\n`,
  `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
];

export type UpstreamMode = "stream" | "json" | "rate_limited" | "hang";

export interface RecordedRequest {
  readonly body: string;
  readonly headers: Headers;
  readonly path: string;
}

export interface FakeAnthropic {
  aborted: number;
  readonly baseUrl: string;
  readonly close: () => void;
  /** Fraction (0..1) reported in the plan-utilization headers; null to omit meter headers. */
  sessionUtilization: number | null;
  mode: UpstreamMode;
  readonly requests: RecordedRequest[];
}

const encoder = new TextEncoder();

export const startFakeAnthropic = (): FakeAnthropic => {
  const state: FakeAnthropic = {
    aborted: 0,
    baseUrl: "",
    close: () => {
      // replaced once the server is listening
    },
    mode: "stream",
    requests: [],
    sessionUtilization: 0.1,
  };
  const meterHeaders = (): Record<string, string> =>
    state.sessionUtilization === null
      ? {}
      : {
          "anthropic-organization-id": "org-secret-owner",
          "anthropic-ratelimit-unified-5h-reset": "1900000000",
          "anthropic-ratelimit-unified-5h-utilization": String(
            state.sessionUtilization
          ),
          "anthropic-ratelimit-unified-7d-reset": "1900500000",
          "anthropic-ratelimit-unified-7d-utilization": "0.2",
        };

  const server = Bun.serve({
    fetch: async (req) => {
      const url = new URL(req.url);
      const body = await req.text();
      if (body.includes(`"model":"${PROBE_MODEL}"`)) {
        return Response.json(
          {
            content: [{ text: "p", type: "text" }],
            model: PROBE_MODEL,
            usage: { input_tokens: 1, output_tokens: 1 },
          },
          { headers: meterHeaders() }
        );
      }
      state.requests.push({ body, headers: req.headers, path: url.pathname });
      switch (state.mode) {
        case "rate_limited": {
          return Response.json(
            { error: { message: "rate limited", type: "rate_limit_error" } },
            { headers: { ...meterHeaders(), "retry-after": "1" }, status: 429 }
          );
        }
        case "json": {
          return Response.json(
            {
              content: [{ text: "hi", type: "text" }],
              model: "claude-test-1",
              usage: { input_tokens: 11, output_tokens: 7 },
            },
            { headers: { ...meterHeaders(), "request-id": "req_json" } }
          );
        }
        case "hang": {
          const stream = new ReadableStream<Uint8Array>({
            cancel: () => {
              state.aborted += 1;
            },
            start: (controller) => {
              controller.enqueue(encoder.encode(SSE_EVENTS[0]));
            },
          });
          req.signal.addEventListener("abort", () => {
            state.aborted += 1;
          });
          return new Response(stream, {
            headers: { ...meterHeaders(), "content-type": "text/event-stream" },
          });
        }
        default: {
          const stream = new ReadableStream<Uint8Array>({
            // One event per tick so the agent sees several separate chunks.
            start: (controller) => {
              const emit = (index: number) => {
                const event = SSE_EVENTS[index];
                if (event === undefined) {
                  controller.close();
                  return;
                }
                controller.enqueue(encoder.encode(event));
                setTimeout(() => emit(index + 1), CHUNK_GAP_MS);
              };
              emit(0);
            },
          });
          return new Response(stream, {
            headers: {
              ...meterHeaders(),
              "content-type": "text/event-stream",
              "request-id": "req_stream",
            },
          });
        }
      }
    },
    port: 0,
  });
  return Object.assign(state, {
    baseUrl: `http://127.0.0.1:${server.port}`,
    close: () => {
      server.stop(true);
    },
  });
};

// ---------------------------------------------------------------- agent

export interface AgentHandle {
  readonly configDir: string;
  readonly status: () => StatusSnapshot | null;
  readonly stop: () => Promise<void>;
}

export const testConfig = (
  gatewayUrl: string,
  cliProxyApiUrl: string,
  overrides: Partial<AgentConfig> = {}
): AgentConfig => ({
  backoffBaseMs: 50,
  backoffMaxMs: 200,
  cliProxyApi: {
    apiKey: Redacted.make(TEST_CREDENTIAL),
    baseUrl: cliProxyApiUrl,
    configPath: "test/config.yaml",
    probeModels: { anthropic: PROBE_MODEL },
  },
  configDir: mkdtempSync(path.join(tmpdir(), "rentanllm-node-test-")),
  gatewayUrl,
  heartbeatIntervalMs: 100,
  keepAwake: false,
  meterProbe: true,
  nodeId: "node-test",
  nodeToken: Redacted.make(NODE_TOKEN),
  ollama: null,
  rateLimitCooloffMs: 60_000,
  stableAfterMs: 0,
  ...overrides,
});

export const fixedMeters = (meters: UsageMeters | null) =>
  Layer.succeed(MeterReader, {
    detect: () => Effect.void,
    observe: () => Effect.void,
    read: () => Effect.succeed(meters),
    refreshIfStale: () => Effect.void,
  });

export const startAgent = (
  config: AgentConfig,
  options: { meters?: Layer.Layer<MeterReader> } = {}
): AgentHandle => {
  const credentials = Layer.succeed(CredentialStore, {
    get: () => Effect.succeed(Redacted.make(TEST_CREDENTIAL)),
  });
  const fiber = Effect.runFork(
    runAgent(config, {
      credentials,
      wakeLock: WakeLockTest,
      ...(options.meters ? { meters: options.meters } : {}),
    })
  );
  return {
    configDir: config.configDir,
    status: () => {
      try {
        return JSON.parse(
          readFileSync(path.join(config.configDir, "status.json"), "utf-8")
        ) as StatusSnapshot;
      } catch {
        return null;
      }
    },
    stop: async () => {
      await Effect.runPromise(Fiber.interrupt(fiber));
    },
  };
};

export const framesOf = <T extends NodeToGateway["_tag"]>(
  gateway: FakeGateway,
  tag: T
): Extract<NodeToGateway, { _tag: T }>[] =>
  gateway.frames.filter(
    (f): f is Extract<NodeToGateway, { _tag: T }> => f._tag === tag
  );

export const forRequest = (gateway: FakeGateway, requestId: string) =>
  gateway.frames.filter((f) => "requestId" in f && f.requestId === requestId);
