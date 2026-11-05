"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { addProviderAccount } from "@/lib/api/actions";
import type { Provider } from "@/lib/api/types";

import { BottomSheet } from "../app-shell/bottom-sheet";
import { useToast } from "../app-shell/toast";
import { Note } from "../primitives";

const PROVIDER: Provider = "ollama";
const DETECT_POLL_MS = 3000;

/**
 * Turns on selling open models from the node's Ollama. Nothing is asked for:
 * the node reports its Ollama on its first heartbeat (started with
 * `--ollama-model`), and the sheet waits for that before it can be added.
 * During setup it opens by itself (`autoOpen`) and moves on to `nextHref`.
 */
export const AddAccount = ({
  nodeId,
  detectedPlans,
  autoOpen = false,
  nextHref,
  primary = false,
}: {
  nodeId: string;
  detectedPlans: Readonly<Record<string, string>>;
  autoOpen?: boolean;
  nextHref?: string | undefined;
  /** It is this node's next step: show it as the main action. */
  primary?: boolean;
}) => {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(autoOpen);
  const [busy, setBusy] = useState(false);
  const detected = detectedPlans[PROVIDER];
  const waiting = open && detected === undefined;

  // The node reports its Ollama on its first heartbeat; refresh until it lands.
  useEffect(() => {
    if (!waiting) {
      return;
    }
    const timer = setInterval(() => router.refresh(), DETECT_POLL_MS);
    return () => clearInterval(timer);
  }, [router, waiting]);

  const submit = async () => {
    setBusy(true);
    const result = await addProviderAccount(nodeId, { provider: PROVIDER });
    setBusy(false);
    if (!result.ok) {
      toast({
        detail: result.error.message,
        title: "Not turned on",
        tone: "error",
      });
      return;
    }
    toast({ detail: result.data.planTier, title: "Open models on" });
    setOpen(false);
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
            : "border-dark text-cement hover:border-cement min-h-11 border px-3 text-sm leading-5"
        }
        onClick={() => setOpen(true)}
        type="button"
      >
        + OPEN MODELS
      </button>
      <BottomSheet
        kicker="OLLAMA"
        onClose={() => setOpen(false)}
        open={open}
        title="Sell open models from this node?"
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit().catch(() => setBusy(false));
          }}
        >
          <div className="flex flex-col gap-1.5">
            <p className="text-label text-clay">REPORTED BY YOUR NODE</p>
            {detected === undefined ? (
              <p className="bg-soot border-dark text-cement text-body flex min-h-12 items-center border px-3 leading-5.25 motion-safe:animate-pulse">
                waiting for your node to report its Ollama…
              </p>
            ) : (
              <p className="bg-soot border-foam text-enamel text-body flex min-h-12 items-center gap-2.5 border px-3 leading-5.25">
                <span aria-hidden="true" className="text-foam">
                  ✓
                </span>
                {detected}
              </p>
            )}
            <Note>
              start the node with --ollama-model, e.g. llama3.1:8b. requests
              only reach models you list.
            </Note>
          </div>
          <button
            data-cuelume-tap=""
            className="bg-amber text-carbon text-body h-12 leading-5.25 disabled:opacity-60"
            disabled={busy || detected === undefined}
            type="submit"
          >
            {busy ? "TURNING ON…" : "SELL OPEN MODELS"}
          </button>
        </form>
      </BottomSheet>
    </>
  );
};
