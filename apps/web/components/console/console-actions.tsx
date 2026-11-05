"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { pauseListing, updateListing } from "@/lib/api/actions";
import type { ApiResult } from "@/lib/api/errors";
import type { Listing } from "@/lib/api/types";
import { cx } from "@/lib/cx";

import { BottomSheet } from "../app-shell/bottom-sheet";
import { HoldButton } from "../app-shell/hold-button";
import { useToast } from "../app-shell/toast";

type ListingRef = Pick<Listing, "id" | "status">;

const failures = <A,>(results: readonly ApiResult<A>[]): number =>
  results.filter((result) => !result.ok).length;

/**
 * "Selling is on" switch and the kill switch. Pause takes every live listing
 * off the market; resume puts paused listings back live. The kill switch (hold
 * 2s in a sheet) does the same pause behind a confirmation, for emergencies.
 * Requests already paid and running finish either way.
 */
export const ConsoleActions = ({
  listings,
}: {
  listings: readonly ListingRef[];
}) => {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const live = listings.filter((listing) => listing.status === "live");
  const paused = listings.filter((listing) => listing.status === "paused");
  const selling = live.length > 0;
  const canResume = paused.length > 0;

  const pauseAll = async (title: string) => {
    setBusy(true);
    const results = await Promise.all(live.map((l) => pauseListing(l.id)));
    setBusy(false);
    const failed = failures(results);
    toast(
      failed > 0
        ? {
            detail: `${failed} listing(s) did not pause`,
            title: "Partly paused",
            tone: "error",
          }
        : { detail: `${live.length} listing(s)`, title }
    );
    router.refresh();
  };

  const killAll = async () => {
    setBusy(true);
    const results = await Promise.all(live.map((l) => pauseListing(l.id)));
    setBusy(false);
    const failed = failures(results);
    toast(
      failed > 0
        ? {
            detail: `${failed} listing(s) did not stop`,
            title: "Kill switch partly failed",
            tone: "error",
          }
        : {
            detail: `${live.length} listing(s) off the market`,
            title: "Kill switch: everything stopped",
          }
    );
    router.refresh();
  };

  const resumeAll = async () => {
    setBusy(true);
    const results = await Promise.all(
      paused.map((l) => updateListing(l.id, { status: "live" }))
    );
    setBusy(false);
    const failed = failures(results);
    toast(
      failed > 0
        ? {
            detail: `${failed} listing(s) stayed paused`,
            title: "Partly resumed",
            tone: "error",
          }
        : {
            detail: `${paused.length} listing(s) live`,
            title: "Selling resumed",
          }
    );
    router.refresh();
  };

  const onToggle = () => {
    const run = selling ? pauseAll("Selling paused") : resumeAll();
    run.catch(() => setBusy(false));
  };

  const toggleDisabled = busy || (!selling && !canResume);
  let caption = "no listings yet · open a node to list a model";
  if (selling) {
    caption = "tap to take every listing off the market";
  } else if (canResume) {
    caption = "paused · tap to put listings back live";
  }

  return (
    <section
      aria-label="Selling control"
      className="border-soot flex flex-col gap-3 border bg-black p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-title text-enamel leading-6.5">
            {selling ? "Selling is on" : "Selling is paused"}
          </p>
          <p className="text-mud text-sm leading-5">{caption}</p>
        </div>
        <button
          data-cuelume-toggle=""
          aria-checked={selling}
          aria-label="Selling"
          className={cx(
            "flex h-11 w-16 shrink-0 items-center p-1 transition-colors disabled:opacity-50",
            selling ? "bg-amber justify-end" : "bg-dark justify-start"
          )}
          disabled={toggleDisabled}
          onClick={onToggle}
          role="switch"
          type="button"
        >
          <span aria-hidden="true" className="bg-carbon size-7" />
        </button>
      </div>
      <button
        data-cuelume-tap=""
        className="border-pumpkin bg-pit flex min-h-14 items-center justify-between border-2 px-4 text-left hover:bg-black disabled:opacity-50"
        disabled={live.length === 0}
        onClick={() => setSheetOpen(true)}
        type="button"
      >
        <span className="flex flex-col gap-0.5">
          <span className="text-body text-pumpkin leading-5.25">
            KILL SWITCH
          </span>
          <span className="text-label text-cement">
            stop every listing · no new quotes
          </span>
        </span>
        <span className="text-label text-pumpkin">STOP ALL ›</span>
      </button>

      <BottomSheet
        kicker="KILL SWITCH"
        kickerTone="pumpkin"
        onClose={() => setSheetOpen(false)}
        open={sheetOpen}
        title="Stop selling right now?"
      >
        <p className="text-cement text-sm leading-5">
          Every listing leaves the market at once. Agents already paid for a
          request in flight keep their payment, so stop only when you must.
        </p>
        <ul className="border-soot flex flex-col border bg-black">
          <li className="border-soot flex h-11 items-center justify-between border-b px-3.5 text-sm leading-5">
            <span className="text-cement">listings paused</span>
            <span className="text-enamel">{live.length}</span>
          </li>
          <li className="border-soot flex h-11 items-center justify-between border-b px-3.5 text-sm leading-5">
            <span className="text-cement">new quotes</span>
            <span className="text-enamel">stop now</span>
          </li>
          <li className="flex h-11 items-center justify-between px-3.5 text-sm leading-5">
            <span className="text-cement">resume</span>
            <span className="text-enamel">manually, any time</span>
          </li>
        </ul>
        <div className="flex flex-col gap-2">
          <HoldButton
            disabled={busy}
            label="Hold to kill"
            onConfirm={() => {
              setSheetOpen(false);
              killAll().catch(() => setBusy(false));
            }}
          />
          <button
            data-cuelume-tap=""
            className="border-dark text-enamel text-body h-12 border leading-5.25 hover:bg-black"
            onClick={() => setSheetOpen(false)}
            type="button"
          >
            Never mind
          </button>
        </div>
      </BottomSheet>
    </section>
  );
};
