import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Effect } from "effect";
import type { SqlError } from "effect/sql/SqlError";

export type DbError = EffectDrizzleQueryError | SqlError;

const DB_ERROR_TAGS: ReadonlySet<unknown> = new Set([
  "EffectDrizzleQueryError",
  "SqlError",
]);
const MAX_CAUSE_DEPTH = 8;

export const isDbError = (error: unknown): error is DbError =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  DB_ERROR_TAGS.has(error._tag);

/** True when `error`, or any error in its cause chain, names the Postgres constraint. */
export const violatesConstraint = (
  error: unknown,
  constraint: string
): boolean => {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== "object" || current === null) {
      return false;
    }
    if ("constraint" in current && current.constraint === constraint) {
      return true;
    }
    if (
      "message" in current &&
      typeof current.message === "string" &&
      current.message.includes(constraint)
    ) {
      return true;
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
};

const dieIfDbError = <E>(
  failure: E
): Effect.Effect<never, Exclude<E, DbError>> =>
  isDbError(failure)
    ? Effect.die(failure)
    : Effect.fail(failure as Exclude<E, DbError>);

/** Database failures are infrastructure problems: turn them into defects (HTTP 500). */
export const dieOnDbError = <A, E, R>(
  self: Effect.Effect<A, E, R>
): Effect.Effect<A, Exclude<E, DbError>, R> =>
  self.pipe(Effect.catch(dieIfDbError));
