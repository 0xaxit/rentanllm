/**
 * Human-in-the-loop above a threshold (approval mode "threshold"):
 *
 *   amount <= autoApproveMicros  -> paid at once, inside the caps
 *   amount >  autoApproveMicros  -> the person confirms first:
 *     - mode "world": with World ID Agent Pass, on World's page; the payment is held until
 *       the RentAnLLM API has validated and consumed that approval (see world.ts);
 *     - in the MCP client's own dialog, through elicitation, when the client supports it;
 *     - otherwise the payment is held, and the agent must call `approve_payment` with the
 *       amount and recipient. The client shows its tool-approval dialog with those
 *       arguments (keep that tool on "always ask").
 *
 * Holding stores only the request and the most the person agreed to pay; the price is
 * fetched again when the payment is approved and must not be higher.
 */
import { randomBytes } from "node:crypto";

import { formatUsdc } from "./config.ts";
import type { McpConfig } from "./config.ts";
import type { ChatRequest, Quote } from "./market.ts";
import type { HeldPayment, WorldHold } from "./payment-held-error.ts";

/** How long a held payment can be approved. */
export const HOLD_TTL_MS = 5 * 60 * 1000;
const ID_BYTES = 6;

/** Whether a payment of `amountMicros` needs the person under `config`. */
export const needsPerson = (config: McpConfig, amountMicros: bigint): boolean =>
  (config.approval === "threshold" || config.approval === "world") &&
  amountMicros > config.autoApproveMicros;

/** Payments waiting for `approve_payment`, kept in this server process only. */
export class HeldPayments {
  readonly #byId = new Map<string, HeldPayment>();
  readonly #now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.#now = now;
  }

  /** Holds a payment; with a World approval, until that approval expires. */
  hold(
    request: ChatRequest,
    quote: Quote,
    world: { readonly expiresAt: Date; readonly hold: WorldHold } | null = null
  ): HeldPayment {
    this.#dropExpired();
    const held: HeldPayment = {
      amountMicros: BigInt(quote.terms.amount),
      expiresAt:
        world?.expiresAt ?? new Date(this.#now().getTime() + HOLD_TTL_MS),
      id: `pay_${randomBytes(ID_BYTES).toString("hex")}`,
      payTo: quote.terms.payTo,
      request,
      world: world?.hold ?? null,
    };
    this.#byId.set(held.id, held);
    return held;
  }

  /**
   * Takes a held payment out if the arguments name it exactly (id, amount and
   * recipient), so what the person saw in the dialog is what gets paid. One use only.
   */
  take(id: string, amountMicros: bigint, payTo: string): HeldPayment | string {
    const held = this.peek(id, amountMicros, payTo);
    if (typeof held !== "string") {
      this.#byId.delete(id);
    }
    return held;
  }

  /** Like `take`, but leaves the payment held (a World approval may still be pending). */
  peek(id: string, amountMicros: bigint, payTo: string): HeldPayment | string {
    this.#dropExpired();
    const held = this.#byId.get(id);
    if (held === undefined) {
      return `no payment ${id} is waiting (it was paid, refused, or its approval expired)`;
    }
    if (held.amountMicros !== amountMicros || held.payTo !== payTo) {
      return `payment ${id} is ${formatUsdc(held.amountMicros)} USDC to ${held.payTo}, not ${formatUsdc(amountMicros)} USDC to ${payTo}`;
    }
    return held;
  }

  /** The held payment with this id, if any. */
  find(id: string): HeldPayment | undefined {
    this.#dropExpired();
    return this.#byId.get(id);
  }

  /** Stops holding a payment (paid, denied, expired or cancelled). */
  release(id: string): void {
    this.#byId.delete(id);
  }

  #dropExpired(): void {
    const now = this.#now().getTime();
    for (const [id, held] of this.#byId) {
      if (held.expiresAt.getTime() <= now) {
        this.#byId.delete(id);
      }
    }
  }
}

/** What the approval dialog says. */
export const confirmMessage = (quote: Quote, request: ChatRequest): string =>
  `Pay ${formatUsdc(BigInt(quote.terms.amount))} USDC to ${quote.terms.payTo} on Hedera testnet for one ${request.model} answer of up to ${request.maxTokens} tokens?`;
