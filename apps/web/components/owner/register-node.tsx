"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useState } from "react";

import { listNodes, registerNode, rotateNodeToken } from "@/lib/api/actions";
import type { RegisteredNode } from "@/lib/api/types";
import { GATEWAY_URL } from "@/lib/env";
import { nodeStartCommand, nodeStartCommandWithEnv } from "@/lib/node-command";
import { nodeHref } from "@/lib/setup-steps";
import { cue } from "@/lib/sound";

import { BottomSheet } from "../app-shell/bottom-sheet";
import { useToast } from "../app-shell/toast";
import { CopyButton } from "../copy-button";
import { Note } from "../primitives";

const Secret = ({
  label,
  value,
  toast,
}: {
  label: string;
  value: string;
  toast: string;
}) => (
  <div className="bg-foam flex flex-col gap-2 p-4">
    <p className="text-label text-dark">{label}</p>
    <p className="text-carbon text-body leading-5.25 break-all select-all">
      {value}
    </p>
    <CopyButton label={`COPY ${label}`} text={value} toast={toast} />
  </div>
);

const Command = ({ text, label }: { text: string; label: string }) => (
  <div className="border-soot flex flex-col gap-2 border bg-black p-3">
    <pre className="text-cement overflow-x-auto text-sm leading-5 break-all whitespace-pre-wrap">
      <code>{text}</code>
    </pre>
    <CopyButton
      label={label}
      text={text}
      toast="Command copied"
      variant="chip"
    />
  </div>
);

const POLL_MS = 2000;
/** How long the success state stays up before the sheet closes itself. */
const CONNECTED_HOLD_MS = 1600;
/** Longer during setup, so "step 1 done" registers before moving on. */
const SETUP_HOLD_MS = 2600;

/**
 * Polls the owner's nodes until this node's tunnel opens after the token was
 * issued. The gateway stamps `connectedAt` on every NodeHello, and only the
 * new token can open a tunnel once it is issued, so any change from the
 * value at issue time means the agent started with this command connected.
 */
const useConnectedSince = (issued: RegisteredNode) => {
  const [connected, setConnected] = useState(false);
  const nodeId = issued.node.id;
  const baseline = issued.node.connectedAt?.getTime() ?? null;
  useEffect(() => {
    if (connected) {
      return;
    }
    let stopped = false;
    const check = async () => {
      const result = await listNodes();
      if (stopped || !result.ok) {
        return;
      }
      const node = result.data.find((n) => n.id === nodeId);
      const at = node?.connectedAt?.getTime() ?? null;
      if (node?.status === "online" && at !== null && at !== baseline) {
        setConnected(true);
      }
    };
    const timer = window.setInterval(() => {
      check().catch(() => null);
    }, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [connected, nodeId, baseline]);
  return connected;
};

const Connected = ({ setup }: { setup: boolean }) => (
  <div className="flex flex-col gap-3" role="status">
    <div className="bg-foam text-carbon flex items-center gap-3 p-4">
      <span
        aria-hidden="true"
        className="bg-carbon text-foam text-title flex size-10 shrink-0 items-center justify-center"
      >
        ✓
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-label text-dark">
          {setup ? "STEP 1 OF 3 · DONE" : "NODE ONLINE"}
        </span>
        <span className="text-title leading-6.5">Your node is connected.</span>
      </span>
    </div>
    {setup && (
      <p className="text-amber text-body flex items-center gap-2 leading-5.25">
        <span
          aria-hidden="true"
          className="bg-amber size-2 motion-safe:animate-pulse"
        />
        Next: turn on open models…
      </p>
    )}
  </div>
);

const Issued = ({
  issued,
  onConnected,
  setup,
}: {
  issued: RegisteredNode;
  onConnected: () => void;
  /** Part of first-time setup: say which step finished and what comes next. */
  setup: boolean;
}) => {
  const connected = useConnectedSince(issued);
  const finish = useEffectEvent(onConnected);
  useEffect(() => {
    if (!connected) {
      return;
    }
    cue("success", { emphasis: "strong" });
    const timer = window.setTimeout(
      finish,
      setup ? SETUP_HOLD_MS : CONNECTED_HOLD_MS
    );
    return () => window.clearTimeout(timer);
  }, [connected, setup]);
  if (connected) {
    return <Connected setup={setup} />;
  }
  const input = {
    gatewayUrl: GATEWAY_URL,
    nodeId: issued.node.id,
    nodeToken: issued.nodeToken,
  };
  return (
    <div className="flex flex-col gap-4">
      <p
        className="border-pumpkin text-pumpkin border px-3 py-2 text-sm leading-5"
        role="alert"
      >
        Copy the node token now. It is shown once and only its hash is stored.
        Lost it? Use GET CONNECT COMMAND on the node card for a new one.
      </p>
      <Secret label="NODE ID" toast="Node id copied" value={issued.node.id} />
      <Secret
        label="NODE TOKEN"
        toast="Node token copied"
        value={issued.nodeToken}
      />
      <div className="flex flex-col gap-2">
        <p className="text-label tracking-label text-mud">START THE AGENT</p>
        <Command label="COPY COMMAND" text={nodeStartCommand(input)} />
        <Note>
          safer on shared machines: keep the token out of `ps` with the env var
        </Note>
        <Command
          label="COPY ENV VERSION"
          text={nodeStartCommandWithEnv(input)}
        />
      </div>
      <p
        aria-live="polite"
        className="text-label tracking-label text-mud flex items-center gap-2"
      >
        <span
          aria-hidden="true"
          className="bg-amber size-2 motion-safe:animate-pulse"
        />
        WAITING FOR THE AGENT TO CONNECT…
      </p>
    </div>
  );
};

/**
 * Shows the connect command again for an existing node. The token is stored
 * only as a hash, so this issues a new one (POST /owner/nodes/:id/token); an
 * agent already running with the old token keeps its tunnel until it
 * reconnects, then needs the new one.
 */
export const NodeConnectCommand = ({
  nodeId,
  connected,
  nextHref,
  primary = false,
}: {
  nodeId: string;
  connected: boolean;
  /** The node's next setup step, opened once the agent connects. */
  nextHref?: string | undefined;
  /** It is this node's next step: show it as the main action. */
  primary?: boolean;
}) => {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<RegisteredNode | null>(null);

  const rotate = async () => {
    setBusy(true);
    const result = await rotateNodeToken(nodeId);
    setBusy(false);
    if (!result.ok) {
      toast({
        detail: result.error.message,
        title: "No new token",
        tone: "error",
      });
      return;
    }
    setIssued(result.data);
  };

  const close = () => {
    setOpen(false);
    if (issued) {
      setIssued(null);
      router.refresh();
    }
  };
  const advance = () => {
    setOpen(false);
    setIssued(null);
    if (nextHref) {
      router.push(nextHref);
    } else {
      router.refresh();
    }
  };

  return (
    <>
      <button
        data-cuelume-tap=""
        className={
          primary
            ? "spring bg-amber text-carbon text-body min-h-11 w-full px-4 leading-5.25 md:w-fit"
            : "spring border-dark text-enamel hover:border-amber text-body min-h-11 w-full border px-4 leading-5.25 md:w-fit"
        }
        onClick={() => setOpen(true)}
        type="button"
      >
        GET CONNECT COMMAND
      </button>
      <BottomSheet
        kicker="NODE AGENT"
        onClose={close}
        open={open}
        title={issued ? "New connect command" : "Get the connect command"}
      >
        {issued ? (
          <Issued
            issued={issued}
            onConnected={advance}
            setup={nextHref !== undefined}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-cement text-sm leading-5">
              Node tokens are stored only as a hash, so the old one can&apos;t
              be shown again. This issues a new token and a fresh command; the
              old token stops working.
            </p>
            {connected && (
              <p
                className="border-pumpkin text-pumpkin border px-3 py-2 text-sm leading-5"
                role="alert"
              >
                This node is online. Its agent keeps running until it
                reconnects, then it needs the new token.
              </p>
            )}
            <button
              data-cuelume-tap=""
              className="bg-amber text-carbon text-body h-12 leading-5.25 disabled:opacity-60"
              disabled={busy}
              onClick={() => {
                rotate().catch(() => setBusy(false));
              }}
              type="button"
            >
              {busy ? "ISSUING…" : "ISSUE NEW TOKEN"}
            </button>
          </div>
        )}
      </BottomSheet>
    </>
  );
};

/**
 * Registers a node (POST /owner/nodes) and shows its one-time token. The
 * region is not asked for: the gateway works it out from where the agent
 * connects from. Once the agent connects, the new node's next step (adding
 * its plan) opens, whether it is the owner's first node or a later one.
 */
export const RegisterNode = ({
  hasNodes,
  autoOpen = false,
}: {
  hasNodes: boolean;
  autoOpen?: boolean;
}) => {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(autoOpen);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<RegisteredNode | null>(null);

  const submit = async () => {
    setBusy(true);
    const result = await registerNode();
    setBusy(false);
    if (!result.ok) {
      toast({
        detail: result.error.message,
        title: "Not registered",
        tone: "error",
      });
      return;
    }
    setIssued(result.data);
  };

  const close = () => {
    setOpen(false);
    if (issued) {
      setIssued(null);
      router.refresh();
    }
  };
  const advance = () => {
    setOpen(false);
    setIssued(null);
    if (issued) {
      router.push(nodeHref(issued.node.id, { next: "plan" }));
    }
  };

  return (
    <>
      <button
        data-cuelume-tap=""
        className="spring bg-amber text-carbon text-body h-12 w-full leading-5.25 md:w-fit md:px-6"
        onClick={() => setOpen(true)}
        type="button"
      >
        {hasNodes ? "REGISTER ANOTHER NODE" : "REGISTER YOUR NODE"}
      </button>
      <BottomSheet
        kicker="NODE AGENT"
        onClose={close}
        open={open}
        title={issued ? "Your node is registered" : "Register a node"}
      >
        {issued ? (
          <Issued issued={issued} onConnected={advance} setup />
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              submit().catch(() => setBusy(false));
            }}
          >
            <p className="text-cement text-sm leading-5">
              The node agent runs on your machine, keeps your login there and
              connects out to the gateway. You get a node id and a one-time
              token to start it with.
            </p>
            <button
              data-cuelume-tap=""
              className="bg-amber text-carbon text-body h-12 leading-5.25 disabled:opacity-60"
              disabled={busy}
              type="submit"
            >
              {busy ? "REGISTERING…" : "GET NODE TOKEN"}
            </button>
          </form>
        )}
      </BottomSheet>
    </>
  );
};
