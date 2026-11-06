/**
 * Creates buyers' agent wallets on Hedera testnet. The platform operator pays the account
 * creation and the USDC association; the new account needs no HBAR afterwards, because
 * the x402 facilitator pays every payment's fee.
 */
import {
  AccountCreateTransaction,
  AccountId,
  Client,
  Hbar,
  PrivateKey,
  TokenAssociateTransaction,
} from "@hashgraph/sdk";
import {
  Config,
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Redacted,
} from "effect";

import { USDC_TOKEN_ID } from "./mirror";

const TIMEOUT = Duration.seconds(60);

export interface NewAgentWallet {
  readonly accountId: string;
  readonly evmAddress: string;
  /** "0x" + 64 hex. */
  readonly privateKeyHex: string;
}

export class AgentWalletChain extends Context.Service<
  AgentWalletChain,
  {
    /** Seals and opens wallet keys (AES-256-GCM); null when no AGENT_WALLET_KEK is set. */
    readonly kek: string | null;
    readonly create: () => Effect.Effect<NewAgentWallet, Error>;
  }
>()("@rentanllm/api/AgentWalletChain") {}

const settings = Config.all({
  kek: Config.option(Config.Redacted("AGENT_WALLET_KEK")),
  operatorId: Config.option(Config.String("HEDERA_OPERATOR_ID")),
  operatorKey: Config.option(Config.Redacted("HEDERA_OPERATOR_KEY")),
});

const createOnChain = async (
  operatorId: string,
  operatorKey: string
): Promise<NewAgentWallet> => {
  const client = Client.forTestnet().setOperator(
    AccountId.fromString(operatorId),
    PrivateKey.fromStringECDSA(operatorKey)
  );
  try {
    const key = PrivateKey.generateECDSA();
    const create = await new AccountCreateTransaction()
      .setECDSAKeyWithAlias(key)
      .setInitialBalance(new Hbar(0))
      .setMaxAutomaticTokenAssociations(-1)
      .freezeWith(client);
    const signedCreate = await create.sign(key);
    const created = await signedCreate.execute(client);
    const { accountId } = await created.getReceipt(client);
    if (accountId === null) {
      throw new Error("account creation returned no account id");
    }
    const associate = await new TokenAssociateTransaction()
      .setAccountId(accountId)
      .setTokenIds([USDC_TOKEN_ID])
      .freezeWith(client);
    const signedAssociate = await associate.sign(key);
    const associated = await signedAssociate.execute(client);
    await associated.getReceipt(client);
    return {
      accountId: accountId.toString(),
      evmAddress: `0x${key.publicKey.toEvmAddress()}`.toLowerCase(),
      privateKeyHex: `0x${key.toStringRaw()}`,
    };
  } finally {
    client.close();
  }
};

export const AgentWalletChainLive = Layer.effect(AgentWalletChain)(
  Effect.gen(function* makeAgentWalletChain() {
    const { kek, operatorId, operatorKey } = yield* settings;
    const kekHex = Option.match(kek, {
      onNone: () => null,
      onSome: (value) => Redacted.value(value),
    });
    if (Option.isNone(operatorId) || Option.isNone(operatorKey)) {
      return AgentWalletChain.of({
        create: () =>
          Effect.fail(
            new Error(
              "agent wallets are off: HEDERA_OPERATOR_ID/KEY are not set"
            )
          ),
        kek: kekHex,
      });
    }
    return AgentWalletChain.of({
      create: () =>
        Effect.tryPromise({
          catch: (cause) =>
            cause instanceof Error ? cause : new Error(String(cause)),
          try: () =>
            createOnChain(operatorId.value, Redacted.value(operatorKey.value)),
        }).pipe(Effect.timeout(TIMEOUT)),
      kek: kekHex,
    });
  })
);

const TEST_KEK = "11".repeat(32);

/** For tests: wallets 0.0.9001, 0.0.9002, ... with throwaway keys. */
export const agentWalletChainStub = () => {
  let next = 9001;
  return Layer.succeed(AgentWalletChain)(
    AgentWalletChain.of({
      create: () =>
        Effect.sync(() => {
          const key = PrivateKey.generateECDSA();
          const accountId = `0.0.${next}`;
          next += 1;
          return {
            accountId,
            evmAddress: `0x${key.publicKey.toEvmAddress()}`,
            privateKeyHex: `0x${key.toStringRaw()}`,
          };
        }),
      kek: TEST_KEK,
    })
  );
};
