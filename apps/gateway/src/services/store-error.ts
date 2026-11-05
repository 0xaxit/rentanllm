import { Data } from "effect";

/**
 * Infrastructure failure inside a store (database or Redis down, timeout...). The in-memory
 * layers never fail; Postgres/Redis layers map their driver errors to this.
 * The renter sees a 500 `api_error`.
 */
export class StoreError extends Data.TaggedError("StoreError")<{
  readonly cause: unknown;
  readonly store: string;
}> {}
