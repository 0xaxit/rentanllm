/**
 * Buyers' agent wallets: the Hedera account the remote MCP server pays sellers from. One
 * per user, created on request, topped up by the buyer with USDC from their own wallet.
 */
import { InvalidRequest } from "@rentanllm/api-contract";
import type { AgentWallet } from "@rentanllm/api-contract";
import { Db } from "@rentanllm/db";
import { agentWallets } from "@rentanllm/db/schema";
import { eq } from "drizzle-orm";
import { Effect } from "effect";

import { dieOnDbError } from "../db-errors";
import { AgentWalletChain } from "../hedera/agent-wallets";
import { openKey, sealKey } from "../hedera/key-box";
import { HederaMirror } from "../hedera/mirror";

type WalletRow = typeof agentWallets.$inferSelect;

const walletRow = Effect.fn("agentWallet.row")(function* walletRowGen(
  userId: string
) {
  const db = yield* Db;
  const [row] = yield* db
    .select()
    .from(agentWallets)
    .where(eq(agentWallets.userId, userId));
  return row ?? null;
});

const toWallet = Effect.fn("agentWallet.toWallet")(function* toWalletGen(
  row: WalletRow
) {
  const mirror = yield* HederaMirror;
  return {
    accountId: row.accountId,
    evmAddress: row.evmAddress,
    usdcBalance: yield* mirror.usdcBalance(row.accountId),
  } satisfies AgentWallet;
});

export const agentWalletOf = Effect.fn("agentWallet.get")(
  function* agentWalletOfGen(userId: string) {
    const row = yield* walletRow(userId);
    return row === null ? null : yield* toWallet(row);
  },
  dieOnDbError
);

export const createAgentWallet = Effect.fn("agentWallet.create")(
  function* createAgentWalletGen(userId: string) {
    const existing = yield* walletRow(userId);
    if (existing !== null) {
      return yield* toWallet(existing);
    }
    const chain = yield* AgentWalletChain;
    if (chain.kek === null) {
      return yield* new InvalidRequest({
        message: "Agent wallets are off on this deployment",
      });
    }
    const { kek } = chain;
    const created = yield* chain.create().pipe(
      Effect.mapError(
        (cause) =>
          new InvalidRequest({
            message: `Could not create the agent wallet: ${cause.message}`,
          })
      )
    );
    const db = yield* Db;
    yield* db
      .insert(agentWallets)
      .values({
        accountId: created.accountId,
        encryptedKey: sealKey(kek, created.privateKeyHex),
        evmAddress: created.evmAddress.toLowerCase(),
        userId,
      })
      // Two creates at once: the first insert wins; the other account stays unused.
      .onConflictDoNothing({ target: agentWallets.userId });
    const row = yield* walletRow(userId);
    if (row === null) {
      return yield* Effect.die(
        new Error("agent wallet insert returned no row")
      );
    }
    yield* Effect.annotateCurrentSpan({
      "agent_wallet.account": row.accountId,
    });
    return yield* toWallet(row);
  },
  dieOnDbError
);

/** The wallet's account and key, for signing one payment; null without a wallet. */
export const agentWalletSigner = Effect.fn("agentWallet.signer")(
  function* agentWalletSignerGen(userId: string) {
    const row = yield* walletRow(userId);
    const chain = yield* AgentWalletChain;
    if (row === null || chain.kek === null) {
      return null;
    }
    return {
      accountId: row.accountId,
      privateKeyHex: openKey(chain.kek, row.encryptedKey),
    };
  },
  dieOnDbError
);
