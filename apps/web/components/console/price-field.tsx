"use client";

import { useId } from "react";

import { cx } from "@/lib/cx";
import { parseUsdInput, sanitizePriceInput } from "@/lib/money";

/** A dollars-per-million-tokens input. Empty is allowed when `optional`. */
export const PriceField = ({
  label,
  value,
  onChange,
  optional = false,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  optional?: boolean;
  hint?: string;
}) => {
  const id = useId();
  const empty = value.trim() === "";
  const invalid = empty ? !optional : parseUsdInput(value) === null;
  return (
    <div className="flex min-w-36 grow basis-0 flex-col gap-1.5">
      <label className="text-label text-clay leading-2.75" htmlFor={id}>
        {label}
      </label>
      <div
        className={cx(
          "bg-soot focus-within:border-amber flex min-h-12 items-center justify-between border px-2.5",
          invalid ? "border-pumpkin" : "border-dark"
        )}
      >
        <span aria-hidden="true" className="text-title text-enamel leading-6.5">
          $
        </span>
        <input
          aria-describedby={`${id}-hint`}
          aria-invalid={invalid}
          autoComplete="off"
          className="text-title text-enamel placeholder:text-clay w-full min-w-0 bg-transparent leading-6.5 outline-none"
          id={id}
          inputMode="decimal"
          onChange={(event) =>
            onChange(sanitizePriceInput(event.currentTarget.value))
          }
          placeholder={optional ? "auto" : "0.00"}
          spellCheck={false}
          type="text"
          value={value}
        />
        <span className="text-label text-clay shrink-0 leading-2.75">/ M</span>
      </div>
      <p
        className={cx(
          "text-label leading-3.75",
          invalid ? "text-pumpkin" : "text-clay"
        )}
        id={`${id}-hint`}
      >
        {invalid ? "enter a price like 1.60" : (hint ?? " ")}
      </p>
    </div>
  );
};
