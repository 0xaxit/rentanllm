"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { erc20Abi } from "viem";
import {
  useAccount,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

import { GroupedList, GroupedRow } from "@/components/app-shell/grouped-list";
import { useToast } from "@/components/app-shell/toast";
import { Note } from "@/components/primitives";
import { appChain } from "@/components/wallet/wagmi-config";
import { createAgentWallet } from "@/lib/api/actions";
import type { AgentWallet } from "@/lib/api/types";
import { USDC_EVM_ADDRESS } from "@/lib/env";
import {
  formatUsdExact,
  parseOptionalUsdInput,
  sanitizePriceInput,
} from "@/lib/money";

/** The mirror node shows a new balance a few seconds after consensus. */
const MIRROR_LAG_MS = 6000;
/** How long the button shows the success state after the balance refreshes. */
const SENT_MS = 4000;

const errorMessage = (cause: unknown): string => {
  if (cause instanceof Error) {
    const short = (cause as { shortMessage?: unknown }).shortMessage;
    return typeof short === "string" ? short : cause.message;
  }
  return String(cause);
};

/**
 * The buyer's agent wallet: created once, then topped up with USDC from the connected
 * wallet (an ERC-20 transfer on the USDC token's facade on Hedera testnet).
 */
export const AgentWalletCard = ({ wallet }: { wallet: AgentWallet | null }) => {
  const router = useRouter();
  const toast = useToast();
  const amountId = useId();
  const { chainId, isConnected } = useAccount();
  const client = usePublicClient({ chainId: appChain.id });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState<string | null>(null);
  const [amount, setAmount] = useState("1");
  /** The amount just sent: the button shows a success state while it is set. */
  const [sent, setSent] = useState<bigint | null>(null);

  if (wallet === null) {
    return (
      <div className="border-soot flex flex-col items-start gap-3 border bg-black p-4">
        <p className="text-body text-cement">
          Claude pays sellers from an agent wallet: a Hedera account just for
          your agents. You decide how much USDC goes in, and your Budget limits
          apply to it.
        </p>
        <button
          className="bg-amber text-carbon text-body disabled:bg-dark disabled:text-clay min-h-12 px-6 tracking-wider"
          disabled={busy !== null}
          onClick={async () => {
            setBusy("CREATING ON HEDERA…");
            const result = await createAgentWallet();
            setBusy(null);
            if (!result.ok) {
              toast({
                detail: result.error.message,
                title: "Agent wallet not created",
                tone: "error",
              });
              return;
            }
            toast({
              detail: `${result.data.accountId} is ready for USDC`,
              title: "Agent wallet created",
            });
            router.refresh();
          }}
          type="button"
        >
          {busy ?? "CREATE AGENT WALLET"}
        </button>
      </div>
    );
  }

  const parsed = parseOptionalUsdInput(amount);
  const micros = parsed.ok ? parsed.value : null;
  const valid = micros !== null && micros > 0n;

  const fund = async () => {
    if (client === undefined || micros === null) {
      return;
    }
    try {
      if (chainId !== appChain.id) {
        setBusy("SWITCHING TO HEDERA…");
        await switchChainAsync({ chainId: appChain.id });
      }
      setBusy("CONFIRM IN WALLET…");
      const hash = await writeContractAsync({
        abi: erc20Abi,
        address: USDC_EVM_ADDRESS,
        args: [wallet.evmAddress as `0x${string}`, micros],
        chainId: appChain.id,
        functionName: "transfer",
      });
      setBusy("SENDING…");
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error(
          "The transfer reverted. Does your wallet hold that much USDC?"
        );
      }
      toast({
        detail: `${formatUsdExact(micros)} sent to ${wallet.accountId}`,
        title: "Agent wallet topped up",
      });
      setBusy(null);
      setSent(micros);
      // Refresh once the mirror node has the new balance, then return to the form.
      setTimeout(() => {
        router.refresh();
        setTimeout(() => setSent(null), SENT_MS);
      }, MIRROR_LAG_MS);
    } catch (error) {
      setBusy(null);
      toast({ detail: errorMessage(error), title: "Not sent", tone: "error" });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <GroupedList
        footer="Claude pays from this account · your Budget limits apply to it"
        title="AGENT WALLET"
      >
        <GroupedRow
          href={`https://hashscan.io/testnet/account/${wallet.accountId}`}
          label={wallet.accountId}
          tone="amber"
          value="HashScan →"
        />
        <GroupedRow
          label="Balance"
          value={
            wallet.usdcBalance === null
              ? "unknown"
              : `${formatUsdExact(wallet.usdcBalance)}`
          }
        />
      </GroupedList>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && busy === null && sent === null) {
            void fund();
          }
        }}
      >
        <label className="flex flex-col gap-1.5" htmlFor={amountId}>
          <span className="text-label text-clay">ADD USDC</span>
          <input
            autoComplete="off"
            className="bg-soot border-dark text-body text-enamel focus:border-amber min-h-12 w-32 border px-2.5 outline-none"
            id={amountId}
            inputMode="decimal"
            onChange={(event) =>
              setAmount(sanitizePriceInput(event.currentTarget.value))
            }
            value={amount}
          />
        </label>
        {sent === null ? (
          <button
            className="bg-amber text-carbon text-body disabled:bg-dark disabled:text-clay min-h-12 px-6 tracking-wider"
            disabled={!isConnected || !valid || busy !== null}
            type="submit"
          >
            {busy ?? "SEND FROM MY WALLET"}
          </button>
        ) : (
          <p
            className="bg-foam text-carbon text-body inline-flex min-h-12 items-center gap-2 px-6 tracking-wider"
            role="status"
          >
            <span aria-hidden="true">✓</span>
            SENT {formatUsdExact(sent)}
          </p>
        )}
      </form>
      <Note>
        a USDC transfer on Hedera testnet from your connected wallet · it pays
        the fee in HBAR
      </Note>
    </div>
  );
};
