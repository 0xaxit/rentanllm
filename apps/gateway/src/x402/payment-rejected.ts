import { Data } from "effect";

/** A payment header that cannot pay for the request (malformed, wrong terms, refused). */
export class PaymentRejected extends Data.TaggedError("PaymentRejected")<{
  readonly reason: string;
}> {}
