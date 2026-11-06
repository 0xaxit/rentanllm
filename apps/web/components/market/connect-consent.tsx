"use client";

import { useState } from "react";

import { useToast } from "@/components/app-shell/toast";
import { approveConnection } from "@/lib/api/actions";

/** Approves a connector, then sends the browser back to the client. To decline, close the tab. */
export const ConnectConsent = ({
  clientName,
  grantId,
}: {
  clientName: string;
  grantId: string;
}) => {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  /** Set once answered: the page stays on this state while the browser leaves. */
  const [done, setDone] = useState(false);
  const approve = async () => {
    setBusy(true);
    const result = await approveConnection(grantId);
    if (!result.ok) {
      setBusy(false);
      toast({
        detail: result.error.message,
        title: "Connection not answered",
        tone: "error",
      });
      return;
    }
    setDone(true);
    window.location.assign(result.data.redirectUrl);
  };
  if (done) {
    return (
      <p
        className="bg-foam text-carbon text-body inline-flex min-h-12 items-center gap-2 px-6 tracking-wider"
        role="status"
      >
        <span aria-hidden="true">✓</span>
        CONNECTED · RETURNING TO {clientName.toUpperCase()}…
      </p>
    );
  }
  return (
    <button
      className="bg-amber text-carbon text-body disabled:bg-dark disabled:text-clay min-h-12 px-6 tracking-wider"
      disabled={busy}
      onClick={() => {
        void approve();
      }}
      type="button"
    >
      {busy ? "CONNECTING…" : `CONNECT ${clientName.toUpperCase()}`}
    </button>
  );
};
