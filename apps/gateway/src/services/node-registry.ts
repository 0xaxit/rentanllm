import type { Provider } from "@rentanllm/protocol";
import { Context } from "effect";
import type { Effect } from "effect";

import type { MeterReading, NodeAvailability, NodeRecord } from "../domain.ts";
import type { StoreError } from "./store-error.ts";

/** Why a tunnel session ended (`lost` is written later, for a gateway restart). */
export type SessionEndReason = "closed" | "replaced" | "stale";

/**
 * Durable node facts: who a tunnel token belongs to, and the latest meters each node
 * reported. Live connection state (which nodes are connected to THIS gateway process)
 * is held by the TunnelHub, not here.
 */
export class NodeRegistry extends Context.Service<
  NodeRegistry,
  {
    /** Looks up a node by the lowercase SHA-256 hex digest of its tunnel token. */
    readonly findByTokenHash: (
      tokenHash: string
    ) => Effect.Effect<NodeRecord | null, StoreError>;
    /**
     * The owner's current availability for the node, from its listings; null when it has
     * no listing that is not a draft. Read on every heartbeat, so listing changes reach a
     * connected node without it reconnecting.
     */
    readonly availability: (
      nodeId: string
    ) => Effect.Effect<NodeAvailability | null, StoreError>;
    readonly latestMeters: (
      nodeId: string,
      provider: Provider
    ) => Effect.Effect<MeterReading | null, StoreError>;
    /**
     * A tunnel finished NodeHello: the node is online on this connection.
     * Opens an uptime session and returns its id (null when not persisted).
     */
    readonly recordConnect: (
      nodeId: string,
      agentVersion: string
    ) => Effect.Effect<string | null, StoreError>;
    /** Where the node connects from (see region.ts). */
    readonly recordRegion: (
      nodeId: string,
      region: string
    ) => Effect.Effect<void, StoreError>;
    /** Closes an uptime session opened by `recordConnect`. */
    readonly recordSessionEnd: (
      sessionId: string,
      reason: SessionEndReason
    ) => Effect.Effect<void, StoreError>;
    /** The node's tunnel closed. */
    readonly recordDisconnect: (
      nodeId: string
    ) => Effect.Effect<void, StoreError>;
    /** Replaces the latest reading per provider (also counts as a heartbeat). */
    readonly recordMeters: (
      nodeId: string,
      readings: readonly MeterReading[]
    ) => Effect.Effect<void, StoreError>;
  }
>()("@rentanllm/gateway/NodeRegistry") {}
