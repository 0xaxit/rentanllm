"use client";

import { useEffect, useId, useRef } from "react";
import type { MouseEvent, ReactNode } from "react";

import { cx } from "@/lib/cx";
import { cue } from "@/lib/sound";

/**
 * Bottom sheet on phones, centred panel on desktop. Built on the native modal
 * <dialog>: focus moves in and is trapped, Escape closes it, the page behind is
 * inert, and focus returns to the opener on close.
 */
export const BottomSheet = ({
  open,
  onClose,
  title,
  kicker,
  kickerTone = "mud",
  trailing,
  wide = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  kicker?: string;
  kickerTone?: "mud" | "pumpkin" | "amber";
  trailing?: ReactNode;
  /** Desktop only: an 800px panel for side-by-side content instead of 480px. */
  wide?: boolean;
  children: ReactNode;
}) => {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
      cue("open");
    } else if (!open && dialog.open) {
      dialog.close();
      cue("close");
    }
  }, [open]);

  const onBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  return (
    <dialog
      aria-labelledby={titleId}
      className={cx(
        "border-dark bg-pit text-enamel pb-sheet backdrop:bg-black/70 animate-sheet-up fixed inset-x-0 top-auto bottom-0 m-0 max-h-[92dvh] w-full max-w-none overflow-y-auto border-t px-4 pt-2.5",
        "md:animate-fade-in md:inset-0 md:m-auto md:h-fit md:border md:px-6 md:pt-6 md:pb-6",
        wide ? "md:max-w-200" : "md:max-w-120"
      )}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={onBackdrop}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onClose();
        }
      }}
      ref={ref}
    >
      {open && (
        <div className="flex flex-col gap-4.5">
          <div aria-hidden="true" className="flex justify-center md:hidden">
            <span className="bg-dark h-1 w-10" />
          </div>
          <header className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-2">
              {kicker && (
                <p
                  className={cx(
                    "text-label tracking-label",
                    kickerTone === "mud" && "text-mud",
                    kickerTone === "pumpkin" && "text-pumpkin",
                    kickerTone === "amber" && "text-amber"
                  )}
                >
                  {kicker}
                </p>
              )}
              <h2 className="text-title text-enamel leading-6.5" id={titleId}>
                {title}
              </h2>
            </div>
            {trailing ?? (
              <button
                aria-label="Close"
                className="text-cement hover:text-enamel text-title -mt-1 -mr-2 flex size-11 shrink-0 items-center justify-center"
                onClick={onClose}
                type="button"
              >
                ×
              </button>
            )}
          </header>
          {children}
        </div>
      )}
    </dialog>
  );
};
