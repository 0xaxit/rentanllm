import { entityUrl, EXPLORER_URL } from "@rentanllm/arkiv";

import { GroupedList, GroupedRow } from "@/components/app-shell/grouped-list";
import { LocalTime } from "@/components/local-time";
import { Note } from "@/components/primitives";
import type { ArkivRead } from "@/lib/arkiv";
import { shortAddress } from "@/lib/cx";
import { networkLabel, shortTx } from "@/lib/explorer";
import { formatPrice, formatUsdExact } from "@/lib/money";

const EntityLink = ({ entityKey }: { entityKey: string }) => (
  <a
    className="text-amber underline"
    href={entityUrl(entityKey)}
    rel="noopener noreferrer"
    target="_blank"
  >
    {shortTx(entityKey)}
  </a>
);

/**
 * The market read straight from Arkiv: the offers and receipts the gateway publishes
 * there, each linking to its entity on the Rabdi explorer.
 */
export const ArkivBoard = ({ read }: { read: ArkivRead }) => {
  if (read.kind === "off") {
    return null;
  }
  if (read.kind === "error") {
    return (
      <Note>
        couldn&apos;t read the market from Arkiv right now · {read.message}
      </Note>
    );
  }
  const { offers, receipts, writer } = read.board;
  return (
    <>
      <GroupedList
        footer={
          <>
            read from Arkiv, not our API · written by{" "}
            <a
              className="underline"
              href={`${EXPLORER_URL}/address/${writer}`}
              rel="noopener noreferrer"
              target="_blank"
            >
              {shortAddress(writer)}
            </a>{" "}
            · offers expire unless re-published
          </>
        }
        title="ON ARKIV · OFFERS"
      >
        {offers.map((offer) => (
          <GroupedRow
            detail={
              <>
                {offer.online ? "online" : "offline"} ·{" "}
                {networkLabel(offer.network)} ·{" "}
                <EntityLink entityKey={offer.key} />
              </>
            }
            key={offer.key}
            label={offer.model}
            tone={offer.online ? "amber" : "muted"}
            value={`${formatPrice(offer.priceIn)} in · ${formatPrice(offer.priceOut)} out`}
          />
        ))}
        {offers.length === 0 && (
          <GroupedRow label="No offers published yet" value="—" />
        )}
      </GroupedList>
      <GroupedList title="ON ARKIV · RECEIPTS">
        {receipts.map((receipt) => (
          <GroupedRow
            detail={
              <>
                <LocalTime value={receipt.at} /> ·{" "}
                <EntityLink entityKey={receipt.key} />
              </>
            }
            key={receipt.key}
            label={`${receipt.model} · ${receipt.outputTokens} tokens out`}
            tone={receipt.status === "ok" ? "foam" : "muted"}
            value={formatUsdExact(receipt.paid)}
          />
        ))}
        {receipts.length === 0 && (
          <GroupedRow label="No receipts published yet" value="—" />
        )}
      </GroupedList>
    </>
  );
};
