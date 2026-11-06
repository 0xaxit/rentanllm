"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { parseEventLogs } from "viem";
import {
  useAccount,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

import { useToast } from "@/components/app-shell/toast";
import { appChain } from "@/components/wallet/wagmi-config";
import { linkNodeIdentity } from "@/lib/api/actions";
import type { NodeIdentity } from "@/lib/api/types";
import { evmAddressUrl, evmTxUrl, shortTx } from "@/lib/explorer";

import { GroupedList, GroupedRow } from "../app-shell/grouped-list";
import { LocalTime } from "../local-time";
import { Note } from "../primitives";

const identityAbi = [
  {
    inputs: [{ name: "agentURI", type: "string" }],
    name: "register",
    outputs: [{ name: "agentId", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "agentId", type: "uint256" },
      { indexed: false, name: "agentURI", type: "string" },
      { indexed: true, name: "owner", type: "address" },
    ],
    name: "Registered",
    type: "event",
  },
] as const;

const AGENT_ID = /^\d+$/u;
const UAID_HEAD = 22;

const errorMessage = (cause: unknown): string => {
  if (cause instanceof Error) {
    const short = (cause as { shortMessage?: unknown }).shortMessage;
    return typeof short === "string" ? short : cause.message;
  }
  return String(cause);
};

const ExternalLink = ({ href, label }: { href: string; label: string }) => (
  <a
    className="text-amber underline"
    href={href}
    rel="noopener noreferrer"
    target="_blank"
  >
    {label}
  </a>
);

/** A linked agent: its id, UAID, files and the monitor's last on-chain report. */
const LinkedAgent = ({ identity }: { identity: NodeIdentity }) => {
  const { agent } = identity;
  if (agent === null) {
    return null;
  }
  return (
    <GroupedList
      footer={
        identity.monitorAddress === null
          ? "reputation posts are off on this deployment"
          : `reputation is posted every 6 hours by ${identity.monitorAddress}`
      }
      title="ON-CHAIN AGENT · ERC-8004"
    >
      <GroupedRow
        label="Agent"
        tone="amber"
        value={
          <ExternalLink
            href={evmAddressUrl(identity.identityRegistry)}
            label={`#${agent.agentId}`}
          />
        }
      />
      <GroupedRow
        label="HCS-14 UAID"
        value={
          <span className="break-all" title={agent.uaid}>
            {agent.uaid.slice(0, UAID_HEAD)}…
          </span>
        }
      />
      <GroupedRow
        label="Registration file"
        value={<ExternalLink href={identity.registrationUrl} label="open" />}
      />
      <GroupedRow
        label="Last reputation post"
        value={
          agent.lastReportedAt === null || agent.lastFeedbackTx === null ? (
            "not yet"
          ) : (
            <>
              <LocalTime value={agent.lastReportedAt} /> ·{" "}
              <ExternalLink
                href={evmTxUrl(agent.lastFeedbackTx)}
                label={shortTx(agent.lastFeedbackTx)}
              />
            </>
          )
        }
      />
    </GroupedList>
  );
};

/**
 * Registers the node as an ERC-8004 agent from the owner's wallet on Hedera testnet, then
 * links it here. The transaction's fee is paid in HBAR by the owner's wallet.
 */
export const AgentIdentity = ({
  identity,
  nodeId,
}: {
  identity: NodeIdentity;
  nodeId: string;
}) => {
  const router = useRouter();
  const toast = useToast();
  const inputId = useId();
  const { chainId, isConnected } = useAccount();
  const client = usePublicClient({ chainId: appChain.id });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState<string | null>(null);
  const [manualId, setManualId] = useState("");

  if (identity.agent !== null) {
    return <LinkedAgent identity={identity} />;
  }

  const link = async (agentId: string) => {
    setBusy("LINKING…");
    const result = await linkNodeIdentity(nodeId, agentId);
    setBusy(null);
    if (!result.ok) {
      toast({
        detail: result.error.message,
        title: "Agent not linked",
        tone: "error",
      });
      return;
    }
    toast({
      detail: `Agent #${agentId} now carries this node's reputation`,
      title: "Agent linked",
    });
    router.refresh();
  };

  const register = async () => {
    if (client === undefined) {
      return;
    }
    try {
      if (chainId !== appChain.id) {
        setBusy("SWITCHING TO HEDERA…");
        await switchChainAsync({ chainId: appChain.id });
      }
      setBusy("CONFIRM IN WALLET…");
      const hash = await writeContractAsync({
        abi: identityAbi,
        address: identity.identityRegistry as `0x${string}`,
        args: [identity.registrationUrl],
        chainId: appChain.id,
        functionName: "register",
      });
      setBusy("REGISTERING…");
      const receipt = await client.waitForTransactionReceipt({ hash });
      const [event] = parseEventLogs({
        abi: identityAbi,
        eventName: "Registered",
        logs: receipt.logs,
      });
      if (event === undefined) {
        throw new Error("The transaction emitted no Registered event");
      }
      await link(event.args.agentId.toString());
    } catch (error) {
      setBusy(null);
      toast({
        detail: errorMessage(error),
        title: "Registration failed",
        tone: "error",
      });
    }
  };

  const validManual = AGENT_ID.test(manualId);
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-label tracking-label text-mud pl-1">
        ON-CHAIN AGENT · ERC-8004
      </h2>
      <div className="border-soot flex flex-col gap-4 border bg-black p-4">
        <p className="text-body text-cement">
          Register this node as an agent on Hedera&apos;s ERC-8004 registry.
          Your wallet owns the agent; the platform posts its uptime, time to
          first byte and success rate as on-chain reputation buyers can check.
        </p>
        <Note>
          the transaction fee is paid in HBAR from your wallet · get testnet
          HBAR at portal.hedera.com
        </Note>
        <button
          className="bg-amber text-carbon text-body disabled:bg-dark disabled:text-clay min-h-12 self-start px-6 tracking-wider"
          disabled={!isConnected || busy !== null}
          onClick={() => {
            void register();
          }}
          type="button"
        >
          {busy ?? (isConnected ? "REGISTER AS AGENT" : "CONNECT WALLET FIRST")}
        </button>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (validManual && busy === null) {
              void link(manualId);
            }
          }}
        >
          <label className="flex flex-col gap-1.5" htmlFor={inputId}>
            <span className="text-label text-clay">
              ALREADY REGISTERED? AGENT ID
            </span>
            <input
              autoComplete="off"
              className="bg-soot border-dark text-body text-enamel focus:border-amber min-h-10 w-40 border px-2.5 outline-none"
              id={inputId}
              inputMode="numeric"
              onChange={(event) =>
                setManualId(event.currentTarget.value.trim())
              }
              placeholder="e.g. 42"
              value={manualId}
            />
          </label>
          <button
            className="border-dark text-body text-cement disabled:text-clay min-h-10 border px-4"
            disabled={!validManual || busy !== null}
            type="submit"
          >
            LINK
          </button>
        </form>
      </div>
    </section>
  );
};
