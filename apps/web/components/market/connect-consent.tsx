"use client";

import { useState } from "react";

import { useToast } from "@/components/app-shell/toast";
import { approveConnection, denyConnection } from "@/lib/api/actions";

/** Approve or deny a connector; either way the browser goes back to the client. */
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
  const [done, setDone] = useState<"approved" | "denied" | null>(null);
  const answer = async (approve: boolean) => {
    setBusy(true);
    const result = approve
      ? await approveConnection(grantId)
      : await denyConnection(grantId);
    if (!result.ok) {
      setBusy(false);
      toast({
        detail: result.error.message,
        title: "Connection not answered",
        tone: "error",
      });
      return;
    }
    setDone(approve ? "approved" : "denied");
    window.location.assign(result.data.redirectUrl);
  };
  if (done !== null) {
    return (
      <p
        className="bg-foam text-carbon text-body inline-flex min-h-12 items-center gap-2 self-start px-6 tracking-wider"
        role="status"
      >
        <span aria-hidden="true">✓</span>
        {done === "approved"
          ? `CONNECTED · RETURNING TO ${clientName.toUpperCase()}…`
          : `DENIED · RETURNING TO ${clientName.toUpperCase()}…`}
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-3">
      <button
        className="bg-amber text-carbon text-body disabled:bg-dark disabled:text-clay min-h-12 px-6 tracking-wider"
        disabled={busy}
        onClick={() => {
          void answer(true);
        }}
        type="button"
      >
        {busy ? "CONNECTING…" : `CONNECT ${clientName.toUpperCase()}`}
      </button>
      <button
        className="border-dark text-body text-cement disabled:text-clay min-h-12 border px-6"
        disabled={busy}
        onClick={() => {
          void answer(false);
        }}
        type="button"
      >
        DENY
      </button>
    </div>
  );
};
