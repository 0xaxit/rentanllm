/** Small conversions shared by the Postgres stores. */
import type { Micros } from "@rentanllm/core";

export const toMicros = (value: bigint | string | number): Micros =>
  typeof value === "bigint" ? value : BigInt(value);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Ids are uuids; anything else cannot match and must not reach a uuid cast. */
export const isUuid = (value: string): boolean => UUID.test(value);
