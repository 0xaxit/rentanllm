import type { Metadata } from "next";

import { ApiErrorState } from "@/components/api-error";
import { GroupedList, GroupedRow } from "@/components/app-shell/grouped-list";
import { AppMain, PageHeader } from "@/components/app-shell/page-header";
import { CopyButton } from "@/components/copy-button";
import { ArkivBoard } from "@/components/market/arkiv-board";
import { PaymentRow } from "@/components/market/payment-row";
import {
  BlockHeading,
  Callout,
  LiveCursor,
  Note,
} from "@/components/primitives";
import { getMarketOffers, getPaidRequests } from "@/lib/api/queries";
import { getArkivBoard } from "@/lib/arkiv";
import { GATEWAY_API_BASE } from "@/lib/env";
import { marketModels } from "@/lib/market";
import { formatPrice } from "@/lib/money";

export const metadata: Metadata = {
  description:
    "Open models on people's own machines, bought one request at a time by AI agents, paid in USDC straight to the seller.",
  title: "Market",
};

// Prices and the payment feed change by the request.
export const dynamic = "force-dynamic";

const callSnippet = (model: string) =>
  [
    `curl -i ${GATEWAY_API_BASE}/chat/completions \\`,
    `  -H "content-type: application/json" \\`,
    `  -d '{"model":"${model}","max_tokens":256,`,
    `       "messages":[{"role":"user","content":"Hello"}]}'`,
    "# -> 402 with the price; pay it with any x402 client and send it again",
  ].join("\n");

const MarketPage = async () => {
  const [offers, payments, arkiv] = await Promise.all([
    getMarketOffers(),
    getPaidRequests(),
    getArkivBoard(),
  ]);
  const models = offers.ok ? marketModels(offers.data) : [];
  const example = models.find((row) => row.online > 0)?.model ?? "llama3.1:8b";
  return (
    <AppMain>
      <PageHeader
        kicker="AGENTS · PAY PER REQUEST"
        note="prices in USDC per million tokens"
        title="Market"
      />
      <div className="hidden flex-col items-start gap-2 pt-11 md:flex">
        <Note tone="mud">
          no account, no key · each request is paid to its seller
        </Note>
        <BlockHeading lines={["FOR SALE NOW"]} tone="ash" />
      </div>
      {offers.ok ? (
        <GroupedList
          footer="the gateway quotes the cheapest online sellers in every 402"
          title="MODELS"
        >
          {models.map((row) => (
            <GroupedRow
              detail={`${row.online} of ${row.sellers} seller${row.sellers === 1 ? "" : "s"} online`}
              key={row.model}
              label={row.model}
              tone={row.online > 0 ? "amber" : "muted"}
              value={`from ${formatPrice(row.cheapestIn)} in · ${formatPrice(row.cheapestOut)} out`}
            />
          ))}
          {models.length === 0 && (
            <GroupedRow
              label="Nothing is listed yet"
              value="run a node to sell"
            />
          )}
        </GroupedList>
      ) : (
        <ApiErrorState
          error={offers.error}
          signedOut={{ body: "", title: "Sign in" }}
        />
      )}
      <Callout rule="amber">
        <div className="flex flex-col gap-3">
          <p className="text-body text-enamel leading-5.75">
            Call it like any OpenAI-compatible API. The first answer is a 402
            with the price: your prompt plus the full max_tokens, at the
            cheapest online seller&apos;s rates. Pay it with x402 and the
            gateway streams the answer.
          </p>
          <pre className="text-cement overflow-x-auto bg-black p-3 text-sm leading-5">
            {callSnippet(example)}
          </pre>
          <CopyButton
            label="COPY"
            text={callSnippet(example)}
            toast="Command copied"
            variant="outline"
          />
        </div>
      </Callout>
      {payments.ok && (
        <GroupedList
          footer="every payment settled on chain before its request ran"
          title="LATEST PAID REQUESTS"
        >
          {payments.data.map((request) => (
            <PaymentRow key={request.requestId} request={request} />
          ))}
          {payments.data.length === 0 && (
            <GroupedRow
              label={
                <span className="flex items-center gap-2">
                  waiting for the first paid request <LiveCursor />
                </span>
              }
            />
          )}
        </GroupedList>
      )}
      <ArkivBoard read={arkiv} />
    </AppMain>
  );
};

export default MarketPage;
