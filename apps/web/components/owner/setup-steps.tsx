import Link from "next/link";
import type { ReactNode } from "react";

import { cx } from "@/lib/cx";
import { nextStep } from "@/lib/setup-steps";
import type { NodeStep, SetupStep } from "@/lib/setup-steps";

const StartLink = ({ href }: { href: string }) => (
  <Link
    className="spring bg-amber text-carbon text-label flex min-h-9 shrink-0 items-center px-3"
    data-cuelume-navigate=""
    href={href}
  >
    START →
  </Link>
);

type StepLike = Pick<SetupStep, "id" | "label" | "detail" | "done">;

/**
 * Steps with a clear state each: done (✓), next (amber, with its action) or
 * later. `action` renders inside the next step's row.
 */
const StepList = ({
  title,
  titleId,
  steps,
  action,
}: {
  title: string;
  titleId: string;
  steps: readonly StepLike[];
  action: ReactNode;
}) => {
  const next = steps.find((step) => !step.done);
  const doneCount = steps.filter((step) => step.done).length;
  return (
    <section
      aria-labelledby={titleId}
      className="border-soot flex flex-col gap-4 border bg-black p-4 md:p-5.5"
    >
      <h2 className="text-label tracking-label text-amber" id={titleId}>
        {title} · {doneCount} OF {steps.length} DONE
      </h2>
      <ol className="flex flex-col gap-2">
        {steps.map((step, index) => {
          const current = step.id === next?.id;
          return (
            <li
              aria-current={current ? "step" : undefined}
              className={cx(
                "flex flex-wrap items-center gap-3 border px-3 py-2.5",
                current ? "border-amber" : "border-soot"
              )}
              key={step.id}
            >
              <span
                aria-hidden="true"
                className={cx(
                  "text-body flex size-8 shrink-0 items-center justify-center",
                  step.done && "bg-foam text-carbon",
                  current && "bg-amber text-carbon",
                  !(step.done || current) && "border-dark text-clay border"
                )}
              >
                {step.done ? "✓" : index + 1}
              </span>
              <span className="flex min-w-0 grow flex-col gap-0.5">
                <span
                  className={cx(
                    "text-body leading-5.25",
                    step.done ? "text-cement line-through" : "text-enamel"
                  )}
                >
                  {step.label}
                </span>
                <span className="text-label text-clay">
                  {step.done ? "done · " : ""}
                  {step.detail}
                </span>
              </span>
              {current && action}
            </li>
          );
        })}
      </ol>
    </section>
  );
};

/** The owner's four setup steps across all nodes. Hidden once everything is done. */
export const SetupSteps = ({ steps }: { steps: readonly SetupStep[] }) => {
  const next = nextStep(steps);
  if (next === null) {
    return null;
  }
  return (
    <StepList
      action={<StartLink href={next.href} />}
      steps={steps}
      title="GET LISTED"
      titleId="setup-title"
    />
  );
};

/**
 * One node's setup steps, on its card. Steps done in place (connect, add plan)
 * take their button from `inPlaceAction`; the rest link to Settings.
 */
export const NodeSteps = ({
  nodeId,
  steps,
  inPlaceAction,
}: {
  nodeId: string;
  steps: readonly NodeStep[];
  inPlaceAction: ReactNode;
}) => {
  const next = steps.find((step) => !step.done);
  if (next === undefined) {
    return null;
  }
  return (
    <StepList
      action={
        next.href === null ? inPlaceAction : <StartLink href={next.href} />
      }
      steps={steps}
      title="SET UP THIS NODE"
      titleId={`node-steps-${nodeId}`}
    />
  );
};
