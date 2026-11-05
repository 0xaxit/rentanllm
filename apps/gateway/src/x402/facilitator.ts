/**
 * The x402 facilitator: verifies a signed payment against our requirements and settles
 * it on chain. The live layer talks to a facilitator over HTTP with `HTTPFacilitatorClient`
 * from @x402/core; tests provide a fake.
 */
import { HTTPFacilitatorClient } from "@x402/core/http";
import { SettleError, VerifyError } from "@x402/core/types";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import { Config, Context, Effect, Layer } from "effect";

import { FacilitatorError } from "./facilitator-error.ts";

/** Public x402.org facilitator; serves Hedera testnet without an API key. */
export const DEFAULT_FACILITATOR_URL = "https://x402.org/facilitator";
const DEFAULT_TIMEOUT_MS = 30_000;

export class X402Facilitator extends Context.Service<
  X402Facilitator,
  {
    readonly settle: (
      payload: PaymentPayload,
      requirements: PaymentRequirements
    ) => Effect.Effect<SettleResponse, FacilitatorError>;
    /**
     * The facilitator's `extra` for `exact` payments on `network` (its `/supported` entry),
     * e.g. Hedera's `{ feePayer: "0.0.x" }`; null when it does not serve that network.
     */
    readonly supportedExtra: (
      network: string
    ) => Effect.Effect<Record<string, unknown> | null, FacilitatorError>;
    readonly verify: (
      payload: PaymentPayload,
      requirements: PaymentRequirements
    ) => Effect.Effect<VerifyResponse, FacilitatorError>;
  }
>()("@rentanllm/gateway/X402Facilitator") {}

/**
 * The client throws VerifyError / SettleError when the facilitator answers non-2xx with
 * a well-formed refusal. Those are answers, not outages, so they become
 * `isValid: false` / `success: false` results.
 */
const verifyOrRefusal = async (
  client: HTTPFacilitatorClient,
  payload: PaymentPayload,
  requirements: PaymentRequirements
): Promise<VerifyResponse> => {
  try {
    return await client.verify(payload, requirements);
  } catch (error) {
    if (error instanceof VerifyError) {
      return {
        invalidReason: error.invalidReason ?? "invalid_payment",
        isValid: false,
        ...(error.invalidMessage === undefined
          ? {}
          : { invalidMessage: error.invalidMessage }),
      };
    }
    throw error;
  }
};

const settleOrRefusal = async (
  client: HTTPFacilitatorClient,
  payload: PaymentPayload,
  requirements: PaymentRequirements
): Promise<SettleResponse> => {
  try {
    return await client.settle(payload, requirements);
  } catch (error) {
    if (error instanceof SettleError) {
      return {
        errorReason: error.errorReason ?? "settle_failed",
        network: requirements.network,
        success: false,
        transaction: error.transaction ?? "",
        ...(error.errorMessage === undefined
          ? {}
          : { errorMessage: error.errorMessage }),
      };
    }
    throw error;
  }
};

export const httpFacilitatorLayer = (url: string, timeoutMs: number) =>
  Layer.sync(X402Facilitator)(() => {
    const client = new HTTPFacilitatorClient({ timeoutMs, url });
    return {
      settle: (payload, requirements) =>
        Effect.tryPromise({
          catch: (cause) =>
            new FacilitatorError({ cause, operation: "settle" }),
          try: () => settleOrRefusal(client, payload, requirements),
        }),
      supportedExtra: (network) =>
        Effect.tryPromise({
          catch: (cause) =>
            new FacilitatorError({ cause, operation: "supported" }),
          try: async () => {
            const { kinds } = await client.getSupported();
            const kind = kinds.find(
              (k) =>
                k.scheme === "exact" &&
                k.network === network &&
                k.x402Version === 2
            );
            return kind === undefined ? null : (kind.extra ?? {});
          },
        }),
      verify: (payload, requirements) =>
        Effect.tryPromise({
          catch: (cause) =>
            new FacilitatorError({ cause, operation: "verify" }),
          try: () => verifyOrRefusal(client, payload, requirements),
        }),
    };
  });

/** Reads X402_FACILITATOR_URL (default x402.org) and X402_FACILITATOR_TIMEOUT_MS. */
export const FacilitatorFromEnv = Layer.unwrap(
  Effect.gen(function* facilitatorFromEnv() {
    const url = yield* Config.String("X402_FACILITATOR_URL").pipe(
      Config.withDefault(DEFAULT_FACILITATOR_URL)
    );
    const timeoutMs = yield* Config.Int("X402_FACILITATOR_TIMEOUT_MS").pipe(
      Config.withDefault(DEFAULT_TIMEOUT_MS)
    );
    return httpFacilitatorLayer(url, timeoutMs);
  })
);
