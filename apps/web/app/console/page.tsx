import type { Metadata } from "next";

import { ApiErrorState } from "@/components/api-error";
import { GroupedList, GroupedRow } from "@/components/app-shell/grouped-list";
import {
  AppMain,
  PageHeader,
  StatusChip,
} from "@/components/app-shell/page-header";
import { ConsoleActions } from "@/components/console/console-actions";
import { EarningsTile } from "@/components/owner/earnings-tile";
import { NodeCard } from "@/components/owner/node-card";
import { NodeStatusWatch } from "@/components/owner/node-status-watch";
import { RegisterNode } from "@/components/owner/register-node";
import { SetupSteps } from "@/components/owner/setup-steps";
import { BlockHeading, Label, Note } from "@/components/primitives";
import { getOwnerOverview } from "@/lib/api/queries";
import type { ApiNode, Listing, SalesTotals } from "@/lib/api/types";
import { shortAddress, shortId } from "@/lib/cx";
import { formatInteger, formatTokens, formatUsdExact } from "@/lib/money";
import { setupSteps } from "@/lib/setup-steps";

export const metadata: Metadata = {
  description:
    "What your open models have sold, the selling switch and your nodes, each with its prices.",
  title: "Dashboard",
};

const SIGNED_OUT = {
  body: "Your console shows what your models have sold, your nodes and their prices. Sign in with the wallet buyers pay.",
  title: "Sign in to your seller console",
};

const nodeChip = (node: ApiNode | undefined) => {
  if (!node) {
    return <StatusChip label="no node" tone="clay" />;
  }
  const online = node.status === "online";
  return (
    <StatusChip
      label={node.region ?? shortId(node.id).slice(0, 6)}
      tone={online ? "live" : "down"}
      value={online ? "LIVE" : "OFF"}
    />
  );
};

/** "12 paid requests · 3.4K tokens out, paid straight to your wallet". */
const salesCaption = (totals: SalesTotals): string => {
  if (totals.requests === 0) {
    return "nothing sold yet · each paid request shows here";
  }
  return `${formatInteger(totals.requests)} paid requests · ${formatTokens(totals.outputTokens)} tokens out · paid straight to your wallet`;
};

const Stats = ({
  last24h,
  listings,
  nodes,
}: {
  last24h: SalesTotals;
  listings: readonly Listing[];
  nodes: readonly ApiNode[];
}) => {
  const models = new Set(
    listings.flatMap((l) => (l.status === "live" ? l.models : []))
  );
  const stats = [
    { label: "REQUESTS · 24H", value: formatInteger(last24h.requests) },
    { label: "SOLD · 24H", value: formatUsdExact(last24h.paidUsdc) },
    {
      label: "NODES ONLINE",
      value: `${nodes.filter((n) => n.status === "online").length} / ${nodes.length}`,
    },
    { label: "MODELS LIVE", value: String(models.size) },
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-5 md:flex md:flex-wrap md:gap-x-11">
      {stats.map((stat) => (
        <div className="flex flex-col-reverse gap-1.5" key={stat.label}>
          <dd className="text-title text-enamel leading-6.5">{stat.value}</dd>
          <dt>
            <Label>{stat.label}</Label>
          </dt>
        </div>
      ))}
    </dl>
  );
};

const DashboardPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) => {
  const [{ next }, result] = await Promise.all([
    searchParams,
    getOwnerOverview(),
  ]);
  if (!result.ok) {
    return (
      <AppMain>
        <PageHeader kicker="SELLER" title="Dashboard" />
        <div className="md:pt-11">
          <ApiErrorState error={result.error} signedOut={SIGNED_OUT} />
        </div>
      </AppMain>
    );
  }
  const { dashboard, listings, me, sales } = result.data;
  const { nodes } = dashboard;
  const online = nodes.filter((n) => n.status === "online");

  return (
    <AppMain>
      <PageHeader
        kicker={`SELLER · ${shortAddress(me.walletAddress)}`}
        note="pull to refresh"
        title="Dashboard"
        trailing={nodeChip(online[0] ?? nodes[0])}
      />
      <NodeStatusWatch nodes={dashboard.nodes} />
      <SetupSteps
        steps={setupSteps({
          accounts: dashboard.providerAccounts,
          listings,
          nodes: dashboard.nodes,
        })}
      />
      <div className="flex flex-col gap-5.5 md:pt-11 lg:flex-row">
        <EarningsTile
          amountUsdc={sales.lifetime.paidUsdc}
          caption={salesCaption(sales.lifetime)}
          kicker="SOLD TO DATE · PAID PER REQUEST"
        />
        <div className="flex grow basis-0 flex-col justify-between gap-6 lg:pt-5.5">
          <Stats last24h={sales.last24h} listings={listings} nodes={nodes} />
          <ConsoleActions listings={listings} />
        </div>
      </div>

      <section aria-labelledby="nodes-title" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3 pt-4">
          <div className="flex flex-col items-start gap-2">
            <BlockHeading
              id="nodes-title"
              lines={["NODES"]}
              size="h3"
              tone="ash"
            />
            <Note>
              {nodes.length === 0
                ? "register the machine that runs your models"
                : `${online.length} of ${nodes.length} online · open a node to set its models and prices`}
            </Note>
          </div>
          <RegisterNode
            autoOpen={next === "node"}
            hasNodes={nodes.length > 0}
            key={`register-${typeof next === "string" ? next : ""}`}
          />
        </div>
        {nodes.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-2">
            {nodes.map((node, index) => (
              <NodeCard
                accounts={dashboard.providerAccounts.filter(
                  (a) => a.nodeId === node.id
                )}
                key={node.id}
                listings={listings}
                newest={index === 0 && nodes.length > 1}
                node={node}
              />
            ))}
          </div>
        )}
      </section>

      <GroupedList title="MORE">
        <GroupedRow
          href="/console/sales"
          label="Paid requests"
          value={`${formatInteger(sales.lifetime.requests)} to date`}
        />
        <GroupedRow
          label="Payout wallet"
          value={shortAddress(me.walletAddress)}
        />
      </GroupedList>
    </AppMain>
  );
};

export default DashboardPage;
