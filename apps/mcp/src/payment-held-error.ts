/** A payment held until the person approves it through `approve_payment`. */
import type { ChatRequest } from "./market.ts";

/** The World ID approval a held payment waits for (approval mode "world"). */
export interface WorldHold {
  readonly approvalId: string;
  /** Where the person approves or denies. */
  readonly link: string;
  /** Authorizes this server's calls about the approval; never shown to the model. */
  readonly secret: string;
  readonly userCode: string;
}

export interface HeldPayment {
  readonly amountMicros: bigint;
  readonly expiresAt: Date;
  readonly id: string;
  readonly payTo: string;
  readonly request: ChatRequest;
  readonly world: WorldHold | null;
}

/** Thrown by the approve step when a payment is held for `approve_payment`. */
export class PaymentHeldError extends Error {
  override readonly name = "PaymentHeldError";
  readonly held: HeldPayment;

  constructor(held: HeldPayment) {
    super(`payment ${held.id} is waiting for the person's approval`);
    this.held = held;
  }
}
