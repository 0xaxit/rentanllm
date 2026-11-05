/** Auth handlers over the typed in-memory client, with an in-memory AuthStore. */
import { assert, layer } from "@effect/vitest";
import { RentAnLlmApi } from "@rentanllm/api-contract";
import { Db } from "@rentanllm/db";
import { Effect, Layer } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiTest } from "effect/http-api";

import { SignatureVerifierEoa } from "../src/auth/signature-verifier";
import { ApiConfig, makeTestConfig } from "../src/config";
import { AuthenticationLive } from "../src/http/authentication";
import { CronAuthLive } from "../src/http/cron-auth";
import { AuthHandlers } from "../src/http/handlers/auth";
import {
  makeMemoryAuthState,
  memoryAuthStore,
} from "./support/memory-auth-store";
import { makeWallet } from "./support/wallet";

const state = makeMemoryAuthState();
// /auth/me/transactions reads Postgres; these tests never call it.
const NoDb = Layer.succeed(Db)({} as Db["Service"]);
const Services = Layer.mergeAll(
  memoryAuthStore(state),
  SignatureVerifierEoa,
  NoDb
).pipe(Layer.provideMerge(Layer.succeed(ApiConfig)(makeTestConfig())));
const TestLayer = AuthHandlers.pipe(
  Layer.provideMerge(Layer.mergeAll(AuthenticationLive, CronAuthLive)),
  Layer.provideMerge(Services),
  Layer.merge(HttpServer.layerServices)
);
const makeClient = HttpApiTest.groups(RentAnLlmApi, ["auth"]);

const promise = <A>(thunk: () => Promise<A>) => Effect.promise(thunk);

layer(TestLayer, { excludeTestServices: true })(
  "auth handlers (in-memory store)",
  (it) => {
    it.effect("signs in a new wallet, creating the user and a session", () =>
      Effect.gen(function* signsIn() {
        const client = yield* makeClient;
        const wallet = makeWallet();
        const { nonce } = yield* client.auth.nonce({
          payload: { address: wallet.address },
        });
        const signed = yield* promise(() => wallet.signIn(nonce));
        const session = yield* client.auth.verify({ payload: signed });
        assert.strictEqual(session.user.walletAddress, wallet.address);
        assert.isTrue(session.expiresAt > new Date());
        assert.isTrue(state.sessions.size >= 1);
        // Stored session keys are HMAC hashes, never the cookie token.
        for (const key of state.sessions.keys()) {
          assert.match(key, /^[0-9a-f]{64}$/u);
        }
      })
    );

    it.effect("rejects a reused nonce", () =>
      Effect.gen(function* reusedNonce() {
        const client = yield* makeClient;
        const wallet = makeWallet();
        const { nonce } = yield* client.auth.nonce({
          payload: { address: wallet.address },
        });
        const signed = yield* promise(() => wallet.signIn(nonce));
        yield* client.auth.verify({ payload: signed });
        const error = yield* client.auth
          .verify({ payload: signed })
          .pipe(Effect.flip);
        assert.strictEqual(error._tag, "Unauthorized");
      })
    );

    it.effect("rejects a signature from another wallet", () =>
      Effect.gen(function* wrongSigner() {
        const client = yield* makeClient;
        const wallet = makeWallet();
        const other = makeWallet();
        const { nonce } = yield* client.auth.nonce({
          payload: { address: wallet.address },
        });
        const signed = yield* promise(() => wallet.signIn(nonce));
        const forged = yield* promise(() => other.signIn(nonce));
        const error = yield* client.auth
          .verify({
            payload: { message: signed.message, signature: forged.signature },
          })
          .pipe(Effect.flip);
        assert.strictEqual(error._tag, "Unauthorized");
      })
    );

    it.effect("rejects a message for another domain", () =>
      Effect.gen(function* wrongDomain() {
        const client = yield* makeClient;
        const wallet = makeWallet();
        const { nonce } = yield* client.auth.nonce({
          payload: { address: wallet.address },
        });
        const signed = yield* promise(() =>
          wallet.signIn(nonce, { domain: "evil.example" })
        );
        const error = yield* client.auth
          .verify({ payload: signed })
          .pipe(Effect.flip);
        assert.strictEqual(error._tag, "Unauthorized");
      })
    );

    it.effect("rejects a nonce issued to another address", () =>
      Effect.gen(function* foreignNonce() {
        const client = yield* makeClient;
        const wallet = makeWallet();
        const other = makeWallet();
        const { nonce } = yield* client.auth.nonce({
          payload: { address: other.address },
        });
        const signed = yield* promise(() => wallet.signIn(nonce));
        const error = yield* client.auth
          .verify({ payload: signed })
          .pipe(Effect.flip);
        assert.strictEqual(error._tag, "Unauthorized");
      })
    );

    it.effect("rejects garbage", () =>
      Effect.gen(function* garbage() {
        const client = yield* makeClient;
        const error = yield* client.auth
          .verify({ payload: { message: "hello", signature: "0x00" } })
          .pipe(Effect.flip);
        assert.strictEqual(error._tag, "InvalidRequest");
      })
    );

    it.effect("requires a session for /auth/me", () =>
      Effect.gen(function* meWithoutSession() {
        const client = yield* makeClient;
        const error = yield* client.auth.me().pipe(Effect.flip);
        assert.strictEqual(error._tag, "Unauthorized");
      })
    );
  }
);
