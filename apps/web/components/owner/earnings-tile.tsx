import type { ReactNode } from "react";

import { formatUsdExact } from "@/lib/money";

import { EarningsGrain } from "../shaders/shader-slots";

/** The amber grain tile with one big number: tonight so far, or settled earnings. */
export const EarningsTile = ({
  amountUsdc,
  caption,
  kicker,
}: {
  amountUsdc: bigint;
  caption: ReactNode;
  kicker: string;
}) => (
  <section
    aria-label="Earnings"
    className="bg-earnings relative isolate flex min-h-55 w-full shrink-0 flex-col justify-between overflow-hidden p-5.5 lg:w-130"
  >
    <div className="absolute inset-0 -z-10">
      <EarningsGrain />
    </div>
    <p className="text-label text-enamel">{kicker}</p>
    <div className="flex flex-col gap-1.5">
      <p className="text-earnings tracking-display text-enamel">
        {formatUsdExact(amountUsdc)}
      </p>
      <p className="text-body text-enamel leading-5.25">{caption}</p>
    </div>
  </section>
);
