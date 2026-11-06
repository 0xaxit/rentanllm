/**
 * The hosted connector's World ID gate: when a payment is held, what the agent is told,
 * and that a payment is released only after World ID approved and the approval was used.
 */
import { describe, expect, it } from "vitest";

import { worldGate } from "../src/mcp/world-gate";
import type {
  GateInput,
  HostedWorld,
  SettleOutcome,
} from "../src/mcp/world-gate";

const PAYMENT: GateInput = {
  amountUsdc: "0.002",
  approvalId: undefined,
  description: "flux-2-klein-4b image, 512x512",
  payTo: "0.0.4242",
  payer: "0.0.1111",
  priceMicros: 2000n,
  tool: "generate_image",
  wait: { pollMs: 1, sleep: () => Promise.resolve(), timeoutMs: 50 },
};

/** A fake API: a threshold, and World answers scripted per settle call. */
const fakeWorld = (above: bigint | null, answers: SettleOutcome[] = []) => {
  const calls: string[] = [];
  const world: HostedWorld = {
    approvalAbove: () => Promise.resolve(above),
    cancel: (id) => {
      calls.push(`cancel ${id}`);
      return Promise.resolve(`Cancelled payment ${id}. Nothing was paid.`);
    },
    hold: (input) => {
      calls.push(`hold ${input.amountMicros} to ${input.payTo}`);
      return Promise.resolve({
        expiresAt: new Date("2026-11-07T00:10:00Z"),
        id: "appr-1",
        link: "https://sandbox.auth.world.org/authorize?transaction_id=t1",
        userCode: "ABCD-EFGH",
      });
    },
    settle: (input) => {
      calls.push(`settle ${input.approvalId} ${input.amountMicros}`);
      return Promise.resolve(answers.shift() ?? { kind: "pending" });
    },
  };
  return { calls, world };
};

describe("World ID gate", () => {
  it("pays without asking when World ID is off or the user set no threshold", async () => {
    expect(await worldGate(null, PAYMENT)).toEqual({ pay: true });
    const { calls, world } = fakeWorld(null);
    expect(await worldGate(world, PAYMENT)).toEqual({ pay: true });
    expect(calls).toEqual([]);
  });

  it("pays without asking at or below the threshold", async () => {
    const { calls, world } = fakeWorld(2000n);
    expect(await worldGate(world, PAYMENT)).toEqual({ pay: true });
    expect(calls).toEqual([]);
  });

  it("holds a payment above the threshold and returns World's link, not a secret", async () => {
    const { calls, world } = fakeWorld(1000n);
    const result = await worldGate(world, PAYMENT);
    expect(result.pay).toBe(false);
    const text = result.pay ? "" : result.text;
    expect(text).toContain("Not paid yet: 0.002 USDC to 0.0.4242");
    expect(text).toContain(
      "https://sandbox.auth.world.org/authorize?transaction_id=t1"
    );
    expect(text).toContain("ABCD-EFGH");
    expect(text).toContain('world_approval_id "appr-1"');
    expect(text).not.toMatch(/secret/iu);
    expect(calls).toEqual(["hold 2000 to 0.0.4242"]);
  });

  it("waits for the person, then releases the payment once World approved it", async () => {
    const { calls, world } = fakeWorld(1000n, [
      { kind: "pending" },
      { kind: "pending" },
      { kind: "approved" },
    ]);
    expect(
      await worldGate(world, { ...PAYMENT, approvalId: "appr-1" })
    ).toEqual({ pay: true });
    expect(calls).toEqual([
      "settle appr-1 2000",
      "settle appr-1 2000",
      "settle appr-1 2000",
    ]);
  });

  it("refuses when World ID denied, expired or failed the approval", async () => {
    const { world } = fakeWorld(1000n, [
      { kind: "refused", reason: "the World ID approval was denied" },
    ]);
    expect(
      await worldGate(world, { ...PAYMENT, approvalId: "appr-1" })
    ).toEqual({
      pay: false,
      text: "Not paid: the World ID approval was denied. Nothing was signed.",
    });
  });

  it("tells the agent to come back when the person has not answered yet", async () => {
    const { world } = fakeWorld(1000n);
    const result = await worldGate(world, {
      ...PAYMENT,
      approvalId: "appr-1",
    });
    expect(result.pay).toBe(false);
    expect(result.pay ? "" : result.text).toContain(
      "Still waiting for the person to approve on World ID. Nothing was paid."
    );
  });

  it("refuses an approval id when World ID is off", async () => {
    const result = await worldGate(null, { ...PAYMENT, approvalId: "appr-1" });
    expect(result.pay).toBe(false);
  });
});
