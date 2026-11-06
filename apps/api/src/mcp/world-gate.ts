/**
 * World ID approval for the hosted connector. When a buyer has set a World ID threshold
 * on their Budget page, buy_inference and generate_image hold any payment above it:
 *
 *   1. the first call returns World ID's link and code and signs nothing;
 *   2. the person approves (or denies) on World ID's page;
 *   3. the agent calls the same tool again with world_approval_id. The API checks World's
 *      ID token and uses the approval once, for exactly this amount and seller; only
 *      then is the payment signed from the agent wallet.
 *
 * The approval belongs to the signed-in user, so no secret is ever shown to the model.
 */
import { setTimeout as sleep } from "node:timers/promises";

/** A held payment's World ID approval, as the person sees it. */
export interface HeldApproval {
  readonly expiresAt: Date;
  readonly id: string;
  readonly link: string;
  readonly userCode: string;
}

export type SettleOutcome =
  | { readonly kind: "pending" }
  | { readonly kind: "refused"; readonly reason: string }
  /** Approved and now used up for this payment: sign it. */
  | { readonly kind: "approved" };

/** What the hosted MCP server needs from the API for World ID approvals. */
export interface HostedWorld {
  /** The user's threshold in micro-USDC; null when they have not set one. */
  readonly approvalAbove: () => Promise<bigint | null>;
  /** Cancels a held approval; resolves to what happened, in words. */
  readonly cancel: (approvalId: string) => Promise<string>;
  readonly hold: (input: {
    readonly amountMicros: bigint;
    readonly description: string;
    readonly payTo: string;
    readonly payer: string;
  }) => Promise<HeldApproval>;
  /** Checks the approval with World and, once approved, uses it for this payment. */
  readonly settle: (input: {
    readonly amountMicros: bigint;
    readonly approvalId: string;
    readonly payTo: string;
  }) => Promise<SettleOutcome>;
}

/** A World ID step failed in a way the agent should hear about verbatim. */
export class HostedWorldError extends Error {
  override readonly name = "HostedWorldError";
}

export type GateResult =
  | { readonly pay: true }
  | { readonly pay: false; readonly text: string };

const WAIT_MS = 40_000;
const POLL_MS = 3000;

export interface GateInput {
  readonly amountUsdc: string;
  readonly approvalId: string | undefined;
  readonly description: string;
  readonly priceMicros: bigint;
  /** Tool to call again once the person has approved. */
  readonly tool: string;
  readonly payTo: string;
  readonly payer: string;
  readonly wait?: {
    readonly pollMs: number;
    readonly sleep: (ms: number) => Promise<unknown>;
    readonly timeoutMs: number;
  };
}

const waitForAnswer = async (
  world: HostedWorld,
  input: GateInput & { readonly approvalId: string }
): Promise<SettleOutcome> => {
  const wait = input.wait ?? { pollMs: POLL_MS, sleep, timeoutMs: WAIT_MS };
  const deadline = Date.now() + wait.timeoutMs;
  let outcome = await world.settle({
    amountMicros: input.priceMicros,
    approvalId: input.approvalId,
    payTo: input.payTo,
  });
  while (outcome.kind === "pending" && Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- polling World, one check at a time
    await wait.sleep(wait.pollMs);
    // oxlint-disable-next-line no-await-in-loop -- polling World, one check at a time
    outcome = await world.settle({
      amountMicros: input.priceMicros,
      approvalId: input.approvalId,
      payTo: input.payTo,
    });
  }
  return outcome;
};

/** Decides whether this payment may be signed now, or what to tell the agent instead. */
export const worldGate = async (
  world: HostedWorld | null,
  input: GateInput
): Promise<GateResult> => {
  if (input.approvalId !== undefined) {
    if (world === null) {
      return {
        pay: false,
        text: "Not paid: World ID approvals are not set up on this server. Nothing was signed.",
      };
    }
    const outcome = await waitForAnswer(world, {
      ...input,
      approvalId: input.approvalId,
    });
    if (outcome.kind === "approved") {
      return { pay: true };
    }
    if (outcome.kind === "pending") {
      return {
        pay: false,
        text: `Still waiting for the person to approve on World ID. Nothing was paid. Call ${input.tool} again with the same arguments and world_approval_id "${input.approvalId}" once they have, or cancel_payment to drop it.`,
      };
    }
    return {
      pay: false,
      text: `Not paid: ${outcome.reason}. Nothing was signed.`,
    };
  }
  const above = world === null ? null : await world.approvalAbove();
  if (world === null || above === null || input.priceMicros <= above) {
    return { pay: true };
  }
  const held = await world.hold({
    amountMicros: input.priceMicros,
    description: input.description,
    payTo: input.payTo,
    payer: input.payer,
  });
  return {
    pay: false,
    text: [
      `Not paid yet: ${input.amountUsdc} USDC to ${input.payTo} is above the user's World ID limit, so the person has to approve it with World ID first.`,
      `Show the person this link and code, exactly: ${held.link} (code ${held.userCode}). They open it, approve in the World ID app, and finish on that page.`,
      `Then call ${input.tool} again with the same arguments plus world_approval_id "${held.id}". It waits for their answer and pays only if World ID confirms it. To drop it, call cancel_payment with world_approval_id "${held.id}".`,
      `The approval expires at ${held.expiresAt.toISOString()}.`,
    ].join("\n"),
  };
};
