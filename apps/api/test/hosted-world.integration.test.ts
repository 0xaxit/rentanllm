/**
 * World ID approvals for the hosted connector, on real Postgres with the fake World IdP:
 * the user's threshold, approvals owned by the signed-in user (no secret), the first
 * approver pinned for the user, one use per approval, and cancel.
 * See support/database.ts for how to run these.
 */
import { Db } from "@rentanllm/db";
import { buyerPolicies, worldApprovals } from "@rentanllm/db/schema";
import { eq } from "drizzle-orm";
import { Effect, Redacted } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hostedWorld } from "../src/mcp/hosted-world";
import type { HostedWorld } from "../src/mcp/world-gate";
import { baseUrl, freshDatabase } from "./support/database";
import {
  CLIENT_ID,
  CLIENT_SECRET,
  ISSUER,
  makeFakeWorld,
  SUBJECT,
} from "./support/fake-world";
import type { FakeWorld } from "./support/fake-world";
import { makeTestApp } from "./support/test-app";
import type { TestApp } from "./support/test-app";

const PAYMENT = {
  amountMicros: 2000n,
  description: "flux-2-klein-4b image, 512x512",
  payTo: "0.0.4242",
  payer: "0.0.1111",
};

describe.runIf(baseUrl !== undefined)("hosted World ID approvals", () => {
  let app: TestApp;
  let fake: FakeWorld;
  let aliceId: string;
  let alice: HostedWorld;
  let bob: HostedWorld;

  const worldFor = async (userId: string): Promise<HostedWorld> => {
    const world = await app.run(hostedWorld(userId));
    if (world === null) {
      throw new Error("World ID is off in the test config");
    }
    return world;
  };

  beforeAll(async () => {
    fake = await makeFakeWorld();
    app = makeTestApp(
      await freshDatabase("hosted_world"),
      {
        world: {
          acceptedAcr: [],
          clientId: CLIENT_ID,
          clientSecret: Redacted.make(CLIENT_SECRET),
          issuer: ISSUER,
        },
      },
      undefined,
      undefined,
      fake.idp
    );
    const signedIn = await app.signIn();
    aliceId = signedIn.user.id;
    const other = await app.signIn();
    alice = await worldFor(aliceId);
    bob = await worldFor(other.user.id);
  }, 60_000);

  afterAll(async () => {
    await app?.dispose();
  });

  it("reads the threshold from the user's Budget limits", async () => {
    expect(await alice.approvalAbove()).toBeNull();
    await app.run(
      Effect.gen(function* setThreshold() {
        const db = yield* Db;
        yield* db.insert(buyerPolicies).values({
          payerAccount: "0.0.1111",
          userId: aliceId,
          worldApprovalAboveMicros: 1000n,
        });
      }).pipe(Effect.orDie)
    );
    expect(await alice.approvalAbove()).toBe(1000n);
  });

  it("holds, waits, then releases the payment once, and never for another user", async () => {
    fake.script([{ error: "authorization_pending" }, { claims: {} }]);
    const held = await alice.hold(PAYMENT);
    expect(held.link).toContain("https://");
    expect(held.userCode).not.toBe("");

    const settle = (world: HostedWorld) =>
      world.settle({
        amountMicros: PAYMENT.amountMicros,
        approvalId: held.id,
        payTo: PAYMENT.payTo,
      });
    // Another signed-in user can't see or use Alice's approval.
    await expect(settle(bob)).rejects.toThrow(`no approval ${held.id}`);
    await expect(bob.cancel(held.id)).rejects.toThrow(`no approval ${held.id}`);

    expect(await settle(alice)).toEqual({ kind: "pending" });
    expect(await settle(alice)).toEqual({ kind: "approved" });
    // Used once: a second settle can't release it again.
    expect(await settle(alice)).toEqual({
      kind: "refused",
      reason: "the World ID approval was used",
    });
  });

  it("pins the first approver: later approvals ask World for that person", async () => {
    await alice.hold(PAYMENT);
    const lastForm = fake.deviceForms.at(-1);
    expect(lastForm?.get("claims")).toContain(SUBJECT);
  });

  it("refuses a different amount or seller than the one approved", async () => {
    fake.script([{ claims: {} }]);
    const held = await alice.hold(PAYMENT);
    expect(
      await alice.settle({
        amountMicros: 9999n,
        approvalId: held.id,
        payTo: PAYMENT.payTo,
      })
    ).toMatchObject({ kind: "refused" });
  });

  it("cancels: afterwards World's approval no longer counts", async () => {
    fake.script([{ claims: {} }]);
    const held = await alice.hold(PAYMENT);
    expect(await alice.cancel(held.id)).toBe(
      `Cancelled payment ${held.id}. Nothing was paid.`
    );
    expect(
      await alice.settle({
        amountMicros: PAYMENT.amountMicros,
        approvalId: held.id,
        payTo: PAYMENT.payTo,
      })
    ).toEqual({
      kind: "refused",
      reason: "the World ID approval was cancelled",
    });
    const [row] = await app.run(
      Effect.gen(function* readRow() {
        const db = yield* Db;
        return yield* db
          .select()
          .from(worldApprovals)
          .where(eq(worldApprovals.id, held.id));
      }).pipe(Effect.orDie)
    );
    expect(row?.ownerUserId).toBe(aliceId);
  });
});
