/**
 * Encrypts agent-wallet keys at rest: AES-256-GCM under AGENT_WALLET_KEK (32 bytes, hex).
 * Stored as base64(iv | tag | ciphertext).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEK_HEX = /^[0-9a-f]{64}$/iu;

const kekBytes = (kekHex: string): Buffer => {
  if (!KEK_HEX.test(kekHex)) {
    throw new Error("AGENT_WALLET_KEK must be 32 bytes of hex");
  }
  return Buffer.from(kekHex, "hex");
};

export const sealKey = (kekHex: string, plaintext: string): string => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", kekBytes(kekHex), iv);
  const body = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
};

export const openKey = (kekHex: string, sealed: string): string => {
  const raw = Buffer.from(sealed, "base64");
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", kekBytes(kekHex), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]).toString("utf-8");
};
