"use client";

import { useState } from "react";

import { cx } from "@/lib/cx";

import { useToast } from "./app-shell/toast";

const COPIED_MS = 1800;

/** Copies `text`, flips its label to COPIED briefly and raises a toast. */
export const CopyButton = ({
  text,
  label,
  toast,
  variant = "dark",
  className,
}: {
  text: string;
  label: string;
  /** Toast title, e.g. "Key copied". */
  toast: string;
  variant?: "dark" | "outline" | "chip";
  className?: string;
}) => {
  const [copied, setCopied] = useState(false);
  const showToast = useToast();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      showToast({ sound: ["success", { emphasis: "subtle" }], title: toast });
      setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      showToast({
        detail: "select the text and copy it by hand",
        title: "Clipboard blocked",
        tone: "error",
      });
    }
  };

  return (
    <button
      data-cuelume-tap=""
      className={cx(
        "spring flex min-h-11 items-center justify-center px-3 text-sm leading-5",
        variant === "dark" && "bg-carbon text-enamel hover:bg-black",
        variant === "outline" &&
          "border-carbon text-carbon hover:bg-carbon hover:text-enamel border",
        variant === "chip" &&
          "border-dark text-cement hover:border-cement min-h-9 border",
        className
      )}
      onClick={() => {
        copy().catch(() => setCopied(false));
      }}
      type="button"
    >
      {copied ? "COPIED" : label}
    </button>
  );
};
