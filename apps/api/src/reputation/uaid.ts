/**
 * HCS-14 Universal Agent IDs (Hashgraph Online, draft). A deterministic AID is the
 * base58 SHA-384 of six canonical fields; routing parameters follow after `;`:
 *
 *   uaid:aid:{base58(sha384(canonical json))};uid=...;registry=...;proto=...;nativeId=...
 *
 * Canonical JSON: the six fields, strings trimmed, `registry` and `protocol` lowercased,
 * `skills` sorted ascending, keys in alphabetical order.
 */
import { createHash } from "node:crypto";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE = 58n;

/** Bitcoin-alphabet base58; leading zero bytes become leading "1"s. */
export const base58 = (bytes: Uint8Array): string => {
  let value = 0n;
  for (const byte of bytes) {
    value = value * 256n + BigInt(byte);
  }
  let out = "";
  while (value > 0n) {
    out = `${BASE58[Number(value % BASE)]}${out}`;
    value /= BASE;
  }
  for (const byte of bytes) {
    if (byte !== 0) {
      break;
    }
    out = `1${out}`;
  }
  return out;
};

export interface AidInput {
  readonly name: string;
  /** CAIP-10 style id of the agent where it natively lives, e.g. "hedera:testnet:0.0.5". */
  readonly nativeId: string;
  readonly protocol: string;
  readonly registry: string;
  /** HCS-14 skill ids: 0-39 and 100+. */
  readonly skills: readonly number[];
  /** The agent's id within its registry (the ERC-8004 agentId). */
  readonly uid: string;
  readonly version: string;
}

/** The canonical JSON HCS-14 hashes (the uid is a routing parameter, not hashed). */
export const canonicalAid = (input: AidInput): string =>
  JSON.stringify({
    name: input.name.trim(),
    nativeId: input.nativeId.trim(),
    protocol: input.protocol.trim().toLowerCase(),
    registry: input.registry.trim().toLowerCase(),
    skills: input.skills.toSorted((a, b) => a - b),
    version: input.version.trim(),
  });

/** `uaid:aid:...` with the uid, registry, proto and nativeId parameters, in that order. */
export const hcs14Uaid = (input: AidInput): string => {
  const hash = createHash("sha384")
    .update(canonicalAid(input), "utf-8")
    .digest();
  const params = [
    `uid=${input.uid.trim()}`,
    `registry=${input.registry.trim().toLowerCase()}`,
    `proto=${input.protocol.trim().toLowerCase()}`,
    `nativeId=${input.nativeId.trim()}`,
  ];
  return `uaid:aid:${base58(hash)};${params.join(";")}`;
};
