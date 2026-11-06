import type { Metadata } from "next";

import { ApiErrorState } from "@/components/api-error";
import { AppMain, PageHeader } from "@/components/app-shell/page-header";
import { ClaudeMark } from "@/components/market/claude-mark";
import { ConnectConsent } from "@/components/market/connect-consent";
import { Callout } from "@/components/primitives";
import { getOAuthGrant } from "@/lib/api/queries";

export const metadata: Metadata = {
  description:
    "Approve an MCP client, like Claude Desktop, to buy inference for you.",
  robots: { index: false },
  title: "Connect",
};

export const dynamic = "force-dynamic";

const CLAUDE_CLIENT = /claude/iu;

const SIGNED_OUT = {
  body: "Sign in with your wallet to connect this app to RentAnLLM. After that, the app stays signed in as you.",
  title: "Sign in to connect",
};

const ConnectPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ grant?: string | string[] }>;
}) => {
  const { grant: raw } = await searchParams;
  const grantId = typeof raw === "string" ? raw : "";
  const grant = await getOAuthGrant(grantId);
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
  const { clientName } = grant.data;
  const isClaude = CLAUDE_CLIENT.test(clientName);
  return (
    <AppMain>
      <section
        aria-labelledby="connect-title"
        className="flex min-h-[60vh] flex-col items-center justify-center gap-8 py-16 text-center"
      >
        {isClaude && <ClaudeMark size={72} />}
        <h1 className="text-title text-enamel" id="connect-title">
          Connect {clientName} to RentAnLLM
        </h1>
        <ConnectConsent clientName={clientName} grantId={grantId} />
      </section>
    </AppMain>
  );
};

export default ConnectPage;
