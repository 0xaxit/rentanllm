import { Schema } from "effect";

/**
 * `Schema.TaggedError` under a lowercase name: the error classes call it without `new`
 * to build their base class, which unicorn(throw-new-error) would otherwise flag.
 */
export const taggedErrorClass = Schema.TaggedError;
