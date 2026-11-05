import { createHash } from "node:crypto";

/** Lowercase SHA-256 hex digest, used to look up API keys and node tokens. */
export const sha256Hex = (value: string): string =>
  createHash("sha256").update(value, "utf-8").digest("hex");
