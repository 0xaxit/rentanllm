import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { cx } from "@/lib/cx";

/** The RENTANLLM logotype: the word on an aluminum block. */
export const Logotype = ({
  className,
  tone = "aluminum",
}: {
  className?: string;
  tone?: "aluminum" | "light";
}) => (
  <span
    className={cx(
      "inline-block px-1 py-0.5 text-title leading-5.5",
      tone === "aluminum" ? "bg-aluminum text-soot" : "bg-aluminum text-carbon",
      className
    )}
  >
    RENTANLLM
  </span>
);

type HeadingLevel = "h1" | "h2" | "h3";

const blockSizes = {
  h1: "px-1.5 text-hero tracking-display",
  h2: "px-1.5 text-heading",
  h3: "px-1 py-0.5 text-title leading-5.5",
} as const;

/**
 * Headings sit on solid grey blocks, one block per line. On a phone a long
 * line wraps and every wrapped row keeps its own block (box-decoration clone).
 */
export const BlockHeading = ({
  as: Tag = "h2",
  lines,
  size = "h2",
  tone = "aluminum",
  id,
}: {
  as?: HeadingLevel;
  lines: readonly string[];
  size?: keyof typeof blockSizes;
  tone?: "aluminum" | "ash";
  id?: string;
}) => (
  <Tag className="flex flex-col items-start gap-1.5" id={id}>
    {lines.map((line) => (
      <span className="max-w-full" key={line}>
        <span
          className={cx(
            "block-line inline text-soot",
            tone === "aluminum" ? "bg-aluminum" : "bg-ash",
            blockSizes[size]
          )}
        >
          {line}
        </span>
      </span>
    ))}
  </Tag>
);

/** `// comment` notes, in clay (or mud on dark grounds). */
export const Note = ({
  children,
  className,
  tone = "clay",
}: {
  children: ReactNode;
  className?: string;
  tone?: "clay" | "mud";
}) => (
  <p
    className={cx(
      "text-label leading-3.75",
      tone === "clay" ? "text-clay" : "text-mud",
      className
    )}
  >
    {"// "}
    {children}
  </p>
);

/** Callout with the 7px mud rule on the left. */
export const Callout = ({
  children,
  className,
  rule = "mud",
}: {
  children: ReactNode;
  className?: string;
  rule?: "mud" | "amber" | "foam";
}) => {
  const ruleColor = {
    amber: "border-l-amber",
    foam: "border-l-foam",
    mud: "border-l-mud",
  }[rule];
  return (
    <div className={cx("border-l-7 border-solid pl-4", ruleColor, className)}>
      {children}
    </div>
  );
};

/** Blinking block cursor that marks something as live. */
export const LiveCursor = ({
  className,
  tone = "foam",
}: {
  className?: string;
  tone?: "foam" | "amber";
}) => (
  <span
    aria-hidden="true"
    className={cx(
      "inline-block h-4.5 w-2.5 shrink-0 animate-blink",
      tone === "foam" ? "bg-foam" : "bg-amber",
      className
    )}
  />
);

/** Small uppercase field label used above stat values. */
export const Label = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <span className={cx("block text-label text-mud", className)}>{children}</span>
);

type NavLinkProps = ComponentProps<typeof Link> & { current?: boolean };

/** Header nav link; the current page is highlighted on a foam block. */
export const NavLink = ({
  current = false,
  className,
  ...props
}: NavLinkProps) => (
  <Link
    data-cuelume-navigate=""
    aria-current={current ? "page" : undefined}
    className={cx(
      "spring inline-block px-1 text-body leading-5.25 text-dark hover:bg-aluminum",
      current && "bg-foam",
      className
    )}
    {...props}
  />
);
