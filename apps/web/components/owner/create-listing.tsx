"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { createListing } from "@/lib/api/actions";
import type { Listing, ProviderAccount } from "@/lib/api/types";
import { MAX_CUTOFF } from "@/lib/cutoffs";
import { shortId } from "@/lib/cx";
import { parseUsdInput } from "@/lib/money";

import { BottomSheet } from "../app-shell/bottom-sheet";
import { SegmentedControl } from "../app-shell/segmented-control";
import { useToast } from "../app-shell/toast";
import { PriceField } from "../console/price-field";
import { Note } from "../primitives";

const fieldClass =
  "bg-soot border-dark focus:border-amber text-enamel min-h-12 w-full border px-3 text-body outline-none placeholder:text-clay";

/** Open models sellers commonly pull into Ollama; suggestions only, any name works. */
const OPEN_MODEL_SUGGESTIONS = [
  "llama3.1:8b",
  "llama3.2:3b",
  "qwen2.5:7b",
  "qwen2.5-coder:7b",
  "mistral:7b",
  "gemma2:9b",
  "deepseek-r1:8b",
  "phi3:mini",
] as const;

/** Image models a node can serve through a local image server (e.g. sd-server). */
const IMAGE_MODEL_SUGGESTIONS = ["flux-2-klein-4b"] as const;
/** Starting price per image, well under hosted image APIs for a small model. */
const DEFAULT_PER_IMAGE = "0.002";

/** Starting prices per million tokens, well under hosted APIs for small open models. */
const DEFAULT_INPUT = "0.05";
const DEFAULT_OUTPUT = "0.20";

/** Models the node's listings already sell. */
const listedModels = (
  account: ProviderAccount | undefined,
  listings: readonly Listing[]
): ReadonlySet<string> =>
  new Set(
    listings.flatMap((l) =>
      l.providerAccountId === account?.id ? l.models : []
    )
  );

const submitLabel = (busy: boolean, duplicate: boolean) => {
  if (busy) {
    return "LISTING…";
  }
  return duplicate ? "LIST AGAIN" : "LIST MODEL";
};

/**
 * Lists one open model from the node's Ollama at a price per million tokens.
 * Agents are quoted the prompt plus the full max_tokens at these prices and
 * pay before the request runs.
 */
export const CreateListing = ({
  accounts,
  autoOpen = false,
  defaultAccountId,
  listings,
  nextHref,
}: {
  accounts: readonly ProviderAccount[];
  autoOpen?: boolean;
  /** Preselected account; otherwise the first with no listing yet. */
  defaultAccountId?: string | undefined;
  listings: readonly Listing[];
  nextHref?: string | undefined;
}) => {
  const router = useRouter();
  const toast = useToast();
  const accountId = useId();
  const modelId = useId();
  const [open, setOpen] = useState(autoOpen);
  const [selected, setSelected] = useState(
    () =>
      accounts.find((a) => a.id === defaultAccountId)?.id ??
      accounts.find((a) => !listings.some((l) => l.providerAccountId === a.id))
        ?.id ??
      accounts[0]?.id ??
      ""
  );
  const [kind, setKind] = useState<"chat" | "image">("chat");
  const [model, setModel] = useState("");
  const [perImageRaw, setPerImageRaw] = useState(DEFAULT_PER_IMAGE);
  const [inputRaw, setInputRaw] = useState(DEFAULT_INPUT);
  const [outputRaw, setOutputRaw] = useState(DEFAULT_OUTPUT);
  const [status, setStatus] = useState<"draft" | "live">("live");
  const [busy, setBusy] = useState(false);

  const account = accounts.find((a) => a.id === selected);
  const isImage = kind === "image";
  // An image is billed as one million output tokens, so its price per image is the
  // output price per million and the input price is zero.
  const input = isImage ? 0n : parseUsdInput(inputRaw);
  const output = parseUsdInput(isImage ? perImageRaw : outputRaw);
  const valid =
    account !== undefined && model !== "" && input !== null && output !== null;
  const duplicate = listedModels(account, listings).has(model);

  const submit = async () => {
    if (!(valid && account && input !== null && output !== null)) {
      return;
    }
    setBusy(true);
    const result = await createListing({
      kind,
      models: [model],
      priceCacheReadPerMtokUsdc: null,
      priceCacheWritePerMtokUsdc: null,
      priceInPerMtokUsdc: input,
      priceOutPerMtokUsdc: output,
      providerAccountId: account.id,
      // A self-hosted model has no plan quota to protect.
      sessionCutoffPct: MAX_CUTOFF,
      status,
      weeklyCutoffPct: MAX_CUTOFF,
    });
    setBusy(false);
    if (!result.ok) {
      toast({
        detail: result.error.message,
        title: "Not listed",
        tone: "error",
      });
      return;
    }
    toast({
      detail: status === "live" ? "agents can buy it now" : "saved as a draft",
      title: `${model} listed`,
    });
    setOpen(false);
    setModel("");
    if (nextHref) {
      router.push(nextHref);
    } else {
      router.refresh();
    }
  };

  if (accounts.length === 0) {
    return <Note>turn on open models before listing one</Note>;
  }

  return (
    <>
      <button
        data-cuelume-tap=""
        className="spring bg-amber text-carbon text-body h-12 w-full leading-5.25 md:w-fit md:px-6"
        onClick={() => setOpen(true)}
        type="button"
      >
        LIST A MODEL
      </button>
      <BottomSheet
        kicker={isImage ? "SELL AN IMAGE MODEL" : "SELL AN OPEN MODEL"}
        onClose={() => setOpen(false)}
        open={open}
        title="New listing"
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit().catch(() => setBusy(false));
          }}
        >
          {accounts.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-label text-clay" htmlFor={accountId}>
                NODE
              </label>
              <select
                className={fieldClass}
                id={accountId}
                onChange={(event) => setSelected(event.currentTarget.value)}
                value={selected}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    node {shortId(a.nodeId)} · {a.planTier}
                  </option>
                ))}
              </select>
            </div>
          )}
          <SegmentedControl<"chat" | "image">
            label="Kind"
            onChange={(next) => {
              setKind(next);
              setModel("");
            }}
            segments={[
              { label: "TEXT", value: "chat" },
              { label: "IMAGE", value: "image" },
            ]}
            value={kind}
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-label text-clay" htmlFor={modelId}>
              MODEL
            </label>
            <input
              autoCapitalize="off"
              autoComplete="off"
              className={fieldClass}
              id={modelId}
              list={`${modelId}-open`}
              onChange={(event) => setModel(event.currentTarget.value.trim())}
              placeholder={isImage ? "flux-2-klein-4b" : "llama3.1:8b"}
              spellCheck={false}
              value={model}
            />
            <datalist id={`${modelId}-open`}>
              {(isImage ? IMAGE_MODEL_SUGGESTIONS : OPEN_MODEL_SUGGESTIONS).map(
                (option) => (
                  <option key={option} value={option} />
                )
              )}
            </datalist>
            <Note>
              {isImage ? (
                <>
                  the model your node&apos;s image server runs (start{" "}
                  <code>ral</code> with <code>--image-url</code>)
                </>
              ) : (
                <>
                  the exact name from <code>ollama list</code> on your node
                </>
              )}
              {duplicate ? " · already listed on this node" : ""}
            </Note>
          </div>
          {isImage ? (
            <div className="flex flex-wrap gap-2.75">
              <PriceField
                label="PER IMAGE"
                onChange={setPerImageRaw}
                value={perImageRaw}
              />
            </div>
          ) : (
            <div className="flex flex-wrap gap-2.75">
              <PriceField
                label="INPUT / M"
                onChange={setInputRaw}
                value={inputRaw}
              />
              <PriceField
                label="OUTPUT / M"
                onChange={setOutputRaw}
                value={outputRaw}
              />
            </div>
          )}
          <Note>
            {isImage
              ? "USDC per image · agents pay before it is made, straight to your wallet"
              : "USDC per million tokens · agents pay for the prompt plus the full max_tokens, straight to your wallet"}
          </Note>
          <SegmentedControl<"draft" | "live">
            label="Status"
            onChange={setStatus}
            segments={[
              { label: "LIVE", value: "live" },
              { label: "DRAFT", value: "draft" },
            ]}
            value={status}
          />
          <button
            data-cuelume-tap=""
            className="bg-amber text-carbon text-body h-12 leading-5.25 disabled:opacity-60"
            disabled={busy || !valid}
            type="submit"
          >
            {submitLabel(busy, duplicate)}
          </button>
        </form>
      </BottomSheet>
    </>
  );
};
