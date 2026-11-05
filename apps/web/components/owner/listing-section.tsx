import { getSuggestion } from "@/lib/api/queries";
import type { Listing } from "@/lib/api/types";
import { modelsLabel } from "@/lib/market";

import { PricePanel } from "../console/price-panel";
import { ListingStatus } from "./listing-status";

/** One listing on its node's page: its models, price and live / paused. */
export const ListingSection = async ({ listing }: { listing: Listing }) => {
  const [model] = listing.models;
  const suggestion = model
    ? await getSuggestion({ model, provider: listing.provider })
    : null;
  const title = modelsLabel(listing.models);
  return (
    <section
      aria-label={`Listing ${title}`}
      className="border-dark flex scroll-mt-6 flex-col gap-4 border-t pt-5"
      id={`listing-${listing.id}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-body tracking-label text-enamel leading-5.25">
          LISTING · {title.toUpperCase()}
        </h3>
        <ListingStatus listingId={listing.id} status={listing.status} />
      </div>
      <div className="xl:w-1/2">
        <PricePanel
          key={`${listing.id}-price`}
          listing={listing}
          suggestion={suggestion}
        />
      </div>
    </section>
  );
};
