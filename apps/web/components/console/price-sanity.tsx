import { sanityCopy } from "@/lib/pricing";
import type { PriceSanity } from "@/lib/pricing";

/** Warns when a price makes no sense next to the API price. Saving is still allowed. */
export const PriceSanityWarning = ({ sanity }: { sanity: PriceSanity }) => (
  <p
    className="border-pumpkin text-pumpkin border px-3 py-2 text-sm leading-5"
    role="alert"
  >
    {sanityCopy[sanity]}
  </p>
);
