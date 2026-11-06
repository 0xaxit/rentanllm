import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { issueNonce } from "../src/auth/sign-in";
import { ApiConfig, makeTestConfig } from "../src/config";
import {
  makeMemoryAuthState,
  memoryAuthStore,
} from "./support/memory-auth-store";

const ADDRESS = "0x53E813a4F255607620b6741b2Ec69100E011E048";

describe("SIWE nonces", () => {
  it("are 48 hex characters and unrelated from one call to the next", async () => {
    const services = Layer.mergeAll(
      Layer.succeed(ApiConfig)(makeTestConfig()),
      memoryAuthStore(makeMemoryAuthState())
    );
    const [a, b] = await Effect.runPromise(
      Effect.all([issueNonce(ADDRESS), issueNonce(ADDRESS)]).pipe(
        Effect.provide(services)
      )
    );
    expect(a.nonce).toMatch(/^[0-9a-f]{48}$/u);
    // viem's generateSiweNonce made b = a shifted by one character.
    expect(b.nonce.slice(0, 40)).not.toBe(a.nonce.slice(1, 41));
  });
});
