import Link from "next/link";

import type { ApiNode, Listing, ProviderAccount } from "@/lib/api/types";
import { cx, shortId } from "@/lib/cx";
import { modelsLabel, providerLabel } from "@/lib/market";
import { formatPrice } from "@/lib/money";
import { nodeStatusTone } from "@/lib/node-status";
import { nodeHref, nodeSetupSteps } from "@/lib/setup-steps";

import { StatusChip } from "../app-shell/page-header";
import { LocalTime } from "../local-time";

const ListingLine = ({ listing }: { listing: Listing }) => (
  <li className="flex items-baseline justify-between gap-3">
    <span className="text-enamel min-w-0 truncate text-sm leading-5">
      {modelsLabel(listing.models)}
      <span className="text-clay"> · {listing.status}</span>
    </span>
    <span className="text-cement shrink-0 text-sm leading-5">
      {formatPrice(listing.priceInPerMtokUsdc)} ·{" "}
      {formatPrice(listing.priceOutPerMtokUsdc)}
    </span>
  </li>
);

/**
 * One node on the dashboard: status, what it serves, each listing's models and
 * price, and what setup step is next. The whole card opens the node's page,
 * where models and prices are edited.
 */
export const NodeCard = ({
  node,
  accounts,
  listings,
  newest,
}: {
  node: ApiNode;
  /** What the node serves (its Ollama). */
  accounts: readonly ProviderAccount[];
  listings: readonly Listing[];
  /** The most recently added of several nodes. */
  newest: boolean;
}) => {
  const nodeListings = listings.filter((l) =>
    accounts.some((a) => a.id === l.providerAccountId)
  );
  const next = nodeSetupSteps({ accounts, listings, node }).find(
    (step) => !step.done
  );
  return (
    <Link
      className={cx(
        "spring flex flex-col gap-4 border bg-black p-4 md:p-5",
        next ? "border-amber" : "border-soot hover:border-dark"
      )}
      data-cuelume-navigate=""
      href={nodeHref(node.id)}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-body tracking-label text-enamel flex flex-wrap items-center gap-2 leading-5.25">
            NODE {shortId(node.id).toUpperCase()}
            {newest && (
              <span className="bg-amber text-carbon text-label px-1.5 py-0.5">
                NEWEST
              </span>
            )}
          </span>
          <span className="text-label text-clay">
            added <LocalTime format="short-day" value={node.createdAt} />
            {node.region ? ` · ${node.region}` : ""}
          </span>
        </span>
        <StatusChip label={node.status} tone={nodeStatusTone(node.status)} />
      </div>

      <ul className="flex flex-col gap-1.5">
        {accounts.map((account) => (
          <li
            className="flex items-baseline justify-between gap-3"
            key={account.id}
          >
            <span className="text-enamel min-w-0 truncate text-sm leading-5">
              {providerLabel(account.provider)}
            </span>
            <span className="text-clay shrink-0 text-sm leading-5">
              {account.planTier}
            </span>
          </li>
        ))}
        {accounts.length === 0 && (
          <li className="text-clay text-sm leading-5">
            not serving models yet
          </li>
        )}
      </ul>

      {nodeListings.length > 0 && (
        <div className="border-soot flex flex-col gap-1.5 border-t pt-3">
          <span className="text-label tracking-label text-mud">
            LISTINGS · PRICE IN · OUT / 1M
          </span>
          <ul className="flex flex-col gap-1.5">
            {nodeListings.map((listing) => (
              <ListingLine key={listing.id} listing={listing} />
            ))}
          </ul>
        </div>
      )}

      <span
        className={cx(
          "text-label flex items-center justify-between gap-3",
          next ? "text-amber" : "text-clay"
        )}
      >
        <span>{next ? `NEXT · ${next.label.toUpperCase()}` : "SET UP"}</span>
        <span>MANAGE MODELS & PRICES →</span>
      </span>
    </Link>
  );
};
