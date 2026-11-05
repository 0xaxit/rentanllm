import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ApiErrorState } from "@/components/api-error";
import {
  AppMain,
  PageHeader,
  StatusChip,
} from "@/components/app-shell/page-header";
import { LocalTime } from "@/components/local-time";
import { AddAccount } from "@/components/owner/add-account";
import { CreateListing } from "@/components/owner/create-listing";
import { ListingSection } from "@/components/owner/listing-section";
import { NodeDetails } from "@/components/owner/node-details";
import { NodeStatusWatch } from "@/components/owner/node-status-watch";
import { NodeConnectCommand } from "@/components/owner/register-node";
import { NodeSteps } from "@/components/owner/setup-steps";
import { BlockHeading, Note } from "@/components/primitives";
import { getNodeUptimes, getOwnerOverview } from "@/lib/api/queries";
import type { ApiNode, Listing, ProviderAccount } from "@/lib/api/types";
import { shortId } from "@/lib/cx";
import { providerLabel } from "@/lib/market";
import { nodeStatusTone } from "@/lib/node-status";
import { nodeHref, nodeSetupSteps } from "@/lib/setup-steps";
import type { NodeStep } from "@/lib/setup-steps";

export const metadata: Metadata = {
  description: "One node: the open models it sells and each listing's price.",
  title: "Node",
};

const SIGNED_OUT = {
  body: "Manage your node's models and prices. Sign in with your wallet first.",
  title: "Sign in to manage your node",
};

const BACK = { href: "/console", label: "Dashboard" };

const param = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

interface NodeQuery {
  readonly next: string | undefined;
  /** The account the "List a model" step is for. */
  readonly account: string | undefined;
}

/** What the account serves, then each of its listings with its price. */
const AccountSection = ({
  account,
  listings,
}: {
  account: ProviderAccount;
  listings: readonly Listing[];
}) => (
  <section
    aria-label={`${providerLabel(account.provider)} ${account.planTier}`}
    className="flex flex-col gap-5"
  >
    <p className="text-label tracking-label text-mud">
      {providerLabel(account.provider)} · {account.planTier.toUpperCase()}
    </p>
    {listings.map((listing) => (
      <ListingSection key={listing.id} listing={listing} />
    ))}
    {listings.length === 0 && (
      <Note>nothing listed yet · list a model to set its price</Note>
    )}
  </section>
);

/** The connect and add-plan buttons; the current setup step's one sits in the checklist. */
const nodeActions = (
  node: ApiNode,
  steps: readonly NodeStep[],
  next: string | undefined
) => {
  const pending = steps.find((step) => !step.done)?.id;
  const listingHref = steps.find((step) => step.id === "listing")?.href;
  const connect = (
    <NodeConnectCommand
      connected={node.status === "online"}
      nextHref={
        pending === "node" ? nodeHref(node.id, { next: "plan" }) : undefined
      }
      nodeId={node.id}
      primary={pending === "node"}
    />
  );
  const plan = (
    <AddAccount
      autoOpen={next === "plan"}
      detectedPlans={node.detectedPlans}
      key={`plan-${next ?? ""}`}
      nextHref={pending === "plan" ? (listingHref ?? undefined) : undefined}
      nodeId={node.id}
      primary={pending === "plan"}
    />
  );
  return { connect, pending, plan };
};

const NodePage = async ({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<keyof NodeQuery, string | string[] | undefined>>;
}) => {
  const [{ id }, rawQuery, result] = await Promise.all([
    params,
    searchParams,
    getOwnerOverview(),
  ]);
  if (!result.ok) {
    return (
      <AppMain>
        <PageHeader back={BACK} size="detail" title="Node" />
        <ApiErrorState error={result.error} signedOut={SIGNED_OUT} />
      </AppMain>
    );
  }
  const query: NodeQuery = {
    account: param(rawQuery.account),
    next: param(rawQuery.next),
  };
  const { dashboard, listings } = result.data;
  const node = dashboard.nodes.find((n) => n.id === id);
  if (node === undefined) {
    notFound();
  }
  const accounts = dashboard.providerAccounts.filter(
    (a) => a.nodeId === node.id
  );
  const nodeListings = listings.filter((l) =>
    accounts.some((a) => a.id === l.providerAccountId)
  );
  const steps = nodeSetupSteps({ accounts, listings, node });
  const actions = nodeActions(node, steps, query.next);
  const uptimes = await getNodeUptimes([node.id]);

  return (
    <AppMain>
      <PageHeader
        back={BACK}
        desktop="visible"
        size="detail"
        subtitle={
          <>
            added <LocalTime format="short-day" value={node.createdAt} />{" "}
            <LocalTime value={node.createdAt} /> · models run on this machine
          </>
        }
        title={`Node ${shortId(node.id)}`}
        trailing={
          <StatusChip label={node.status} tone={nodeStatusTone(node.status)} />
        }
      />
      <NodeStatusWatch nodes={[node]} />
      <NodeSteps
        inPlaceAction={
          actions.pending === "node" ? actions.connect : actions.plan
        }
        nodeId={node.id}
        steps={steps}
      />

      <div className="flex flex-col items-start gap-2 pt-4">
        <BlockHeading lines={["MODELS & PRICES"]} size="h3" tone="ash" />
        <Note>
          each listing has its own models and price · agents pay per request
        </Note>
      </div>
      {accounts.map((account) => (
        <AccountSection
          account={account}
          key={account.id}
          listings={nodeListings.filter(
            (l) => l.providerAccountId === account.id
          )}
        />
      ))}
      {accounts.length === 0 && (
        <Note>not serving models yet · turn on open models first.</Note>
      )}
      <div className="flex flex-col gap-3 md:flex-row">
        {accounts.length > 0 && (
          <CreateListing
            accounts={accounts}
            autoOpen={query.next === "listing"}
            defaultAccountId={query.account}
            key={`listing-${query.next ?? ""}-${query.account ?? ""}`}
            listings={listings}
          />
        )}
        {actions.pending !== "plan" && actions.plan}
        {actions.pending !== "node" && actions.connect}
      </div>

      <NodeDetails node={node} uptime={uptimes.get(node.id) ?? null} />
    </AppMain>
  );
};

export default NodePage;
