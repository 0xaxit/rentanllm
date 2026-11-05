import { Data } from "effect";

/** The x402 facilitator could not be reached or answered with garbage. */
export class FacilitatorError extends Data.TaggedError("FacilitatorError")<{
  readonly cause: unknown;
  readonly operation: "verify" | "settle" | "supported";
}> {}
