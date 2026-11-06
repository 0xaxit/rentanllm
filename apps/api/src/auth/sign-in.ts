import { randomBytes } from "node:crypto";

import { InvalidRequest, Unauthorized } from "@rentanllm/api-contract";
import type { User } from "@rentanllm/api-contract";
import { Effect } from "effect";
import { getAddress, isAddress } from "viem";
import type { Hex } from "viem";
import { parseSiweMessage, validateSiweMessage } from "viem/siwe";

import { currentDate } from "../clock";
import { ApiConfig } from "../config";
import { AuthStore } from "./auth-store";
import { newSessionToken, sessionTokenHash } from "./session-token";
import { SignatureVerifier } from "./signature-verifier";

const NONCE_BYTES = 24;

/**
 * 48 hex characters from the OS CSPRNG. Not viem's generateSiweNonce: it slices one shared
 * random buffer one character further each call, so consecutive nonces overlap and the
 * next one can be guessed from the last.
 */
const newNonce = () => randomBytes(NONCE_BYTES).toString("hex");

/** Issues a single-use SIWE nonce bound to `address`. */
export const issueNonce = Effect.fn("auth.issueNonce")(function* issueNonceGen(
  rawAddress: string
) {
  if (!isAddress(rawAddress, { strict: false })) {
    return yield* new InvalidRequest({ message: "Not an Ethereum address" });
  }
  const config = yield* ApiConfig;
  const store = yield* AuthStore;
  const nonce = newNonce();
  const expiresAt = new Date(
    (yield* currentDate).getTime() + config.nonceTtlMs
  );
  yield* store.createNonce({
    address: getAddress(rawAddress),
    expiresAt,
    nonce,
  });
  return { expiresAt, nonce };
});

export interface SignInResult {
  readonly expiresAt: Date;
  /** Raw session token for the cookie. Never stored. */
  readonly token: string;
  readonly user: User;
}

const unauthorized = (message: string) => new Unauthorized({ message });

/**
 * Verifies an EIP-4361 sign-in: message fields (domain, time window), signature, then
 * consumes the nonce (single use, bound to the address, unexpired). Creates the user on
 * first sign-in and a session.
 */
export const verifySignIn = Effect.fn("auth.verifySignIn")(
  function* verifySignInGen(input: {
    readonly message: string;
    readonly signature: string;
  }) {
    const config = yield* ApiConfig;
    const store = yield* AuthStore;
    const verifier = yield* SignatureVerifier;
    const at = yield* currentDate;

    const parsed = yield* Effect.try(() =>
      parseSiweMessage(input.message)
    ).pipe(
      Effect.mapError(
        () => new InvalidRequest({ message: "Malformed SIWE message" })
      )
    );
    if (parsed.address === undefined || parsed.nonce === undefined) {
      return yield* new InvalidRequest({
        message: "SIWE message lacks address or nonce",
      });
    }
    const valid = validateSiweMessage({
      domain: config.siweDomain,
      message: parsed,
      time: at,
    });
    if (!valid) {
      return yield* unauthorized(
        "SIWE message domain or validity window rejected"
      );
    }
    const address = getAddress(parsed.address);
    const signed = yield* verifier.verify({
      address,
      message: input.message,
      signature: input.signature as Hex,
    });
    if (!signed) {
      return yield* unauthorized("Signature does not match the address");
    }
    const consumed = yield* store.consumeNonce({
      address,
      nonce: parsed.nonce,
      now: at,
    });
    if (!consumed) {
      return yield* unauthorized("Nonce unknown, already used or expired");
    }

    const user = yield* store.upsertWalletUser(address);
    const token = newSessionToken();
    const expiresAt = new Date(at.getTime() + config.sessionTtlMs);
    yield* store.createSession({
      expiresAt,
      tokenHash: sessionTokenHash(config, token),
      userId: user.id,
    });
    yield* Effect.annotateCurrentSpan({ "user.id": user.id });
    return { expiresAt, token, user } satisfies SignInResult;
  }
);
