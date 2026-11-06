import { LocalTime } from "@/components/local-time";
import { BlockHeading, Note } from "@/components/primitives";
import { getMarketOffers } from "@/lib/api/queries";
import type { MarketOffer } from "@/lib/api/types";
import { cx } from "@/lib/cx";
import { API_PROXY_PATH } from "@/lib/env";
import { priceLabel, providerLabel } from "@/lib/market";
import { formatPrice } from "@/lib/money";

const WALLET_HEAD = 6;
const WALLET_TAIL = 4;

/** "0x53e8…e048" */
const shortWallet = (wallet: string): string =>
  wallet.length > WALLET_HEAD + WALLET_TAIL
    ? `${wallet.slice(0, WALLET_HEAD)}…${wallet.slice(-WALLET_TAIL)}`
    : wallet;

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

/** Online first, then the cheapest output price. */
const byAvailability = (offers: readonly MarketOffer[]): MarketOffer[] =>
  offers.toSorted((a, b) => {
    const aOnline = a.nodeStatus === "online" ? 0 : 1;
    const bOnline = b.nodeStatus === "online" ? 0 : 1;
    if (aOnline !== bOnline) {
      return aOnline - bOnline;
    }
    if (a.priceOutPerMtokUsdc === b.priceOutPerMtokUsdc) {
      return 0;
    }
    return a.priceOutPerMtokUsdc < b.priceOutPerMtokUsdc ? -1 : 1;
  });

const COLUMNS = [
  { align: "left", label: "MODEL" },
  { align: "left", label: "PLAN" },
  { align: "left", label: "SELLER" },
  { align: "left", label: "$ / M TOKENS IN · OUT" },
  { align: "left", label: "SLOTS" },
  { align: "left", label: "UPTIME 24H" },
  { align: "left", label: "TTFB" },
  { align: "right", label: "STATUS" },
] as const;

const StatusBadge = ({ online }: { online: boolean }) => (
  <span
    className={cx(
      "text-body inline-block px-1.5 leading-6 tracking-wider",
      online ? "bg-amber text-carbon" : "border-dark text-gone border"
    )}
  >
    {online ? "ONLINE" : "OFFLINE"}
  </span>
);

const dash = "—";

/** "99.9%" */
const uptimeLabel = (pct: number | null): string =>
  pct === null ? dash : `${pct.toFixed(1)}%`;

/** "412 ms" */
const ttfbLabel = (ms: number | null): string =>
  ms === null ? dash : `${ms.toLocaleString("en-US")} ms`;

/** The seller's wallet, with its ERC-8004 agent when it has one. */
const SellerCell = ({ offer }: { offer: MarketOffer }) => (
  <span className="inline-flex items-center gap-2">
    <span title={offer.sellerWallet}>{shortWallet(offer.sellerWallet)}</span>
    {offer.agent !== null && (
      <a
        className="text-amber"
        href={`${API_PROXY_PATH}/agents/${offer.nodeId}/registration.json`}
        rel="noopener noreferrer"
        target="_blank"
        title={`ERC-8004 agent #${offer.agent.agentId} on Hedera · ${offer.agent.uaid}`}
      >
        ✓ AGENT #{offer.agent.agentId}
      </a>
    )}
  </span>
);

const OfferRow = ({ offer }: { offer: MarketOffer }) => {
  const online = offer.nodeStatus === "online";
  return (
    <tr className={cx("border-soot border-t", !online && "text-gone")}>
      <td className={cx("py-4 pr-6", online && "text-enamel")}>
        {offer.models.join(", ")}
      </td>
      <td className={cx("py-4 pr-6", online && "text-enamel")}>
        {providerLabel(offer.provider)}
      </td>
      <td className={cx("py-4 pr-6", online && "text-mud")}>
        <SellerCell offer={offer} />
      </td>
      <td className={cx("py-4 pr-6", online && "text-enamel")}>
        {priceLabel(
          offer.kind,
          offer.priceInPerMtokUsdc,
          offer.priceOutPerMtokUsdc,
          formatPrice
        )}
      </td>
      <td className={cx("py-4 pr-6", online && "text-enamel")}>
        {offer.maxConcurrency}
      </td>
      <td className={cx("py-4 pr-6", online && "text-enamel")}>
        {uptimeLabel(offer.reputation.uptimePct)}
      </td>
      <td
        className={cx("py-4 pr-6", online && "text-enamel")}
        title={
          offer.reputation.requests24h > 0
            ? `median time to first byte over ${offer.reputation.requests24h} paid requests in 24 hours`
            : "no paid requests in 24 hours"
        }
      >
        {ttfbLabel(offer.reputation.ttfbMs)}
      </td>
      <td className="py-4 text-right">
        <StatusBadge online={online} />
      </td>
    </tr>
  );
};

/**
 * The listings a buyer can use right now, read from the market API. Renders nothing
 * when the API cannot be reached, so the landing page never shows an error.
 */
export const AvailableNow = async () => {
  const offers = await getMarketOffers();
  if (!offers.ok) {
    return null;
  }
  const rows = byAvailability(offers.data);
  const online = rows.filter((offer) => offer.nodeStatus === "online");
  const models = new Set(online.flatMap((offer) => offer.models));
  const asOf = new Date();
  return (
    <section
      aria-labelledby="available-title"
      className="bg-carbon px-4 pt-11 pb-16 sm:px-11"
    >
      <div className="flex flex-col gap-2">
        <Note tone="mud">
          prices in USDC · the gateway quotes the cheapest online seller ·
          uptime and TTFB measured by the platform, posted on chain for ERC-8004
          agents
        </Note>
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <BlockHeading
            id="available-title"
            lines={["AVAILABLE NOW"]}
            tone="ash"
          />
          <p className="text-body text-cement flex flex-wrap gap-x-3 tabular-nums">
            <span>{plural(online.length, "seller")} online</span>
            <span aria-hidden="true">·</span>
            <span>{plural(models.size, "model")}</span>
            <span aria-hidden="true">·</span>
            <span className="text-amber">
              UPDATED <LocalTime format="clock" value={asOf} />
            </span>
          </p>
        </div>
      </div>
      <div className="mt-8 overflow-x-auto">
        <table className="text-body w-full min-w-160 border-collapse text-left whitespace-nowrap tabular-nums">
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th
                  className={cx(
                    "text-label text-ash pb-3 font-normal tracking-wider",
                    column.align === "right" ? "text-right" : "pr-6"
                  )}
                  key={column.label}
                  scope="col"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((offer) => (
              <OfferRow key={offer.listingId} offer={offer} />
            ))}
            {rows.length === 0 && (
              <tr className="border-soot border-t">
                <td className="text-cement py-4" colSpan={COLUMNS.length}>
                  Nothing is listed yet.{" "}
                  <a className="text-amber underline" href="#install">
                    Run a node to sell
                  </a>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};
