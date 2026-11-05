import { Clock, Effect } from "effect";

/** The current time from Effect's Clock (TestClock-controllable in tests). */
export const currentDate = Clock.currentTimeMillis.pipe(
  Effect.map((ms) => new Date(ms))
);
