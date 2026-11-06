"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { SegmentedControl } from "@/components/app-shell/segmented-control";
import { useToast } from "@/components/app-shell/toast";
import { BlockHeading, Note } from "@/components/primitives";
import { updateBuyerPolicy } from "@/lib/api/actions";
import type { BuyerPolicy } from "@/lib/api/types";
import { cx } from "@/lib/cx";
import {
  microsToInput,
  parseOptionalUsdInput,
  sanitizePriceInput,
} from "@/lib/money";

const HEDERA_ACCOUNT = /^\d+\.\d+\.\d+$/u;
const LIST_SEPARATORS = /[\s,]+/u;

type Mode = "active" | "paused";

const MODES = [
  { label: "PAYING", value: "active" },
  { label: "PAUSED", value: "paused" },
] as const;

/** An optional USDC amount: empty means "no limit", anything else must be above 0. */
const parseLimit = (raw: string) => {
  const parsed = parseOptionalUsdInput(raw);
  return {
    ok: parsed.ok && (parsed.value === null || parsed.value > 0n),
    value: parsed.value,
  };
};

const parseSellers = (raw: string) => {
  const sellers = raw.split(LIST_SEPARATORS).filter((s) => s.length > 0);
  return {
    ok: sellers.every((s) => HEDERA_ACCOUNT.test(s)),
    value: sellers.length === 0 ? null : sellers,
  };
};

const limitInput = (micros: bigint | null): string =>
  micros === null ? "" : microsToInput(micros);

const LimitField = ({
  hint,
  label,
  onChange,
  placeholder = "no limit",
  value,
}: {
  hint: string;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) => {
  const id = useId();
  const invalid = !parseLimit(value).ok;
  return (
    <div className="flex min-w-44 grow basis-0 flex-col gap-1.5">
      <label className="text-label text-clay leading-2.75" htmlFor={id}>
        {label}
      </label>
      <div
        className={cx(
          "bg-soot focus-within:border-amber flex min-h-12 items-center gap-2 border px-2.5",
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
          placeholder={placeholder}
          spellCheck={false}
          type="text"
          value={value}
        />
        <span className="text-label text-clay shrink-0 leading-2.75">USDC</span>
      </div>
      <p
        className={cx(
          "text-label leading-3.75",
          invalid ? "text-pumpkin" : "text-clay"
        )}
        id={`${id}-hint`}
      >
        {invalid
          ? "enter an amount above 0, like 0.50, or leave it empty"
          : hint}
      </p>
    </div>
  );
};

/**
 * The buyer's spending limits. Saved limits apply to the next payment from the account:
 * the gateway checks them after the payment is verified and before it settles.
 */
export const LimitsForm = ({ policy }: { policy: BuyerPolicy | null }) => {
  const router = useRouter();
  const toast = useToast();
  const sellersId = useId();
  const [daily, setDaily] = useState(() =>
    limitInput(policy?.dailyBudgetUsdc ?? null)
  );
  const [perRequest, setPerRequest] = useState(() =>
    limitInput(policy?.maxPerRequestUsdc ?? null)
  );
  const [perSeller, setPerSeller] = useState(() =>
    limitInput(policy?.perSellerDailyUsdc ?? null)
  );
  const [worldAbove, setWorldAbove] = useState(() =>
    limitInput(policy?.worldApprovalAboveUsdc ?? null)
  );
  const [sellers, setSellers] = useState(() =>
    (policy?.allowedSellers ?? []).join("\n")
  );
  const [mode, setMode] = useState<Mode>(policy?.paused ? "paused" : "active");
  const [saving, setSaving] = useState(false);

  const parsed = {
    daily: parseLimit(daily),
    perRequest: parseLimit(perRequest),
    perSeller: parseLimit(perSeller),
    sellers: parseSellers(sellers),
    worldAbove: parseLimit(worldAbove),
  };
  const valid = Object.values(parsed).every((field) => field.ok);

  const save = async () => {
    setSaving(true);
    const result = await updateBuyerPolicy({
      allowedSellers: parsed.sellers.value,
      dailyBudgetUsdc: parsed.daily.value,
      maxPerRequestUsdc: parsed.perRequest.value,
      paused: mode === "paused",
      perSellerDailyUsdc: parsed.perSeller.value,
      worldApprovalAboveUsdc: parsed.worldAbove.value,
    });
    setSaving(false);
    if (!result.ok) {
      toast({
        detail: result.error.message,
        title: "Limits not saved",
        tone: "error",
      });
      return;
    }
    toast({
      detail: result.data.paused
        ? "Every payment from this account is refused"
        : "The gateway applies them from the next payment",
      title: "Limits saved",
    });
    router.refresh();
  };

  return (
    <form
      className="bg-carbon flex flex-col gap-6 p-4 sm:p-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !saving) {
          void save();
        }
      }}
    >
      <div className="flex flex-col gap-2">
        <BlockHeading lines={["LIMITS"]} size="h3" tone="ash" />
        <Note tone="mud">
          checked before every payment settles · a refused payment costs nothing
        </Note>
      </div>
      <SegmentedControl
        className="max-w-80"
        label="Payments"
        onChange={setMode}
        segments={MODES}
        value={mode}
      />
      <div className="flex flex-wrap gap-4">
        <LimitField
          hint="most paid in any 24 hours, all sellers"
          label="24-HOUR BUDGET"
          onChange={setDaily}
          value={daily}
        />
        <LimitField
          hint="largest single payment"
          label="MAX PER REQUEST"
          onChange={setPerRequest}
          value={perRequest}
        />
        <LimitField
          hint="most paid to one seller in any 24 hours"
          label="PER SELLER, 24 HOURS"
          onChange={setPerSeller}
          value={perSeller}
        />
        <LimitField
          hint="above this, Claude shows a World ID link and pays only after you approve"
          label="WORLD ID ABOVE"
          onChange={setWorldAbove}
          placeholder="never ask"
          value={worldAbove}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label
          className="text-label text-clay leading-2.75"
          htmlFor={sellersId}
        >
          ONLY PAY THESE SELLERS
        </label>
        <textarea
          aria-describedby={`${sellersId}-hint`}
          aria-invalid={!parsed.sellers.ok}
          className={cx(
            "bg-soot text-body text-enamel placeholder:text-clay focus:border-amber min-h-24 border p-2.5 outline-none",
            parsed.sellers.ok ? "border-dark" : "border-pumpkin"
          )}
          id={sellersId}
          onChange={(event) => setSellers(event.currentTarget.value)}
          placeholder="any seller"
          spellCheck={false}
          value={sellers}
        />
        <p
          className={cx(
            "text-label leading-3.75",
            parsed.sellers.ok ? "text-clay" : "text-pumpkin"
          )}
          id={`${sellersId}-hint`}
        >
          {parsed.sellers.ok
            ? "Hedera accounts like 0.0.11331176, one per line · empty pays any seller"
            : "each seller must be a Hedera account like 0.0.11331176"}
        </p>
      </div>
      <button
        className="bg-amber text-carbon text-body disabled:bg-dark disabled:text-clay min-h-12 self-start px-6 tracking-wider"
        disabled={!valid || saving}
        type="submit"
      >
        {saving ? "SAVING…" : "SAVE LIMITS"}
      </button>
    </form>
  );
};
