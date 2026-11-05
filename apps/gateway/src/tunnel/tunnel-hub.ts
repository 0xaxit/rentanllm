/**
 * The tunnel hub: tracks node agents connected to this gateway process, routes
 * ProxyRequests to them and fans their responses back out by requestId.
 */
import {
  GatewayToNodeJson,
  HEARTBEAT_INTERVAL_MS,
  MISSED_HEARTBEATS_BEFORE_PAUSE,
  NodeToGatewayJson,
  PROTOCOL_VERSION,
  TUNNEL_CLOSE_CODES,
} from "@rentanllm/protocol";
import type {
  GatewayToNode,
  NodeToGateway,
  Provider,
  ProviderUsage,
} from "@rentanllm/protocol";
import type { Cause, Scope } from "effect";
import {
  Clock,
  Context,
  Effect,
  Exit,
  Layer,
  Metric,
  Queue,
  Schedule,
  Schema,
  Stream,
} from "effect";
import { Socket } from "effect/socket";

import { Settings } from "../config.ts";
import type { MeterReading, NodeAvailability, NodeRecord } from "../domain.ts";
import { NodeUnavailable } from "../errors.ts";
import { activeTunnels, countHeartbeat, nodesConnected } from "../metrics.ts";
import { NodeRegistry } from "../services/node-registry.ts";
import type { SessionEndReason } from "../services/node-registry.ts";

/** Messages a node sends about one proxied request. */
export type NodeEvent = Extract<
  NodeToGateway,
  {
    readonly _tag:
      | "ResponseHead"
      | "ResponseChunk"
      | "ResponseEnd"
      | "ResponseError";
  }
>;

type NodeHello = Extract<NodeToGateway, { readonly _tag: "NodeHello" }>;
type Heartbeat = Extract<NodeToGateway, { readonly _tag: "Heartbeat" }>;

export type ProxyRequestFields = Omit<
  Extract<GatewayToNode, { readonly _tag: "ProxyRequest" }>,
  "_tag"
>;

/** A node is paused after this long without any frame. */
export const NODE_STALE_AFTER_MS =
  HEARTBEAT_INTERVAL_MS * MISSED_HEARTBEATS_BEFORE_PAUSE;
/** What a node assumes until told otherwise: closed, so it fails closed. */
const CLOSED: NodeAvailability = {
  open: false,
  sessionCutoffPct: 0,
  weeklyCutoffPct: 0,
};

const sameAvailability = (a: NodeAvailability, b: NodeAvailability) =>
  a.open === b.open &&
  a.sessionCutoffPct === b.sessionCutoffPct &&
  a.weeklyCutoffPct === b.weeklyCutoffPct;

/** Events buffered per request before the renter is considered too slow. */
const MAX_BUFFERED_EVENTS = 4096;

/** WebSocket close codes the hub uses (shared with the node agent). */
export const CloseCodes = TUNNEL_CLOSE_CODES;

interface Connection {
  /** Last availability sent to the node (CLOSED before the first). */
  availability: NodeAvailability;
  readonly close: (code: number, reason: string) => Effect.Effect<void>;
  readonly connId: number;
  /** Set when the gateway ends the tunnel itself; otherwise the node closed it. */
  endReason: SessionEndReason | null;
  lastSeenAtMs: number;
  readonly nodeId: string;
  readonly providers: readonly Provider[];
  readonly send: (message: GatewayToNode) => Effect.Effect<void>;
  /** Uptime session row (null until recorded, or when not persisted). */
  sessionId: string | null;
}

interface Pending {
  readonly connId: number;
  done: boolean;
  readonly nodeId: string;
  readonly queue: Queue.Queue<NodeEvent, Cause.Done>;
}

export interface Dispatched {
  /**
   * Usage the node reported after the gateway cancelled the request (renter went away),
   * once the dispatch scope has closed; null when none arrived in time.
   */
  readonly cancelledUsage: () => ProviderUsage | null;
  /** Events for this request, ending after ResponseEnd or ResponseError. */
  readonly events: Queue.Dequeue<NodeEvent, Cause.Done>;
}

export interface NodeStatus {
  readonly lastSeenAt: Date;
  readonly nodeId: string;
  readonly providers: readonly Provider[];
}

export class TunnelHub extends Context.Service<
  TunnelHub,
  {
    /** Nodes currently connected to this process. */
    readonly connected: Effect.Effect<readonly NodeStatus[]>;
    /**
     * Sends a ProxyRequest to the node. When the current scope closes before the node
     * finished the request (renter went away), a CancelRequest is sent and the scope's
     * close waits up to `cancelUsageWaitMs` for the node's final frame, whose usage is
     * then available from `cancelledUsage`.
     */
    readonly dispatch: (
      nodeId: string,
      request: ProxyRequestFields
    ) => Effect.Effect<Dispatched, NodeUnavailable, Scope.Scope>;
    /** Connected, said hello, serves `provider`, and seen within the heartbeat budget. */
    readonly isOnline: (
      nodeId: string,
      provider: Provider
    ) => Effect.Effect<boolean>;
    /** Runs one authenticated node connection until it closes. */
    readonly serve: (
      node: NodeRecord,
      socket: Socket.Socket
    ) => Effect.Effect<void>;
  }
>()("@rentanllm/gateway/TunnelHub") {}

const encodeOutgoing = Schema.encodeSync(GatewayToNodeJson);
const decodeIncoming = Schema.decodeUnknownExit(NodeToGatewayJson);

const isTerminal = (event: NodeEvent) =>
  event._tag === "ResponseEnd" || event._tag === "ResponseError";

export const TunnelHubLive = Layer.effect(TunnelHub)(
  Effect.gen(function* makeTunnelHub() {
    const registry = yield* NodeRegistry;
    const settings = yield* Settings;
    const connections = new Map<string, Connection>();
    const pending = new Map<string, Pending>();
    let nextConnId = 1;
    let openSockets = 0;

    const endSession = (conn: Connection) => {
      const { sessionId } = conn;
      conn.sessionId = null;
      return sessionId === null
        ? Effect.void
        : registry
            .recordSessionEnd(sessionId, conn.endReason ?? "closed")
            .pipe(
              Effect.catchTag("StoreError", (cause) =>
                Effect.logError("failed to record node session end", cause)
              )
            );
    };

    const markOffline = (nodeId: string) =>
      registry
        .recordDisconnect(nodeId)
        .pipe(
          Effect.catchTag("StoreError", (cause) =>
            Effect.logError("failed to record node disconnect", cause)
          )
        );

    const reportGauges = Effect.suspend(() =>
      Effect.asVoid(
        Effect.all([
          Metric.update(activeTunnels, openSockets),
          Metric.update(nodesConnected, connections.size),
        ])
      )
    );

    const finishPending = (requestId: string, event: NodeEvent | null) => {
      const entry = pending.get(requestId);
      if (entry === undefined) {
        return;
      }
      if (event !== null) {
        Queue.offerUnsafe(entry.queue, event);
      }
      entry.done = true;
      pending.delete(requestId);
      Queue.endUnsafe(entry.queue);
    };

    const failPendingFor = (connId: number, message: string) => {
      for (const [requestId, entry] of pending) {
        if (entry.connId === connId) {
          finishPending(requestId, {
            _tag: "ResponseError",
            code: "internal",
            message,
            requestId,
          });
        }
      }
    };

    const isFresh = (conn: Connection, nowMs: number) =>
      nowMs - conn.lastSeenAtMs <= NODE_STALE_AFTER_MS;

    const routeEvent = (conn: Connection, event: NodeEvent) =>
      Effect.gen(function* routeNodeEvent() {
        const entry = pending.get(event.requestId);
        if (entry === undefined) {
          // Late frames for cancelled or finished requests are expected.
          return;
        }
        if (entry.nodeId !== conn.nodeId || entry.connId !== conn.connId) {
          yield* Effect.logWarning(
            "node sent a frame for a request it does not own"
          ).pipe(Effect.annotateLogs({ requestId: event.requestId }));
          return;
        }
        if (isTerminal(event)) {
          finishPending(event.requestId, event);
          return;
        }
        if (Queue.sizeUnsafe(entry.queue) >= MAX_BUFFERED_EVENTS) {
          yield* Effect.logWarning(
            "renter is not reading fast enough; cancelling request"
          ).pipe(Effect.annotateLogs({ requestId: event.requestId }));
          finishPending(event.requestId, {
            _tag: "ResponseError",
            code: "internal",
            message: "response buffer overflow",
            requestId: event.requestId,
          });
          yield* conn.send({
            _tag: "CancelRequest",
            requestId: event.requestId,
          });
          return;
        }
        Queue.offerUnsafe(entry.queue, event);
      });

    const recordHeartbeat = (
      conn: Connection,
      message: Heartbeat,
      nowMs: number
    ) => {
      const receivedAt = new Date(nowMs);
      const readings: MeterReading[] = message.meters.map((m) => ({
        meters: m.meters,
        provider: m.provider,
        receivedAt,
      }));
      return registry
        .recordMeters(conn.nodeId, readings)
        .pipe(
          Effect.catchTag("StoreError", (cause) =>
            Effect.logError("failed to store node meters", cause)
          )
        );
    };

    /**
     * Re-reads the owner's availability and sends it when it changed, so a listing that
     * goes live, pauses or changes cut-offs reaches the node within a heartbeat. No
     * listing (null) means closed.
     */
    const syncAvailability = (conn: Connection) =>
      Effect.gen(function* syncNodeAvailability() {
        const current = (yield* registry.availability(conn.nodeId)) ?? CLOSED;
        if (sameAvailability(current, conn.availability)) {
          return;
        }
        conn.availability = current;
        yield* conn.send({ _tag: "SetAvailability", ...current });
        yield* Effect.logInfo("node availability changed").pipe(
          Effect.annotateLogs({ nodeId: conn.nodeId, open: current.open })
        );
      }).pipe(
        Effect.catchTag("StoreError", (cause) =>
          Effect.logError("failed to read node availability", cause)
        )
      );

    const serve = (node: NodeRecord, socket: Socket.Socket) =>
      Effect.suspend(() => {
        const connId = nextConnId;
        nextConnId += 1;
        const state: { closed: boolean; conn: Connection | null } = {
          closed: false,
          conn: null,
        };

        openSockets += 1;
        const cleanup = Effect.suspend(() => {
          openSockets -= 1;
          state.closed = true;
          const { conn } = state;
          if (conn === null) {
            return reportGauges;
          }
          const wasCurrent = connections.get(conn.nodeId)?.connId === connId;
          if (wasCurrent) {
            connections.delete(conn.nodeId);
          }
          failPendingFor(connId, "node disconnected");
          return Effect.asVoid(
            Effect.all([
              reportGauges,
              Effect.logInfo("node disconnected"),
              endSession(conn),
              wasCurrent ? markOffline(conn.nodeId) : Effect.void,
            ])
          );
        });

        return Effect.gen(function* serveNode() {
          yield* reportGauges;
          const writer = yield* socket.writer;
          const pull = yield* Socket.readerString(socket);

          const close = (code: number, reason: string) =>
            writer
              .write(new Socket.CloseEvent(code, reason))
              .pipe(Effect.ignore);
          const send = (message: GatewayToNode) =>
            writer
              .write(encodeOutgoing(message))
              .pipe(
                Effect.catchTag("SocketError", (cause) =>
                  Effect.logWarning("failed to write to node", cause)
                )
              );

          yield* Effect.sleep(settings.nodeHelloTimeoutMs).pipe(
            Effect.andThen(
              Effect.suspend(() =>
                state.conn === null
                  ? close(CloseCodes.helloTimeout, "NodeHello not received")
                  : Effect.void
              )
            ),
            Effect.forkScoped
          );

          const onHello = (message: NodeHello, nowMs: number) =>
            Effect.gen(function* onNodeHello() {
              if (message.nodeId !== node.nodeId) {
                yield* close(
                  CloseCodes.wrongNode,
                  "token does not match nodeId"
                );
                return;
              }
              if (message.protocolVersion !== PROTOCOL_VERSION) {
                yield* close(
                  CloseCodes.protocolError,
                  `unsupported protocol version ${message.protocolVersion}`
                );
                return;
              }
              const previous = connections.get(node.nodeId);
              const conn: Connection = {
                availability: CLOSED,
                close,
                connId,
                endReason: null,
                lastSeenAtMs: nowMs,
                nodeId: node.nodeId,
                providers: message.providers,
                send,
                sessionId: null,
              };
              state.conn = conn;
              connections.set(node.nodeId, conn);
              yield* reportGauges;
              if (previous !== undefined) {
                failPendingFor(previous.connId, "node reconnected");
                previous.endReason = "replaced";
                yield* endSession(previous);
                yield* previous.close(CloseCodes.replaced, "replaced");
              }
              yield* Effect.logInfo("node connected").pipe(
                Effect.annotateLogs({
                  agentVersion: message.agentVersion,
                  providers: message.providers.join(","),
                })
              );
              conn.sessionId = yield* registry
                .recordConnect(node.nodeId, message.agentVersion)
                .pipe(
                  Effect.catchTag("StoreError", (cause) =>
                    Effect.as(
                      Effect.logError("failed to record node connect", cause),
                      null
                    )
                  )
                );
              if (state.closed) {
                // The tunnel closed while the session was being opened.
                yield* endSession(conn);
              }
              if (node.availability !== null) {
                conn.availability = node.availability;
                yield* send({ _tag: "SetAvailability", ...node.availability });
              }
            });

          const handleFrame = (text: string) =>
            Effect.gen(function* handleNodeFrame() {
              const decoded = decodeIncoming(text);
              if (Exit.isFailure(decoded)) {
                yield* Effect.logWarning("dropping malformed frame from node");
                return;
              }
              const message = decoded.value;
              const nowMs = yield* Clock.currentTimeMillis;
              const { conn } = state;
              if (conn === null) {
                yield* message._tag === "NodeHello"
                  ? onHello(message, nowMs)
                  : close(CloseCodes.protocolError, "NodeHello must be first");
                return;
              }
              conn.lastSeenAtMs = nowMs;
              switch (message._tag) {
                case "NodeHello": {
                  yield* Effect.logWarning("ignoring repeated NodeHello");
                  return;
                }
                case "Heartbeat": {
                  yield* countHeartbeat;
                  yield* recordHeartbeat(conn, message, nowMs);
                  yield* syncAvailability(conn);
                  return;
                }
                default: {
                  yield* routeEvent(conn, message);
                }
              }
            });

          while (true) {
            const frames = yield* pull;
            for (const frame of frames) {
              yield* handleFrame(frame);
            }
          }
        }).pipe(
          Effect.catchTag("SocketError", () => Effect.void),
          Effect.ensuring(cleanup),
          Effect.scoped,
          Effect.annotateLogs({ nodeId: node.nodeId }),
          Effect.withSpan("tunnel.connection", {
            attributes: { nodeId: node.nodeId },
          })
        );
      });

    const dispatch = (nodeId: string, request: ProxyRequestFields) =>
      Effect.gen(function* dispatchToNode() {
        const conn = connections.get(nodeId);
        const nowMs = yield* Clock.currentTimeMillis;
        if (conn === undefined || !isFresh(conn, nowMs)) {
          return yield* new NodeUnavailable({
            message: "The owner's node is offline. Try again later.",
          });
        }
        const queue = yield* Queue.unbounded<NodeEvent, Cause.Done>();
        const entry: Pending = {
          connId: conn.connId,
          done: false,
          nodeId,
          queue,
        };
        pending.set(request.requestId, entry);
        const late: { usage: ProviderUsage | null } = { usage: null };
        // The node answers a CancelRequest with ResponseError("cancelled") carrying the
        // usage so far; drain the queue until that terminal frame (or the wait runs out).
        const awaitCancelledUsage = Stream.fromQueue(queue).pipe(
          Stream.runForEach((event) =>
            Effect.sync(() => {
              if (isTerminal(event) && event.usage !== undefined) {
                late.usage = event.usage;
              }
            })
          ),
          Effect.timeoutOption(settings.cancelUsageWaitMs),
          Effect.asVoid
        );
        yield* Effect.addFinalizer(() =>
          Effect.suspend(() => {
            if (entry.done) {
              return Effect.void;
            }
            return conn
              .send({ _tag: "CancelRequest", requestId: request.requestId })
              .pipe(
                Effect.andThen(awaitCancelledUsage),
                Effect.ensuring(
                  Effect.sync(() => finishPending(request.requestId, null))
                )
              );
          })
        );
        yield* conn.send({ _tag: "ProxyRequest", ...request });
        return {
          cancelledUsage: () => late.usage,
          events: queue,
        } satisfies Dispatched;
      });

    yield* reportGauges;
    yield* Effect.gen(function* sweepStaleNodes() {
      const nowMs = yield* Clock.currentTimeMillis;
      for (const conn of connections.values()) {
        if (!isFresh(conn, nowMs)) {
          yield* Effect.logWarning(
            "node missed heartbeats; pausing it and closing the tunnel"
          ).pipe(Effect.annotateLogs({ nodeId: conn.nodeId }));
          connections.delete(conn.nodeId);
          conn.endReason = "stale";
          yield* reportGauges;
          failPendingFor(conn.connId, "node missed heartbeats");
          yield* conn.close(CloseCodes.heartbeatTimeout, "missed heartbeats");
          yield* markOffline(conn.nodeId);
        }
      }
    }).pipe(
      Effect.repeat(Schedule.spaced(HEARTBEAT_INTERVAL_MS)),
      Effect.forkScoped
    );

    return {
      connected: Effect.sync(() =>
        [...connections.values()].map((c) => ({
          lastSeenAt: new Date(c.lastSeenAtMs),
          nodeId: c.nodeId,
          providers: c.providers,
        }))
      ),
      dispatch,
      isOnline: (nodeId, provider) =>
        Clock.currentTimeMillis.pipe(
          Effect.map((nowMs) => {
            const conn = connections.get(nodeId);
            return (
              conn !== undefined &&
              isFresh(conn, nowMs) &&
              conn.providers.includes(provider)
            );
          })
        ),
      serve,
    };
  })
);
