import type { Metadata } from "next";

import { ApiErrorState } from "@/components/api-error";
import { GroupedList, GroupedRow } from "@/components/app-shell/grouped-list";
import { AppMain, PageHeader } from "@/components/app-shell/page-header";
import { AgentWalletCard } from "@/components/market/agent-wallet-card";
import { ConnectConsent } from "@/components/market/connect-consent";
import { Callout, Note } from "@/components/primitives";
import { getAgentWallet, getOAuthGrant } from "@/lib/api/queries";

export const metadata: Metadata = {
  description:
    "Approve an MCP client, like Claude Desktop, to buy inference for you.",
  robots: { index: false },
  title: "Connect",
};

export const dynamic = "force-dynamic";

const SIGNED_OUT = {
  body: "Sign in with your wallet to connect this app to RentAnLLM. After that, the app stays signed in as you.",
  title: "Sign in to connect",
};

const CAN = [
  { label: "See what is for sale and what a request costs", value: "read" },
  {
    label: "Pay sellers from your agent wallet, after you confirm in the app",
    value: "pays",
  },
  { label: "Read your agent wallet's balance and payments", value: "read" },
] as const;

const ConnectPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ grant?: string | string[] }>;
}) => {
  const { grant: raw } = await searchParams;
  const grantId = typeof raw === "string" ? raw : "";
  const [grant, wallet] = await Promise.all([
    getOAuthGrant(grantId),
    getAgentWallet(),
  ]);
  if (!grant.ok && grant.error.kind === "NotFound") {
    // Already answered (often this very page, re-rendering on the way back to the
    // client) or expired: not an error for the person.
    return (
      <AppMain>
        <PageHeader kicker="MCP · CONNECT" title="Connect" />
        <Callout rule="foam">
          <div className="flex flex-col gap-2">
            <p className="text-body text-enamel leading-5.75">
              This connection request has been answered. If Claude shows
              RentAnLLM as connected, you are done and can close this tab.
            </p>
            <p className="text-body text-cement leading-5.75">
              Not connected? Requests expire after 10 minutes: press Connect
              again in Claude&apos;s connector settings.
            </p>
          </div>
        </Callout>
      </AppMain>
    );
  }
  if (!grant.ok) {
    return (
      <AppMain>
        <PageHeader kicker="MCP · CONNECT" title="Connect" />
        <ApiErrorState error={grant.error} signedOut={SIGNED_OUT} />
      </AppMain>
    );
  }
  const { clientName, redirectHost } = grant.data;
  return (
    <AppMain>
      <PageHeader
        kicker="MCP · CONNECT"
        note={`you go back to ${redirectHost} afterwards`}
        title={`Connect ${clientName}`}
      />
      <Callout rule="amber">
        <p className="text-body text-enamel leading-5.75">
          {clientName} wants to use RentAnLLM as you. It never gets your wallet
          key: it pays only from your agent wallet, and the gateway applies your
          Budget limits to every payment.
        </p>
      </Callout>
      <GroupedList title={`${clientName.toUpperCase()} WILL BE ABLE TO`}>
        {CAN.map((item) => (
          <GroupedRow
            key={item.label}
            label={item.label}
            tone={item.value === "pays" ? "amber" : "plain"}
            value={item.value}
          />
        ))}
      </GroupedList>
      {wallet.ok && <AgentWalletCard wallet={wallet.data} />}
      <ConnectConsent clientName={clientName} grantId={grantId} />
      <Note>
        disconnect any time from {clientName}&apos;s connector settings
      </Note>
    </AppMain>
  );
};

export default ConnectPage;
