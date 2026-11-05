/**
 * Test helpers: start the real gateway on a random port, and a fake node agent that
 * dials the tunnel over a real WebSocket and answers ProxyRequests with canned output.
 */
import { setTimeout as sleep } from "node:timers/promises";

import { PROTOCOL_VERSION } from "@rentanllm/protocol";
import type {
  GatewayToNode,
  NodeToGateway,
  Provider,
  ProviderUsage,
  UsageMeters,
} from "@rentanllm/protocol";
import { Context, Effect, Exit, Layer, Logger, Scope } from "effect";
import { HttpServer } from "effect/http";
import { WebSocket } from "ws";

import { gatewayLayer } from "../src/app.ts";
import type { StoreServices } from "../src/app.ts";
import { defaultSettings } from "../src/config.ts";
import type { GatewaySettings, Settings } from "../src/config.ts";
import { makeMemoryState, memoryStoresLayer } from "../src/services/memory.ts";
import type { MemoryState, Seed } from "../src/services/memory.ts";
import type { X402Facilitator } from "../src/x402/facilitator.ts";
import { makeFakeFacilitator } from "./fake-facilitator.ts";
import type { FakeFacilitator } from "./fake-facilitator.ts";

export interface RunningGateway<S = MemoryState> {
  readonly baseUrl: string;
  readonly close: () => Promise<void>;
  readonly facilitator: FakeFacilitator;
  readonly state: S;
  readonly tunnelUrl: string;
}

export const testLogger = Logger.layer(
  process.env.GATEWAY_TEST_LOGS === "1" ? [Logger.consolePretty()] : []
);

/** Starts the gateway over any store layer, with the fake x402 facilitator. */
export const startGatewayWith = async <S, E>(
  stores: Layer.Layer<StoreServices, E, Settings>,
  state: S,
  settings: Partial<GatewaySettings> = {}
): Promise<RunningGateway<S>> => {
  const facilitator = makeFakeFacilitator();
  const layer = gatewayLayer({
    facilitator: facilitator.layer as Layer.Layer<X402Facilitator>,
    host: "127.0.0.1",
    port: 0,
    // Fake nodes rarely answer a CancelRequest; keep the wait for it short.
    settings: { ...defaultSettings, cancelUsageWaitMs: 500, ...settings },
    stores,
  }).pipe(
    // Silence logs unless GATEWAY_TEST_LOGS=1.
    Layer.provide(testLogger)
  );
  const scope = Effect.runSync(Scope.make());
  const context = await Effect.runPromise(Layer.buildWithScope(layer, scope));
  const { address } = Context.get(context, HttpServer.HttpServer);
  if (address._tag === "UnixPathAddress") {
    throw new Error("expected a TCP address");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
    facilitator,
    state,
    tunnelUrl: `ws://127.0.0.1:${address.port}/tunnel`,
  };
};

export const startGateway = (
  seed: Seed,
  settings: Partial<GatewaySettings> = {}
): Promise<RunningGateway> => {
  const state = makeMemoryState(seed);
  return startGatewayWith(memoryStoresLayer(state), state, settings);
};

export type ProxyRequest = Extract<GatewayToNode, { _tag: "ProxyRequest" }>;

export interface FakeNode {
  readonly close: () => Promise<void>;
  readonly closed: Promise<number>;
  readonly received: GatewayToNode[];
  readonly send: (message: NodeToGateway) => void;
  readonly sendHeartbeat: (meters: UsageMeters) => void;
  /** Resolves when a message matching `predicate` has been received. */
  readonly waitFor: (
    predicate: (message: GatewayToNode) => boolean,
    timeoutMs?: number
  ) => Promise<GatewayToNode>;
}

export type ProxyHandler = (request: ProxyRequest, node: FakeNode) => void;

interface FakeNodeOptions {
  readonly meters?: UsageMeters;
  readonly nodeId: string;
  readonly onProxy?: ProxyHandler;
  /** Providers announced in NodeHello (default anthropic). */
  readonly providers?: readonly Provider[];
  readonly token: string;
  readonly url: string;
}

const DEFAULT_WAIT_MS = 3000;

export const connectFakeNode = async (
  options: FakeNodeOptions
): Promise<FakeNode> => {
  const socket = new WebSocket(options.url, {
    headers: { authorization: `Bearer ${options.token}` },
  });
  const received: GatewayToNode[] = [];
  const waiters: {
    predicate: (m: GatewayToNode) => boolean;
    resolve: (m: GatewayToNode) => void;
  }[] = [];
  const opened = Promise.withResolvers<boolean>();
  const closed = Promise.withResolvers<number>();
  socket.on("open", () => opened.resolve(true));
  socket.on("close", (code) => closed.resolve(code));
  socket.on("unexpected-response", (_req, res) => {
    opened.reject(new Error(`unexpected response ${res.statusCode}`));
  });
  socket.on("error", (cause) => opened.reject(cause));

  const send = (message: NodeToGateway) => {
    socket.send(JSON.stringify(message));
  };
  const providers = [...(options.providers ?? ["anthropic"])];
  const meteredProvider = providers[0] ?? "anthropic";
  const node: FakeNode = {
    close: async () => {
      socket.close(1000);
      await closed.promise;
    },
    closed: closed.promise,
    received,
    send,
    sendHeartbeat: (meters) =>
      send({
        _tag: "Heartbeat",
        at: new Date().toISOString(),
        meters: [{ meters, provider: meteredProvider }],
      }),
    waitFor: (predicate, timeoutMs = DEFAULT_WAIT_MS) => {
      const found = received.find(predicate);
      if (found !== undefined) {
        return Promise.resolve(found);
      }
      const waiter = Promise.withResolvers<GatewayToNode>();
      const timer = setTimeout(
        () => waiter.reject(new Error("timed out waiting for message")),
        timeoutMs
      );
      waiters.push({
        predicate,
        resolve: (m) => {
          clearTimeout(timer);
          waiter.resolve(m);
        },
      });
      return waiter.promise;
    },
  };

  socket.on("message", (data) => {
    const message = JSON.parse(String(data)) as GatewayToNode;
    received.push(message);
    for (const waiter of waiters.splice(0)) {
      if (waiter.predicate(message)) {
        waiter.resolve(message);
      } else {
        waiters.push(waiter);
      }
    }
    if (message._tag === "ProxyRequest") {
      options.onProxy?.(message, node);
    }
  });

  await opened.promise;
  send({
    _tag: "NodeHello",
    agentVersion: "fake-1.0.0",
    nodeId: options.nodeId,
    protocolVersion: PROTOCOL_VERSION,
    providers,
  });
  if (options.meters !== undefined) {
    node.sendHeartbeat(options.meters);
  }
  // Give the gateway a moment to register hello and meters.
  await sleep(50);
  return node;
};

export const freshMeters = (
  sessionUsedPct: number,
  weeklyUsedPct = 10
): UsageMeters => ({
  readAt: new Date().toISOString(),
  sessionResetsAt: new Date(Date.now() + 3_600_000).toISOString(),
  sessionUsedPct,
  weeklyResetsAt: new Date(Date.now() + 86_400_000).toISOString(),
  weeklyUsedPct,
});

export const CANNED_USAGE: ProviderUsage = {
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  inputTokens: 12,
  model: "claude-test",
  outputTokens: 3,
};

const sse = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** An Anthropic-style stream that generates "Hello world". */
export const CANNED_SSE = [
  sse("message_start", {
    message: { id: "msg_1", model: "claude-test", usage: { input_tokens: 12 } },
    type: "message_start",
  }),
  sse("content_block_start", {
    content_block: { text: "", type: "text" },
    index: 0,
    type: "content_block_start",
  }),
  sse("content_block_delta", {
    delta: { text: "Hello", type: "text_delta" },
    index: 0,
    type: "content_block_delta",
  }),
  sse("content_block_delta", {
    delta: { text: " world", type: "text_delta" },
    index: 0,
    type: "content_block_delta",
  }),
  sse("content_block_stop", { index: 0, type: "content_block_stop" }),
  sse("message_delta", {
    delta: { stop_reason: "end_turn" },
    type: "message_delta",
    usage: { output_tokens: 3 },
  }),
  sse("message_stop", { type: "message_stop" }),
];

export const CANNED_JSON = JSON.stringify({
  content: [{ text: "Hello world", type: "text" }],
  id: "msg_2",
  model: "claude-test",
  role: "assistant",
  type: "message",
  usage: { input_tokens: 12, output_tokens: 3 },
});

/** Answers every ProxyRequest with the canned stream (or JSON when stream is false). */
export const cannedResponder: ProxyHandler = (request, node) => {
  const body = JSON.parse(request.body) as { stream?: boolean };
  const { requestId } = request;
  if (body.stream === true) {
    node.send({
      _tag: "ResponseHead",
      headers: {
        "anthropic-ratelimit-tokens-remaining": "123",
        "content-type": "text/event-stream",
        "request-id": "upstream-1",
      },
      requestId,
      status: 200,
    });
    for (const data of CANNED_SSE) {
      node.send({ _tag: "ResponseChunk", data, requestId });
    }
  } else {
    node.send({
      _tag: "ResponseHead",
      headers: { "content-type": "application/json" },
      requestId,
      status: 200,
    });
    node.send({ _tag: "ResponseChunk", data: CANNED_JSON, requestId });
  }
  node.send({ _tag: "ResponseEnd", requestId, usage: CANNED_USAGE });
};

const POLL_MS = 10;

export const waitUntil = async (
  condition: () => boolean,
  timeoutMs = DEFAULT_WAIT_MS
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  const poll = async (): Promise<void> => {
    if (condition()) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error("condition not met in time");
    }
    await sleep(POLL_MS);
    await poll();
  };
  await poll();
};
