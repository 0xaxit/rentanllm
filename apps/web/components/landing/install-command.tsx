"use client";

import { useState } from "react";

import { NODE_INSTALL_COMMAND } from "@/lib/node-install";

const COPIED_MS = 1800;

/** The node agent's one-line install, with a copy button. No toast: the landing has no ToastProvider. */
export const InstallCommand = () => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(NODE_INSTALL_COMMAND);
    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_MS);
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
      <pre className="text-cement min-w-0 flex-1 overflow-x-auto bg-black p-3 text-sm leading-5">
        <span className="text-mud select-none">$ </span>
        {NODE_INSTALL_COMMAND}
      </pre>
      <button
        aria-live="polite"
        className="spring border-enamel text-enamel hover:bg-enamel hover:text-carbon flex min-h-11 shrink-0 items-center justify-center border px-4 text-sm leading-5"
        data-cuelume-tap=""
        onClick={() => {
          copy().catch(() => setCopied(false));
        }}
        type="button"
      >
        {copied ? "COPIED" : "COPY"}
      </button>
    </div>
  );
};
