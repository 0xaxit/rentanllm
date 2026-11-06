/**
 * World ID approvals over HTTP on real Postgres (ApprovalStorePg), with the fake World
 * IdP. See support/database.ts for how to run these.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { baseUrl, freshDatabase } from "./support/database";
import { makeFakeWorld, SUBJECT } from "./support/fake-world";
import type { FakeWorld } from "./support/fake-world";
import { makeTestApp } from "./support/test-app";
import type { TestApp } from "./support/test-app";

const PAYMENT = {
  amountUsdc: "12300",
  description: "one llama3.1:8b answer",
  network: "hedera:testnet",
  payTo: "0.0.4242",
  payer: "0.0.1111",
};

describe.runIf(baseUrl !== undefined)("approvals on Postgres", () => {
  let app: TestApp;
  let world: FakeWorld;

  beforeAll(async () => {
    world = await makeFakeWorld();
    app = makeTestApp(
      await freshDatabase("approvals"),
      {},
      undefined,
      undefined,
      world.idp
    );
  }, 60_000);

  afterAll(async () => {
    await app?.dispose();
  });

  it("approves, releases the payment once, and refuses it afterwards", async () => {
    world.script([{ claims: {} }]);
    const created = await app.call("POST", "/approvals", { body: PAYMENT });
    expect(created.status).toBe(201);
    const { approval, secret } = created.json;
    expect(approval.status).toBe("pending");
    expect(approval.deviceCode).toBeUndefined();

    const checked = await app.call("POST", `/approvals/${approval.id}/check`, {
      body: { secret },
    });
    expect(checked.json.status).toBe("approved");
    expect(checked.json.worldSubject).toBe(SUBJECT);

    const consume = () =>
      app.call("POST", `/approvals/${approval.id}/consume`, {
        body: { amountUsdc: PAYMENT.amountUsdc, payTo: PAYMENT.payTo, secret },
      });
    const [first, second] = await Promise.all([consume(), consume()]);
    // Two racing consumes: exactly one wins.
    expect([first.status, second.status].toSorted()).toEqual([200, 409]);
  });

  it("keeps a denied approval denied", async () => {
    world.script([{ error: "access_denied" }]);
    const created = await app.call("POST", "/approvals", { body: PAYMENT });
    const { approval, secret } = created.json;
    const checked = await app.call("POST", `/approvals/${approval.id}/check`, {
      body: { secret },
    });
    expect(checked.json.status).toBe("denied");
    const consumed = await app.call(
      "POST",
      `/approvals/${approval.id}/consume`,
      {
        body: { amountUsdc: PAYMENT.amountUsdc, payTo: PAYMENT.payTo, secret },
      }
    );
    expect(consumed.status).toBe(409);
  });

  it("cancels, after which World's approval no longer counts", async () => {
    world.script([{ claims: {} }]);
    const created = await app.call("POST", "/approvals", { body: PAYMENT });
    const { approval, secret } = created.json;
    const cancelled = await app.call(
      "POST",
      `/approvals/${approval.id}/cancel`,
      {
        body: { secret },
      }
    );
    expect(cancelled.json.status).toBe("cancelled");
    const checked = await app.call("POST", `/approvals/${approval.id}/check`, {
      body: { secret },
    });
    expect(checked.json.status).toBe("cancelled");
  });
});
