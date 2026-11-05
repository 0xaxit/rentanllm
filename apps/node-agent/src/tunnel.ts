/**
 * Outbound WebSocket tunnel to the gateway. One socket carries many concurrent proxied
 * requests, multiplexed by requestId. Reconnects with capped exponential backoff + jitter.
 */
import {
  GatewayToNodeJson,
  NodeToGatewayJson,
  PROTOCOL_VERSION,
  NODE_AUTH_HEADER,
  nodeAuthHeaderValue,
} from "@rentanllm/protocol";
import type {
  GatewayToNode,
  NodeToGateway,
  Provider,
  UsageMeters,
} from "@rentanllm/protocol";
import {
  Data,
  Duration,
  Effect,
  FiberMap,
  Redacted,
  Ref,
  Schedule,
  Schema,
} from "effect";
import { Socket } from "effect/socket";

import { NodeConfig } from "./config.ts";
import { MeterReader } from "./meters.ts";
import { Providers } from "./providers/registry.ts";
import { serveProxyRequest } from "./proxy.ts";
import type { Send } from "./proxy.ts";
import { NodeState } from "./state.ts";
import { writeStatus } from "./status.ts";
import { AGENT_VERSION, USER_AGENT } from "./version.ts";
import { WakeLock } from "./wake-lock.ts";

const OPEN_TIMEOUT = "10 seconds";
const BACKOFF_FACTOR = 2;

/** The tunnel could not be (re)established, or dropped before it was stable. */
export class TunnelError extends Data.TaggedError("TunnelError")<{
  readonly message: string;
}> {}

const decoder = new TextDecoder();
const encodeFrame = Schema.encodeSync(NodeToGatewayJson);
const decodeFrame = Schema.decodeUnknownExit(GatewayToNodeJson);

const describe = (cause: unknown): string => {
  if (Socket.isSocketError(cause)) {
    const { reason } = cause;
    return reason._tag === "SocketCloseError"
      ? `closed (code ${reason.code})`
      : reason._tag;
  }
  return cause instanceof Error ? cause.message : String(cause);
};

/** Capped exponential backoff with ±20% jitter. */
export const reconnectSchedule = (baseMs: number, maxMs: number) =>
  Schedule.exponential(Duration.millis(baseMs), BACKOFF_FACTOR).pipe(
    Schedule.modifyDelay((meta) =>
      Effect.succeed(Duration.min(meta.duration, Duration.millis(maxMs)))
    ),
    Schedule.jittered
  );

const heartbeat = (send: Send) =>
  Effect.gen(function* heartbeatProgram() {
    const providers = yield* Providers;
    const meterReader = yield* MeterReader;
    const state = yield* NodeState;
    const { open } = yield* Ref.get(state.availability);
    const meters: { meters: UsageMeters; provider: Provider }[] = [];
    for (const provider of providers.adapters.keys()) {
      yield* open
        ? meterReader.refreshIfStale(provider)
        : meterReader.detect(provider);
      const reading = yield* meterReader.read(provider);
      if (reading !== null) {
        meters.push({ meters: reading, provider });
      }
    }
    const at = new Date().toISOString();
    yield* send({ _tag: "Heartbeat", at, meters });
    yield* Ref.update(state.connection, (c) => ({ ...c, lastHeartbeatAt: at }));
    yield* writeStatus(AGENT_VERSION);
  });

const applyAvailability = (
  message: Extract<GatewayToNode, { _tag: "SetAvailability" }>
) =>
  Effect.gen(function* applyAvailabilityProgram() {
    const state = yield* NodeState;
    const wakeLock = yield* WakeLock;
    yield* Ref.set(state.availability, {
      open: message.open,
      sessionCutoffPct: message.sessionCutoffPct,
      weeklyCutoffPct: message.weeklyCutoffPct,
    });
    yield* wakeLock.set(message.open);
    yield* Effect.logInfo(
      message.open
        ? `node open (session cut-off ${message.sessionCutoffPct}%, weekly cut-off ${message.weeklyCutoffPct}%)`
        : "node closed"
    );
    yield* writeStatus(AGENT_VERSION);
  });

/**
 * One connection lifetime. Fails with TunnelError if the dial fails or the connection drops
 * before `stableAfterMs` (so flapping is backed off); succeeds when a stable connection drops.
 */
export const runSession = Effect.gen(function* runSession() {
  const config = yield* NodeConfig;
  const providers = yield* Providers;
  const state = yield* NodeState;

  const socket = yield* Socket.makeWebSocket(config.gatewayUrl, {
    headers: {
      [NODE_AUTH_HEADER]: nodeAuthHeaderValue(Redacted.value(config.nodeToken)),
      "user-agent": USER_AGENT,
    },
    openTimeout: OPEN_TIMEOUT,
  });
  const reader = yield* socket.reader.pipe(
    Effect.mapError(
      (cause) => new TunnelError({ message: `dial failed: ${describe(cause)}` })
    )
  );
  const writer = yield* socket.writer;

  let alive = true;
  const send: Send = (message: NodeToGateway) =>
    Effect.suspend(() => {
      if (!alive) {
        return Effect.void;
      }
      let frame: string;
      try {
        frame = encodeFrame(message);
      } catch (error) {
        return Effect.logError(
          `dropping invalid frame ${message._tag}: ${describe(error)}`
        );
      }
      return writer.write(frame).pipe(Effect.ignore);
    });

  const connectedAtMs = Date.now();
  yield* send({
    _tag: "NodeHello",
    agentVersion: AGENT_VERSION,
    nodeId: config.nodeId,
    protocolVersion: PROTOCOL_VERSION,
    providers: [...providers.adapters.keys()],
  });
  yield* Ref.update(state.connection, (c) => ({
    ...c,
    connected: true,
    connectedAt: new Date(connectedAtMs).toISOString(),
    lastError: null,
  }));
  yield* Effect.logInfo(`connected to gateway as node ${config.nodeId}`);

  const requests = yield* FiberMap.make<string>();
  yield* heartbeat(send).pipe(
    Effect.repeat(Schedule.spaced(Duration.millis(config.heartbeatIntervalMs))),
    Effect.forkScoped
  );

  const dispatch = (message: GatewayToNode) => {
    switch (message._tag) {
      case "ProxyRequest": {
        return FiberMap.run(
          requests,
          message.requestId,
          serveProxyRequest(message, send),
          { onlyIfMissing: true }
        );
      }
      case "CancelRequest": {
        return FiberMap.remove(requests, message.requestId);
      }
      case "SetAvailability": {
        return applyAvailability(message);
      }
      default: {
        return Effect.void;
      }
    }
  };

  const readLoop = Effect.forever(
    Effect.gen(function* readLoop() {
      const frames = yield* reader.pull;
      for (const frame of frames) {
        const text = typeof frame === "string" ? frame : decoder.decode(frame);
        const decoded = decodeFrame(text);
        if (decoded._tag === "Failure") {
          yield* Effect.logWarning("ignoring malformed frame from gateway");
          continue;
        }
        yield* dispatch(decoded.value);
      }
    })
  );

  const dropped = yield* Effect.flip(readLoop);
  alive = false;
  const reason = describe(dropped);
  yield* Ref.update(state.connection, (c) => ({
    ...c,
    connected: false,
    lastError: reason,
    reconnects: c.reconnects + 1,
  }));
  yield* writeStatus(AGENT_VERSION);
  yield* Effect.logWarning(`gateway connection lost: ${reason}`);
  if (Date.now() - connectedAtMs < config.stableAfterMs) {
    return yield* new TunnelError({
      message: `connection unstable: ${reason}`,
    });
  }
}).pipe(Effect.scoped);

/** Runs the tunnel forever, reconnecting with backoff. */
export const runTunnel = Effect.gen(function* runTunnel() {
  const config = yield* NodeConfig;
  const state = yield* NodeState;
  const schedule = reconnectSchedule(config.backoffBaseMs, config.backoffMaxMs);
  const attempt = runSession.pipe(
    Effect.tapError((failure) =>
      Effect.andThen(
        Ref.update(state.connection, (c) => ({
          ...c,
          lastError: failure.message,
        })),
        Effect.logWarning(`${failure.message}; retrying with backoff`)
      )
    ),
    Effect.retry(schedule)
  );
  return yield* Effect.forever(attempt);
});
