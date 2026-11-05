import Link from "next/link";
import type { ReactNode } from "react";

import { cx } from "@/lib/cx";

/** Section label + inset grouped list, iOS-settings style, in the board palette. */
export const GroupedList = ({
  title,
  children,
  className,
  footer,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
}) => (
  <section className={cx("flex flex-col gap-2", className)}>
    {title && (
      <h2 className="text-label tracking-label text-mud pl-1">{title}</h2>
    )}
    <ul className="border-soot flex flex-col border bg-black">{children}</ul>
    {footer && <div className="text-label text-clay pl-1">{footer}</div>}
  </section>
);

const rowClass =
  "flex min-h-13 items-center justify-between gap-3 px-4 py-2 border-b border-soot last:border-b-0";

const Chevron = () => (
  <span aria-hidden="true" className="text-body text-clay">
    ›
  </span>
);

/**
 * One row. With `href` it is a link with a chevron; with `onSelect` a button.
 * Plain rows show a label and value.
 */
export const GroupedRow = ({
  label,
  value,
  href,
  onSelect,
  tone = "plain",
  detail,
}: {
  label: ReactNode;
  value?: ReactNode;
  href?: string;
  onSelect?: () => void;
  tone?: "plain" | "amber" | "foam" | "muted";
  detail?: ReactNode;
}) => {
  const valueClass = cx(
    "text-sm leading-5 text-right",
    tone === "plain" && "text-cement",
    tone === "amber" && "text-amber",
    tone === "foam" && "text-foam",
    tone === "muted" && "text-clay"
  );
  const body = (
    <>
      <span className="flex min-w-0 flex-col gap-0.5 text-left">
        <span className="text-body text-enamel leading-5.25">{label}</span>
        {detail && <span className="text-label text-clay">{detail}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-2.5">
        {value !== undefined && <span className={valueClass}>{value}</span>}
        {(href || onSelect) && <Chevron />}
      </span>
    </>
  );
  if (href) {
    return (
      <li className="border-soot border-b last:border-b-0">
        <Link className={cx(rowClass, "hover:bg-pit border-b-0")} href={href}>
          {body}
        </Link>
      </li>
    );
  }
  if (onSelect) {
    return (
      <li className="border-soot border-b last:border-b-0">
        <button
          data-cuelume-tap=""
          className={cx(rowClass, "hover:bg-pit w-full border-b-0")}
          onClick={onSelect}
          type="button"
        >
          {body}
        </button>
      </li>
    );
  }
  return <li className={rowClass}>{body}</li>;
};
