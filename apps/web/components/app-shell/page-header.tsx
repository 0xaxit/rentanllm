import Link from "next/link";
import type { ReactNode } from "react";

import { cx } from "@/lib/cx";

/**
 * Phone-style page header: an optional back link, a small kicker, a large
 * title on the 44px step (33px for detail screens) and a trailing chip. On
 * desktop the title stays in the accessibility tree but the visual heading is
 * left to the page's own desktop layout.
 */
export const PageHeader = ({
  kicker,
  title,
  trailing,
  note,
  back,
  size = "large",
  subtitle,
  desktop = "hidden",
}: {
  kicker?: string;
  title: string;
  trailing?: ReactNode;
  /** Small centred line under the status bar ("meters read 4s ago"). */
  note?: ReactNode;
  back?: { readonly href: string; readonly label: string };
  size?: "large" | "detail";
  subtitle?: ReactNode;
  /** "visible" keeps this header on desktop too. */
  desktop?: "hidden" | "visible";
}) => {
  const hideOnDesktop = desktop === "hidden";
  return (
    <header
      className={cx(
        "flex flex-col",
        hideOnDesktop && "md:sr-only",
        !hideOnDesktop && "md:pt-11"
      )}
    >
      {note && (
        <p className="text-label text-clay flex justify-center pt-1 md:hidden">
          {note}
        </p>
      )}
      {back && (
        <div className="-ml-2 flex h-11 items-center justify-between">
          <Link
            className="text-amber flex h-11 items-center gap-1 px-2"
            href={back.href}
          >
            <span aria-hidden="true" className="text-title leading-5.5">
              ‹
            </span>
            <span className="text-body leading-5.25">{back.label}</span>
          </Link>
          {size === "detail" && trailing}
        </div>
      )}
      <div
        className={cx(
          "flex flex-wrap items-end justify-between gap-x-3 gap-y-2",
          size === "large" ? "pt-4 pb-3" : "pt-2 pb-4"
        )}
      >
        <div className="flex min-w-0 flex-col gap-1.5">
          {kicker && (
            <p className="text-label tracking-label text-mud">{kicker}</p>
          )}
          <h1
            className={cx(
              "tracking-display text-enamel",
              size === "large" ? "text-h2" : "text-h3 leading-9"
            )}
          >
            {title}
          </h1>
          {subtitle && <p className="text-mud text-sm leading-5">{subtitle}</p>}
        </div>
        {(size === "large" || !back) && trailing}
      </div>
    </header>
  );
};

/** The pill chip at the right of a large title: `■ bom-01 LIVE`. */
export const StatusChip = ({
  label,
  value,
  tone = "foam",
}: {
  label: string;
  value?: ReactNode;
  /** "live" (green) and "down" (red) are node online / offline. */
  tone?: "foam" | "amber" | "pumpkin" | "clay" | "live" | "down";
}) => (
  <p className="border-dark flex h-8 shrink-0 items-center gap-2 rounded-2xl border bg-black px-3">
    <span
      aria-hidden="true"
      className={cx(
        "size-2 shrink-0",
        tone === "foam" && "bg-foam",
        tone === "amber" && "bg-amber",
        tone === "pumpkin" && "bg-pumpkin",
        tone === "clay" && "bg-clay",
        tone === "live" && "bg-live",
        tone === "down" && "bg-down"
      )}
    />
    <span className="text-enamel text-sm leading-4">{label}</span>
    {value && (
      <span
        className={cx(
          "text-sm leading-4",
          tone === "pumpkin" && "text-pumpkin",
          tone === "live" && "text-live",
          tone === "down" && "text-down",
          !(tone === "pumpkin" || tone === "live" || tone === "down") &&
            "text-amber"
        )}
      >
        {value}
      </span>
    )}
  </p>
);

/** Main scroll area: safe-area aware on phones, room for the tab bar. */
export const AppMain = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <main
    className={cx(
      "pt-safe pb-app px-safe flex flex-col gap-5.5 sm:px-11 md:pt-0 md:pb-22",
      className
    )}
  >
    {children}
  </main>
);
