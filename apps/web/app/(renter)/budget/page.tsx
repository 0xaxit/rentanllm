import type { Metadata } from "next";

import { ApiErrorState } from "@/components/api-error";
import { GroupedList, GroupedRow } from "@/components/app-shell/grouped-list";
import { AppMain, PageHeader } from "@/components/app-shell/page-header";
import { LimitsForm } from "@/components/buyer/limits-form";
import { PaymentRow } from "@/components/market/payment-row";
import { BlockHeading, Callout, Note } from "@/components/primitives";
import { getBuyerOverview } from "@/lib/api/queries";
import { formatUsdExact } from "@/lib/money";

export const metadata: Metadata = {
  description:
    "Spending limits for the Hedera account your agents pay from: a 24-hour budget, a limit per request and per seller, and an allowlist.",
  title: "Budget",
};

// What the account spent changes with every payment.
export const dynamic = "force-dynamic";

const SIGNED_OUT = {
  body: "Sign in with the wallet behind the Hedera account your agents pay from. Its limits then apply to every payment from that account.",
  title: "Sign in to set a budget",
};

const BudgetPage = async () => {
  const result = await getBuyerOverview();
  if (!result.ok) {
    return (
      <AppMain>
        <PageHeader kicker="BUYER · SPENDING LIMITS" title="Budget" />
        <ApiErrorState error={result.error} signedOut={SIGNED_OUT} />
      </AppMain>
    );
  }
  const { account, bySeller, policy, recent, spentLast24hUsdc } = result.data;
  return (
    <AppMain>
      <PageHeader
        kicker="BUYER · SPENDING LIMITS"
        note="the gateway checks these before every payment settles"
        title="Budget"
      />
      <div className="hidden flex-col items-start gap-2 pt-11 md:flex">
        <Note tone="mud">
          the gateway checks these before every payment settles
        </Note>
        <BlockHeading lines={["BUDGET"]} tone="ash" />
      </div>
      {account === null ? (
        <Callout rule="amber">
          <p className="text-body text-enamel leading-5.75">
            Your sign-in wallet has no Hedera account yet. Fund it once on
            Hedera testnet (for example from the Hedera portal faucet), then
            come back to set limits for it.
          </p>
        </Callout>
      ) : (
        <GroupedList
          footer="limits cover payments from this account, whatever client sends them"
          title="PAYING ACCOUNT"
        >
          <GroupedRow
            href={`https://hashscan.io/testnet/account/${account}`}
            label={account}
            tone="amber"
            value="HashScan →"
          />
        </GroupedList>
      )}
      <GroupedList title="LAST 24 HOURS">
        <GroupedRow label="Spent" value={formatUsdExact(spentLast24hUsdc)} />
        {bySeller.map((seller) => (
          <GroupedRow
            detail={`${seller.requests} request${seller.requests === 1 ? "" : "s"}`}
            key={seller.payTo}
            label={seller.payTo}
            value={formatUsdExact(seller.paidUsdc)}
          />
        ))}
      </GroupedList>
      {account === null ? null : <LimitsForm policy={policy} />}
      <GroupedList title="RECENT PAYMENTS">
        {recent.map((request) => (
          <PaymentRow key={request.requestId} request={request} />
        ))}
        {recent.length === 0 && <GroupedRow label="No payments yet" value="" />}
      </GroupedList>
      <Note tone="mud">
        payments still running are counted once they finish
      </Note>
    </AppMain>
  );
};

export default BudgetPage;
