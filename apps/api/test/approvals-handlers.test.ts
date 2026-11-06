/**
 * World ID payment approvals over the typed in-memory client: an in-memory store and a
 * fake World IdP that signs real ID tokens. Covers the whole journey and every way a
 * payment is refused.
 */
import { assert, layer } from "@effect/vitest";
import { RentAnLlmApi } from "@rentanllm/api-contract";
import { Effect, Layer } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiTest } from "effect/http-api";

import { ApiConfig, makeTestConfig } from "../src/config";
import { AuthenticationLive } from "../src/http/authentication";
import { CronAuthLive } from "../src/http/cron-auth";
import { ApprovalsHandlers } from "../src/http/handlers/approvals";
import type { ApprovalRow } from "../src/world/approval-store";
import { WorldIdpService } from "../src/world/world-idp-service";
import { makeFakeWorld, SUBJECT } from "./support/fake-world";
import type { Answer } from "./support/fake-world";
import { memoryApprovalStore } from "./support/memory-approval-store";
import {
  makeMemoryAuthState,
  memoryAuthStore,
} from "./support/memory-auth-store";

const world = await makeFakeWorld();
const rows = new Map<string, ApprovalRow>();

const servicesWith = (idp: typeof world.idp | null) =>
  Layer.mergeAll(
    memoryApprovalStore(rows),
    memoryAuthStore(makeMemoryAuthState()),
    Layer.succeed(WorldIdpService)(idp)
  ).pipe(Layer.provideMerge(Layer.succeed(ApiConfig)(makeTestConfig())));

const testLayer = (idp: typeof world.idp | null) =>
  ApprovalsHandlers.pipe(
    Layer.provideMerge(Layer.mergeAll(AuthenticationLive, CronAuthLive)),
    Layer.provideMerge(servicesWith(idp)),
    Layer.merge(HttpServer.layerServices)
  );

const makeClient = HttpApiTest.groups(RentAnLlmApi, ["approvals"]);

const PAYMENT = {
  amountUsdc: 12_300n,
  description: "one llama3.1:8b answer of up to 512 tokens",
  network: "hedera:testnet",
  payTo: "0.0.4242",
  payer: "0.0.1111",
} as const;

/** Creates an approval whose World polls get `answers`. */
const start = (answers: Answer[], extra: { expectedSubject?: string } = {}) =>
  Effect.gen(function* startGen() {
    const client = yield* makeClient;
    world.script(answers);
    const created = yield* client.approvals.create({
      payload: { ...PAYMENT, ...extra },
    });
    return { client, ...created };
  });

layer(testLayer(world.idp), { excludeTestServices: true })(
  "World ID approvals",
  (it) => {
    it.effect(
      "request -> person approves -> validated -> payment released once",
      () =>
        Effect.gen(function* journey() {
          const { approval, client, secret } = yield* start([
            { error: "authorization_pending" },
            { claims: {} },
          ]);
          assert.strictEqual(approval.status, "pending");
          assert.include(
            approval.verificationUriComplete ?? "",
            approval.userCode
          );
          // World's device code stays on the server.
          assert.isFalse("deviceCode" in approval);

          const params = { approvalId: approval.id };
          const waiting = yield* client.approvals.check({
            params,
            payload: { secret },
          });
          assert.strictEqual(waiting.status, "pending");

          const approved = yield* client.approvals.check({
            params,
            payload: { secret },
          });
          assert.strictEqual(approved.status, "approved");
          assert.strictEqual(approved.worldSubject, SUBJECT);

          const used = yield* client.approvals.consume({
            params,
            payload: {
              amountUsdc: PAYMENT.amountUsdc,
              payTo: PAYMENT.payTo,
              secret,
            },
          });
          assert.strictEqual(used.status, "used");

          const again = yield* client.approvals
            .consume({
              params,
              payload: {
                amountUsdc: PAYMENT.amountUsdc,
                payTo: PAYMENT.payTo,
                secret,
              },
            })
            .pipe(Effect.flip);
          assert.strictEqual(again._tag, "Conflict");
        })
    );

    it.effect("never releases a payment the person denied", () =>
      Effect.gen(function* denied() {
        const { approval, client, secret } = yield* start([
          { error: "access_denied" },
        ]);
        const params = { approvalId: approval.id };
        const checked = yield* client.approvals.check({
          params,
          payload: { secret },
        });
        assert.strictEqual(checked.status, "denied");
        const error = yield* client.approvals
          .consume({
            params,
            payload: {
              amountUsdc: PAYMENT.amountUsdc,
              payTo: PAYMENT.payTo,
              secret,
            },
          })
          .pipe(Effect.flip);
        assert.strictEqual(error._tag, "Conflict");
        assert.include(error.message, "denied");
      })
    );

    it.effect("never releases a payment whose World attempt expired", () =>
      Effect.gen(function* expired() {
        const { approval, client, secret } = yield* start([
          { error: "expired_token" },
        ]);
        const checked = yield* client.approvals.check({
          params: { approvalId: approval.id },
          payload: { secret },
        });
        assert.strictEqual(checked.status, "expired");
      })
    );

    it.effect("expires an approval nobody acted on in time", () =>
      Effect.gen(function* timedOut() {
        world.device.expiresIn = 0;
        const created = yield* start([{ claims: {} }]);
        world.device.expiresIn = 1200;
        const checked = yield* created.client.approvals.check({
          params: { approvalId: created.approval.id },
          payload: { secret: created.secret },
        });
        assert.strictEqual(checked.status, "expired");
      })
    );

    it.effect(
      "never releases a cancelled payment, even if World later approves",
      () =>
        Effect.gen(function* cancelled() {
          const { approval, client, secret } = yield* start([{ claims: {} }]);
          const params = { approvalId: approval.id };
          const done = yield* client.approvals.cancel({
            params,
            payload: { secret },
          });
          assert.strictEqual(done.status, "cancelled");
          const checked = yield* client.approvals.check({
            params,
            payload: { secret },
          });
          assert.strictEqual(checked.status, "cancelled");
          const error = yield* client.approvals
            .consume({
              params,
              payload: {
                amountUsdc: PAYMENT.amountUsdc,
                payTo: PAYMENT.payTo,
                secret,
              },
            })
            .pipe(Effect.flip);
          assert.strictEqual(error._tag, "Conflict");
        })
    );

    it.effect("fails an approval whose ID token does not validate", () =>
      Effect.gen(function* forged() {
        const { approval, client, secret } = yield* start([{ forged: true }]);
        const checked = yield* client.approvals.check({
          params: { approvalId: approval.id },
          payload: { secret },
        });
        assert.strictEqual(checked.status, "failed");
        assert.include(checked.failureReason ?? "", "signature");
      })
    );

    it.effect("fails an approval by someone other than the linked person", () =>
      Effect.gen(function* otherPerson() {
        const { approval, client, secret } = yield* start([{ claims: {} }], {
          expectedSubject: "subject-bob",
        });
        const checked = yield* client.approvals.check({
          params: { approvalId: approval.id },
          payload: { secret },
        });
        assert.strictEqual(checked.status, "failed");
        assert.include(checked.failureReason ?? "", "different person");
      })
    );

    it.effect(
      "only releases the exact amount and payee that were approved",
      () =>
        Effect.gen(function* mismatch() {
          const { approval, client, secret } = yield* start([{ claims: {} }]);
          const params = { approvalId: approval.id };
          yield* client.approvals.check({ params, payload: { secret } });
          const more = yield* client.approvals
            .consume({
              params,
              payload: {
                amountUsdc: PAYMENT.amountUsdc + 1n,
                payTo: PAYMENT.payTo,
                secret,
              },
            })
            .pipe(Effect.flip);
          assert.strictEqual(more._tag, "Conflict");
          const elsewhere = yield* client.approvals
            .consume({
              params,
              payload: {
                amountUsdc: PAYMENT.amountUsdc,
                payTo: "0.0.6666",
                secret,
              },
            })
            .pipe(Effect.flip);
          assert.strictEqual(elsewhere._tag, "Conflict");
          const used = yield* client.approvals.consume({
            params,
            payload: {
              amountUsdc: PAYMENT.amountUsdc,
              payTo: PAYMENT.payTo,
              secret,
            },
          });
          assert.strictEqual(used.status, "used");
        })
    );

    it.effect("hides an approval from anyone without its secret", () =>
      Effect.gen(function* wrongSecret() {
        const { approval, client } = yield* start([{ claims: {} }]);
        const error = yield* client.approvals
          .check({
            params: { approvalId: approval.id },
            payload: { secret: "guess" },
          })
          .pipe(Effect.flip);
        assert.strictEqual(error._tag, "NotFound");
      })
    );
  }
);

layer(testLayer(null), { excludeTestServices: true })(
  "World ID approvals, not configured",
  (it) => {
    it.effect("refuses to create approvals without World credentials", () =>
      Effect.gen(function* notConfigured() {
        const client = yield* makeClient;
        const error = yield* client.approvals
          .create({ payload: PAYMENT })
          .pipe(Effect.flip);
        assert.strictEqual(error._tag, "Unavailable");
      })
    );
  }
);
