import { Redacted } from "effect";

import type { ApiConfigShape } from "../config";
import { hmacSha256Hex, randomToken } from "../crypto";

/** Keyed hash stored in sessions.token_hash: a leaked table cannot be replayed as cookies. */
export const sessionTokenHash = (
  config: ApiConfigShape,
  token: string
): string => hmacSha256Hex(Redacted.value(config.sessionSecret), token);

export const newSessionToken = (): string => randomToken();
