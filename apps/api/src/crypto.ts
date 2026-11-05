import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const TOKEN_BYTES = 32;

/** Lowercase SHA-256 hex digest. Same as the gateway's `sha256Hex` (api_keys.key_hash, nodes.node_token_hash). */
export const sha256Hex = (value: string): string =>
  createHash("sha256").update(value, "utf-8").digest("hex");

/** Lowercase HMAC-SHA256 hex digest. */
export const hmacSha256Hex = (key: string, value: string): string =>
  createHmac("sha256", key).update(value, "utf-8").digest("hex");

/** 256 random bits, base64url. */
export const randomToken = (bytes: number = TOKEN_BYTES): string =>
  randomBytes(bytes).toString("base64url");

/** Constant-time string comparison. */
export const safeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a, "utf-8");
  const right = Buffer.from(b, "utf-8");
  return left.length === right.length && timingSafeEqual(left, right);
};

export const API_KEY_PREFIX = "rk_live_";
export const NODE_TOKEN_PREFIX = "rn_node_";
/** Characters of the key kept as `api_keys.key_prefix` to identify it in the UI. */
const VISIBLE_KEY_CHARS = 12;

export interface IssuedSecret {
  readonly hash: string;
  readonly prefix: string;
  readonly secret: string;
}

/** A renter API key: `rk_live_` + 256 random bits. Only the hash and prefix are stored. */
export const newApiKey = (): IssuedSecret => {
  const secret = `${API_KEY_PREFIX}${randomToken()}`;
  return {
    hash: sha256Hex(secret),
    prefix: secret.slice(0, VISIBLE_KEY_CHARS),
    secret,
  };
};

/** A node token: `rn_node_` + 256 random bits. Only the hash is stored. */
export const newNodeToken = (): IssuedSecret => {
  const secret = `${NODE_TOKEN_PREFIX}${randomToken()}`;
  return {
    hash: sha256Hex(secret),
    prefix: secret.slice(0, VISIBLE_KEY_CHARS),
    secret,
  };
};
