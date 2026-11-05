import { Effect } from "effect";

/**
 * Captures services `R` when a handler group is built and returns a function that
 * provides them to a request effect. Handlers then need nothing from the router at
 * request time, and each group can be built (and tested) with only its own services.
 */
export const captureServices = <R>() =>
  Effect.map(
    Effect.context<R>(),
    (services) =>
      <A, E, R2>(effect: Effect.Effect<A, E, R2>) =>
        Effect.provideContext(effect, services)
  );
