import type { Metadata } from "next";

import { ApiErrorState } from "@/components/api-error";
import { GroupedList, GroupedRow } from "@/components/app-shell/grouped-list";
import { AppMain, PageHeader } from "@/components/app-shell/page-header";
import { PaymentRow } from "@/components/market/payment-row";
import { EarningsTile } from "@/components/owner/earnings-tile";
import { BlockHeading, LiveCursor, Note } from "@/components/primitives";
import { getOwnerOverview } from "@/lib/api/queries";
import type { SalesTotals } from "@/lib/api/types";
import { formatInteger, formatTokens, formatUsdExact } from "@/lib/money";

export const metadata: Metadata = {
  description:
    "Every request your models sold, with its on-chain payment, and your totals.",
  title: "Sales",
};

const SIGNED_OUT = {
  body: "Agents pay each request in USDC straight to the wallet you sign in with.",
  title: "Sign in to see your sales",
};

const TotalsRows = ({ totals }: { totals: SalesTotals }) => (
  <>
    <GroupedRow label="Paid requests" value={formatInteger(totals.requests)} />
    <GroupedRow
      label="Tokens in · out"
      value={`${formatTokens(totals.inputTokens)} · ${formatTokens(totals.outputTokens)}`}
    />
    <GroupedRow
      label="Paid to your wallet"
      tone="foam"
      value={formatUsdExact(totals.paidUsdc)}
    />
  </>
);

const SalesPage = async () => {
  const result = await getOwnerOverview();
  if (!result.ok) {
    return (
      <AppMain>
        <PageHeader kicker="SELLER" title="Sales" />
        <ApiErrorState error={result.error} signedOut={SIGNED_OUT} />
      </AppMain>
    );
  }
  const { sales } = result.data;
  return (
    <AppMain>
      <PageHeader kicker="SELLER" title="Sales" />
      <div className="hidden flex-col items-start gap-2 pt-11 md:flex">
        <BlockHeading lines={["SALES"]} size="h3" tone="ash" />
      </div>
      <EarningsTile
        amountUsdc={sales.lifetime.paidUsdc}
        caption="each request is paid on chain before it runs, straight to your wallet"
        kicker="PAID TO YOUR WALLET"
      />
      <GroupedList title="LAST 24 HOURS">
        <TotalsRows totals={sales.last24h} />
      </GroupedList>
      <GroupedList title="TO DATE">
        <TotalsRows totals={sales.lifetime} />
      </GroupedList>
      <GroupedList
        footer="the price covers the prompt plus the full max_tokens; unused output is not refunded"
        title="LATEST PAID REQUESTS"
      >
        {sales.recent.map((request) => (
          <PaymentRow key={request.requestId} request={request} />
        ))}
        {sales.recent.length === 0 && (
          <GroupedRow
            label={
              <span className="flex items-center gap-2">
                waiting for the first paid request <LiveCursor />
              </span>
            }
          />
        )}
      </GroupedList>
      <Note>no platform fee is taken from market sales</Note>
    </AppMain>
  );
};

export default SalesPage;
