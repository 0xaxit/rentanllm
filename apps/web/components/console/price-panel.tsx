"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CSSProperties } from "react";

import { updateListing } from "@/lib/api/actions";
import type { PriceSuggestion, PriceVerdict, Provider } from "@/lib/api/types";
import { cx } from "@/lib/cx";
import {
  formatPrice,
  microsToInput,
  parseOptionalUsdInput,
  parseUsdInput,
} from "@/lib/money";
import {
  API_PERCENT,
  BAND_MAX_PERCENT,
  FAIR_MAX_PERCENT,
  FAIR_MIN_PERCENT,
  bandPosition,
  percentOfApi,
  priceSanity,
  verdictCopy,
  verdictFor,
  verdictLabel,
} from "@/lib/pricing";

import { useToast } from "../app-shell/toast";
import { BlockHeading, Note } from "../primitives";
import { PriceField } from "./price-field";
import { PriceSanityWarning } from "./price-sanity";

const verdictStyle = {
  above_api: "bg-pumpkin text-carbon",
  fair: "bg-flux text-carbon",
  pricey: "bg-amber text-carbon",
  underpriced: "bg-foam text-carbon",
} as const;

const saveLabel = (saving: boolean, absurd: boolean) => {
  if (saving) {
    return "SAVING…";
  }
  return absurd ? "SAVE ANYWAY" : "SAVE PRICE";
};

const bandX = (percent: number) => `${bandPosition(percent)}%`;

/** An optional price as the field shows it: empty for "use the default". */
const optionalInput = (micros: bigint | null): string =>
  micros === null ? "" : microsToInput(micros);

export interface PricedListing {
  readonly id: string;
  readonly provider: Provider;
  readonly models: readonly string[];
  readonly priceInPerMtokUsdc: bigint;
  readonly priceOutPerMtokUsdc: bigint;
  readonly priceCacheReadPerMtokUsdc: bigint | null;
  readonly priceCacheWritePerMtokUsdc: bigint | null;
}

const PriceBand = ({ percent }: { percent: number }) => (
  <div
    aria-hidden="true"
    className="flex flex-col gap-2"
    style={
      {
        "--band-api": bandX(API_PERCENT),
        "--band-fair-max": bandX(FAIR_MAX_PERCENT),
        "--band-fair-min": bandX(FAIR_MIN_PERCENT),
        "--band-marker": bandX(percent),
      } as CSSProperties
    }
  >
    <div className="relative h-7.5 w-full overflow-x-clip">
      <div className="bg-band-under absolute inset-x-0 top-1 h-5.5" />
      <div className="bg-flux absolute top-1 right-[calc(100%-var(--band-fair-max))] left-(--band-fair-min) h-5.5" />
      <div className="bg-band-pricey absolute top-1 right-[calc(100%-var(--band-api))] left-(--band-fair-max) h-5.5" />
      <div className="bg-band-above absolute top-1 right-0 left-(--band-api) h-5.5" />
      <div className="bg-enamel absolute top-0 left-(--band-api) h-7.5 w-px" />
      <div className="ease-spring absolute inset-0 translate-x-(--band-marker) transition-transform duration-500 motion-reduce:transition-none">
        <div className="bg-amber absolute top-0 left-0 h-7.5 w-0.75 -translate-x-1/2" />
      </div>
    </div>
    <div className="text-label relative h-2.75 leading-2.75">
      <span className="text-clay absolute left-0">$0</span>
      <span className="text-flux absolute left-(--band-fair-min)">
        fair {FAIR_MIN_PERCENT}–{FAIR_MAX_PERCENT}%
      </span>
      <span className="text-cement absolute left-(--band-api) pl-1 max-sm:hidden">
        API price
      </span>
      <span className="text-clay absolute right-0">{BAND_MAX_PERCENT}%</span>
    </div>
  </div>
);

type SuggestedPrices = PriceSuggestion["suggested"];

const SuggestionRows = ({
  suggestion,
  isSuggested,
  model,
  onUse,
}: {
  suggestion: PriceSuggestion | null;
  isSuggested: boolean;
  model: string;
  onUse: (prices: SuggestedPrices) => void;
}) => {
  if (!suggestion) {
    return (
      <Note>no API reference price for {model} yet. any price is allowed.</Note>
    );
  }
  return (
    <dl className="text-body flex flex-col gap-2 leading-5.25">
      <div className="text-cement flex flex-wrap justify-between gap-x-4">
        <dt>Direct API list price</dt>
        <dd>
          {formatPrice(suggestion.api.inputPerMtokUsdc)} in ·{" "}
          {formatPrice(suggestion.api.outputPerMtokUsdc)} out
        </dd>
      </div>
      <div className="text-amber flex flex-wrap items-center justify-between gap-x-4">
        <dt className="flex items-center gap-3">
          Suggested · 40%
          {/* Always laid out, only hidden, so showing it never shifts the panel. */}
          <button
            aria-hidden={isSuggested}
            data-cuelume-tap=""
            className={cx(
              "spring border-amber text-label hover:bg-amber hover:text-carbon min-h-8 border px-2 leading-3.75",
              isSuggested && "invisible"
            )}
            disabled={isSuggested}
            onClick={() => onUse(suggestion.suggested)}
            tabIndex={isSuggested ? -1 : undefined}
            type="button"
          >
            USE
          </button>
        </dt>
        <dd>
          {formatPrice(suggestion.suggested.inputPerMtokUsdc)} in ·{" "}
          {formatPrice(suggestion.suggested.outputPerMtokUsdc)} out
        </dd>
      </div>
    </dl>
  );
};

const VerdictLine = ({
  verdict,
  percent,
}: {
  verdict: PriceVerdict;
  percent: number;
}) => (
  <p
    aria-live="polite"
    className="text-body flex flex-wrap items-center gap-2.75 leading-5.25"
  >
    <span className={cx("inline-block px-1.5", verdictStyle[verdict])}>
      {verdictLabel[verdict]}
    </span>
    <span className="text-enamel">
      {Math.round(percent)}% of API price · {verdictCopy[verdict]}
    </span>
  </p>
);

/** Verdict, band position and sanity of `current` against the API price. */
const judge = (
  current: { inputPerMtok: bigint; outputPerMtok: bigint },
  suggestion: PriceSuggestion | null,
  valid: boolean
) => {
  if (!suggestion) {
    return { percent: 0, sanity: null, verdict: null };
  }
  const api = {
    inputPerMtok: suggestion.api.inputPerMtokUsdc,
    outputPerMtok: suggestion.api.outputPerMtokUsdc,
  };
  return {
    percent: percentOfApi(current, api),
    sanity: valid ? priceSanity(current, api) : null,
    verdict: verdictFor(current, api),
  };
};

/**
 * Price editor for one listing: the provider's API list price and the
 * suggested 40% from /pricing/suggestion, the owner's prices (no cap), a live
 * verdict, and Save (PATCH /owner/listings/:id).
 */
export const PricePanel = ({
  listing,
  suggestion,
}: {
  listing: PricedListing;
  suggestion: PriceSuggestion | null;
}) => {
  const router = useRouter();
  const toast = useToast();
  const [inputRaw, setInputRaw] = useState(() =>
    microsToInput(listing.priceInPerMtokUsdc)
  );
  const [outputRaw, setOutputRaw] = useState(() =>
    microsToInput(listing.priceOutPerMtokUsdc)
  );
  const [cacheRaw, setCacheRaw] = useState(() =>
    optionalInput(listing.priceCacheReadPerMtokUsdc)
  );
  const [cacheWriteRaw] = useState(() =>
    optionalInput(listing.priceCacheWritePerMtokUsdc)
  );
  const [saving, setSaving] = useState(false);

  const input = parseUsdInput(inputRaw);
  const output = parseUsdInput(outputRaw);
  const cacheRead = parseOptionalUsdInput(cacheRaw);
  const cache = cacheRead.value;
  const cacheWrite = parseOptionalUsdInput(cacheWriteRaw);
  const valid =
    input !== null && output !== null && cacheRead.ok && cacheWrite.ok;

  const current = {
    inputPerMtok: input ?? listing.priceInPerMtokUsdc,
    outputPerMtok: output ?? listing.priceOutPerMtokUsdc,
  };
  const { percent, sanity, verdict } = judge(current, suggestion, valid);
  const changed =
    input !== listing.priceInPerMtokUsdc ||
    output !== listing.priceOutPerMtokUsdc ||
    cache !== listing.priceCacheReadPerMtokUsdc ||
    cacheWrite.value !== listing.priceCacheWritePerMtokUsdc;
  const isSuggested =
    suggestion !== null &&
    input === suggestion.suggested.inputPerMtokUsdc &&
    output === suggestion.suggested.outputPerMtokUsdc;

  const save = async () => {
    if (!valid) {
      return;
    }
    setSaving(true);
    const result = await updateListing(listing.id, {
      priceCacheReadPerMtokUsdc: cache,
      priceCacheWritePerMtokUsdc: cacheWrite.value,
      priceInPerMtokUsdc: input,
      priceOutPerMtokUsdc: output,
    });
    setSaving(false);
    if (!result.ok) {
      toast({
        detail: result.error.message,
        title: "Price not saved",
        tone: "error",
      });
      return;
    }
    toast({
      detail: `${formatPrice(input)} in · ${formatPrice(output)} out`,
      title: "Price saved",
    });
    router.refresh();
  };

  const model = listing.models[0] ?? listing.provider;

  return (
    <section
      aria-labelledby="price-title"
      className="border-soot flex scroll-mt-6 flex-col gap-5.5 border bg-black p-4 md:border-0 md:p-5.5"
      id="price"
    >
      <div className="flex flex-col items-start gap-2">
        <BlockHeading
          as="h2"
          id="price-title"
          lines={["PRICE"]}
          size="h3"
          tone="ash"
        />
        <Note>{model} · usdc per million tokens · no cap</Note>
      </div>

      <SuggestionRows
        isSuggested={isSuggested}
        model={model}
        onUse={(prices) => {
          setInputRaw(microsToInput(prices.inputPerMtokUsdc));
          setOutputRaw(microsToInput(prices.outputPerMtokUsdc));
          setCacheRaw(microsToInput(prices.cacheReadPerMtokUsdc));
        }}
        suggestion={suggestion}
      />

      <div className="flex flex-wrap gap-2.75">
        <PriceField
          label="YOUR INPUT PRICE"
          onChange={setInputRaw}
          value={inputRaw}
        />
        <PriceField
          label="YOUR OUTPUT PRICE"
          onChange={setOutputRaw}
          value={outputRaw}
        />
      </div>

      {suggestion && <PriceBand percent={percent} />}

      <div className="flex flex-col gap-3">
        {verdict && <VerdictLine percent={percent} verdict={verdict} />}
        {sanity && <PriceSanityWarning sanity={sanity} />}
        <Note>
          any price is allowed · each 402 quotes the cheapest online sellers
          first.
        </Note>
        <button
          data-cuelume-tap=""
          className="spring bg-amber text-carbon text-body h-12 w-full leading-5.25 disabled:opacity-50 md:w-fit md:px-6"
          disabled={!(valid && changed) || saving}
          onClick={() => {
            save().catch(() => setSaving(false));
          }}
          type="button"
        >
          {saveLabel(saving, sanity !== null)}
        </button>
      </div>
    </section>
  );
};
