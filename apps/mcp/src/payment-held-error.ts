/** A payment held until the person approves it through `approve_payment`. */
import type { ChatRequest } from "./market.ts";

export interface HeldPayment {
  readonly amountMicros: bigint;
  readonly expiresAt: Date;
  readonly id: string;
  readonly payTo: string;
  readonly request: ChatRequest;
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
