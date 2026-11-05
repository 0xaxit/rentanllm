import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ApiErrorState } from "@/components/api-error";
import { GroupedList, GroupedRow } from "@/components/app-shell/grouped-list";
import { AppMain, PageHeader } from "@/components/app-shell/page-header";
import { BlockHeading, Note } from "@/components/primitives";
import { SoundToggle } from "@/components/sound/sound-toggle";
import { SignInButton } from "@/components/wallet/sign-in-button";
import { getOwnerOverview } from "@/lib/api/queries";
import { shortAddress } from "@/lib/cx";
import { nodeHref } from "@/lib/setup-steps";

export const metadata: Metadata = {
  description: "Your payout wallet, sounds and sign-in.",
  title: "Settings",
};

const SIGNED_OUT = {
  body: "Manage your account. Sign in with your wallet first.",
  title: "Sign in to your settings",
};

const param = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

/**
 * Listings are edited on their node's page now. Old setup links
 * (`?next=listing&account=`, `?next=hours&listing=`) are sent there.
 */
const SettingsPage = async ({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string | string[];
    account?: string | string[];
    listing?: string | string[];
  }>;
}) => {
  const [query, result] = await Promise.all([searchParams, getOwnerOverview()]);
  if (!result.ok) {
    return (
      <AppMain>
        <PageHeader kicker="OWNER" title="Settings" />
        <ApiErrorState error={result.error} signedOut={SIGNED_OUT} />
      </AppMain>
    );
  }
  const { dashboard, listings, me } = result.data;
  const nodeOfAccount = (accountId: string | undefined) =>
    dashboard.providerAccounts.find((a) => a.id === accountId)?.nodeId;
  const next = param(query.next);
  if (next === "listing" || next === "hours") {
    const listingId = param(query.listing);
    const accountId =
      param(query.account) ??
      listings.find((l) => l.id === listingId)?.providerAccountId;
    const nodeId = nodeOfAccount(accountId) ?? dashboard.nodes[0]?.id;
    if (nodeId !== undefined) {
      const keep: Record<string, string> = { next };
      if (param(query.account)) {
        keep.account = param(query.account) ?? "";
      }
      if (listingId) {
        keep.listing = listingId;
      }
      redirect(nodeHref(nodeId, keep));
    }
  }
  return (
    <AppMain>
      <PageHeader kicker="OWNER" title="Settings" />
      <div className="hidden flex-col items-start gap-2 pt-11 md:flex">
        <BlockHeading lines={["SETTINGS"]} size="h3" tone="ash" />
      </div>
      <GroupedList title="ACCOUNT">
        <GroupedRow
          label="Payout wallet"
          value={shortAddress(me.walletAddress)}
        />
        <GroupedRow href="/market" label="Buy inference instead" />
        <GroupedRow
          label="Interface sounds"
          value={<SoundToggle className="text-amber -my-2" />}
        />
      </GroupedList>
      <div className="flex flex-col gap-2">
        <SignInButton variant="wide" />
        <Note>
          opens your wallet: switch account, sign out or disconnect ·{" "}
          <Link className="underline" href="/">
            back to the home page
          </Link>
        </Note>
      </div>
    </AppMain>
  );
};

export default SettingsPage;
