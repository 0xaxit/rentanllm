/**
 * The chain market payments settle on: Hedera testnet, paying Circle's testnet USDC
 * (HTS token, 6 decimals). The payer signs a TransferTransaction and the facilitator
 * submits it and pays the fee, so the requirements carry the facilitator's `feePayer`
 * account, and `payTo` is a `0.0.x` account id rather than an EVM address.
 */
export interface PaymentChain {
  readonly assetAddress: string;
  /** Short name used in messages. */
  readonly name: string;
  /** CAIP-2 network id used by x402 v2. */
  readonly network: `${string}:${string}`;
}

export const HEDERA_TESTNET: PaymentChain = {
  assetAddress: "0.0.429274",
  name: "hedera-testnet",
  network: "hedera:testnet",
};
