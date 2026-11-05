import type { Provider } from "@rentanllm/protocol";
import { Context, Effect, Layer, Ref } from "effect";

/** Owner availability as last set by the gateway. Starts closed: the node fails closed. */
export interface Availability {
  readonly open: boolean;
  readonly sessionCutoffPct: number;
  readonly weeklyCutoffPct: number;
}

export const CLOSED: Availability = {
  open: false,
  sessionCutoffPct: 0,
  weeklyCutoffPct: 0,
};

export interface ConnectionStatus {
  readonly connected: boolean;
  readonly connectedAt: string | null;
  readonly lastError: string | null;
  readonly lastHeartbeatAt: string | null;
  readonly reconnects: number;
}

export interface NodeStateShape {
  readonly availability: Ref.Ref<Availability>;
  /** Per-provider epoch ms until which the circuit breaker refuses new requests. */
  readonly circuitOpenUntil: Ref.Ref<ReadonlyMap<Provider, number>>;
  readonly connection: Ref.Ref<ConnectionStatus>;
  readonly inFlight: Ref.Ref<number>;
}

export class NodeState extends Context.Service<NodeState, NodeStateShape>()(
  "rentanllm/NodeState"
) {}

export const makeNodeState: Effect.Effect<NodeStateShape> = Effect.gen(
  function* makeNodeState() {
    return {
      availability: yield* Ref.make(CLOSED),
      circuitOpenUntil: yield* Ref.make<ReadonlyMap<Provider, number>>(
        new Map()
      ),
      connection: yield* Ref.make<ConnectionStatus>({
        connected: false,
        connectedAt: null,
        lastError: null,
        lastHeartbeatAt: null,
        reconnects: 0,
      }),
      inFlight: yield* Ref.make(0),
    };
  }
);

export const NodeStateLive = Layer.effect(NodeState, makeNodeState);

/** Trips the per-provider circuit breaker until `untilMs`. */
export const tripCircuit = (
  state: NodeStateShape,
  provider: Provider,
  untilMs: number
): Effect.Effect<void> =>
  Ref.update(
    state.circuitOpenUntil,
    (current) =>
      new Map([
        ...current,
        [provider, Math.max(untilMs, current.get(provider) ?? 0)],
      ])
  );
