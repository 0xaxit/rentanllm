import { Config, Context, Effect, Layer, Option } from "effect";
import { createPublicClient, http, isAddressEqual } from "viem";
import type { Address, Hex } from "viem";
import { hederaTestnet } from "viem/chains";
import { recoverMessageAddress } from "viem/utils";

export interface SignatureVerifierShape {
  /** True when `signature` is `address`'s EIP-191 signature of `message`. */
  readonly verify: (input: {
    readonly address: Address;
    readonly message: string;
    readonly signature: Hex;
  }) => Effect.Effect<boolean>;
}

export class SignatureVerifier extends Context.Service<
  SignatureVerifier,
  SignatureVerifierShape
>()("@rentanllm/api/SignatureVerifier") {}

const recoverMatches = (input: {
  readonly address: Address;
  readonly message: string;
  readonly signature: Hex;
}) =>
  Effect.tryPromise(() =>
    recoverMessageAddress({
      message: input.message,
      signature: input.signature,
    })
  ).pipe(
    Effect.map((recovered) => isAddressEqual(recovered, input.address)),
    Effect.orElseSucceed(() => false)
  );

/** Local ecrecover only: externally owned accounts. */
export const SignatureVerifierEoa = Layer.succeed(SignatureVerifier)(
  SignatureVerifier.of({ verify: recoverMatches })
);

/**
 * ecrecover first; if that fails and HEDERA_RPC_URL is set, asks Hedera's EVM (ERC-1271 /
 * ERC-6492), so smart-contract wallets can sign in.
 */
export const SignatureVerifierLive = Layer.effect(SignatureVerifier)(
  Effect.gen(function* makeSignatureVerifier() {
    const rpcUrl = yield* Config.option(Config.String("HEDERA_RPC_URL"));
    if (Option.isNone(rpcUrl)) {
      return SignatureVerifier.of({ verify: recoverMatches });
    }
    const client = createPublicClient({
      chain: hederaTestnet,
      transport: http(rpcUrl.value),
    });
    return SignatureVerifier.of({
      verify: (input) =>
        recoverMatches(input).pipe(
          Effect.flatMap((ok) =>
            ok
              ? Effect.succeed(true)
              : Effect.tryPromise(() => client.verifyMessage(input)).pipe(
                  Effect.orElseSucceed(() => false)
                )
          )
        ),
    });
  })
);
