"use client";

import type { PlayOptions, SoundName } from "cuelume";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import { cx } from "@/lib/cx";
import { cue } from "@/lib/sound";

const TOAST_MS = 3200;

export interface ToastInput {
  readonly title: string;
  readonly detail?: string;
  readonly tone?: "info" | "error";
  /**
   * The cue for what the toast reports. Defaults: error -> "error",
   * info -> a subtle "ready". Pass "success" for confirmed outcomes.
   */
  readonly sound?: SoundName | readonly [SoundName, PlayOptions];
}

const playToastSound = (input: ToastInput) => {
  if (input.sound) {
    const [name, options] =
      typeof input.sound === "string" ? [input.sound, undefined] : input.sound;
    cue(name, options);
    return;
  }
  if (input.tone === "error") {
    cue("error");
    return;
  }
  cue("ready", { emphasis: "subtle" });
};

interface ToastItem extends ToastInput {
  readonly id: number;
}

type ShowToast = (toast: ToastInput) => void;

const ToastContext = createContext<ShowToast | null>(null);

/** Shows a toast: a light slip under the status bar, announced politely. */
export const useToast = (): ShowToast => {
  const show = use(ToastContext);
  if (show === null) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return show;
};

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextId = useRef(0);

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    []
  );

  const show = useCallback<ShowToast>((input) => {
    nextId.current += 1;
    playToastSound(input);
    setToast({ ...input, id: nextId.current });
    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext value={value}>
      {children}
      <div
        aria-live="polite"
        className="pt-toast pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 md:inset-x-auto md:top-auto md:right-6 md:bottom-6 md:px-0 md:pt-0 md:[--toast-from:12px]"
        role="status"
      >
        {toast && (
          <p
            className="bg-enamel animate-toast-in shadow-slip flex min-h-12 w-full max-w-110 items-start gap-2.5 px-3.5 py-2.5 md:w-90"
            key={toast.id}
          >
            <span
              aria-hidden="true"
              className={cx(
                "mt-1.5 size-2 shrink-0",
                toast.tone === "error" ? "bg-pumpkin" : "bg-amber"
              )}
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-carbon text-sm leading-5">
                {toast.title}
              </span>
              {toast.detail && (
                <span className="text-label text-clay">{toast.detail}</span>
              )}
            </span>
          </p>
        )}
      </div>
    </ToastContext>
  );
};
