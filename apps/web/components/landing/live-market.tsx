import Link from "next/link";

import { LiveCursor } from "@/components/primitives";
import { getMarketOffers } from "@/lib/api/queries";
import { marketModels } from "@/lib/market";
import { formatPrice } from "@/lib/money";

const MAX_MODELS = 3;

/**
 * What a buyer can use right now: sellers online and the cheapest price per model, read
 * from the market API. Renders nothing when the API cannot be reached, so the landing
 * page never shows an error.
 */
export const LiveMarket = async () => {
  const offers = await getMarketOffers();
  if (!offers.ok) {
    return null;
  }
  const models = marketModels(offers.data);
  const online = models.filter((row) => row.online > 0);
  const sellersOnline = offers.data.filter(
    (offer) => offer.nodeStatus === "online"
  ).length;
  return (
    <Link
      aria-label={`Market: ${sellersOnline} seller${sellersOnline === 1 ? "" : "s"} online. Open the market`}
      className="border-ash hover:bg-aluminum spring flex flex-col gap-2 border p-3"
      href="/market"
    >
      <span className="text-label text-soot flex items-center gap-2">
        {sellersOnline > 0 ? (
          <LiveCursor className="h-2.5 w-2.5" tone="amber" />
        ) : (
          <span aria-hidden="true" className="bg-clay inline-block size-2.5" />
        )}
        {sellersOnline > 0
          ? `LIVE · ${sellersOnline} SELLER${sellersOnline === 1 ? "" : "S"} ONLINE`
          : "NO SELLERS ONLINE RIGHT NOW"}
      </span>
      {online.slice(0, MAX_MODELS).map((row) => (
        <span
          className="text-body text-soot flex flex-wrap justify-between gap-x-4 tabular-nums"
          key={row.model}
        >
          <span>{row.model}</span>
          <span className="text-clay">
            from {formatPrice(row.cheapestOut)} / M out
          </span>
        </span>
      ))}
      <span className="text-label text-clay">
        {online.length > MAX_MODELS
          ? `+${online.length - MAX_MODELS} more models · see the market →`
          : "see the market →"}
      </span>
    </Link>
  );
};
