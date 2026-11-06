import type { Metadata } from "next";

import { ApiErrorState } from "@/components/api-error";
import { GroupedList, GroupedRow } from "@/components/app-shell/grouped-list";
import { AppMain, PageHeader } from "@/components/app-shell/page-header";
import { CopyButton } from "@/components/copy-button";
import { AgentWalletCard } from "@/components/market/agent-wallet-card";
import { UseTabs } from "@/components/market/use-tabs";
import type { UseMode } from "@/components/market/use-tabs";
import {
  BlockHeading,
  Callout,
  Note,
} from "@/components/primitives";
import { SignInButton } from "@/components/wallet/sign-in-button";
import { getAgentWallet, getMarketOffers } from "@/lib/api/queries";
import type { AgentWallet } from "@/lib/api/types";
import { GATEWAY_API_BASE, GATEWAY_URL, MCP_URL } from "@/lib/env";
import { marketModels } from "@/lib/market";
import { formatPrice } from "@/lib/money";

export const metadata: Metadata = {
  description:
    "Open models on people's own machines, bought one request at a time by AI agents, paid in USDC straight to the seller. Connect Claude Desktop, or call the OpenAI-compatible API.",
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

const TOOLS = [
  {
    detail: "models for sale, sellers online, prices",
    label: "list_models",
    value: "read",
  },
  {
    detail: "what one request costs and who gets paid",
    label: "quote_inference",
    value: "read",
  },
  {
    detail: "pays the seller from your agent wallet, returns the answer",
    label: "buy_inference",
    value: "pays",
  },
  {
    detail: "balance and latest payments with links",
    label: "agent_wallet",
    value: "read",
  },
] as const;

const localMcpConfig = () =>
  JSON.stringify(
    {
      mcpServers: {
        rentanllm: {
          args: ["/path/to/rentanllm/apps/mcp/src/main.ts"],
          command: "bun",
          env: {
            RENTANLLM_GATEWAY_URL: GATEWAY_URL,
            RENTANLLM_MCP_ACCOUNT: "0.0.12345",
            RENTANLLM_MCP_MAX_PER_DAY_USDC: "1",
            RENTANLLM_MCP_MAX_PER_REQUEST_USDC: "0.05",
            RENTANLLM_MCP_NETWORK: "hedera:testnet",
          },
        },
      },
    },
    null,
    2
  );

const initialMode = (raw: string | string[] | undefined): UseMode =>
  raw === "api" ? "api" : "mcp";

/** "signed-out", or the buyer's agent wallet (null before it exists). */
type WalletState = AgentWallet | null | "signed-out";

/** A numbered step: the number in amber, the label in the main text colour. */
const StepHeading = ({ label, step }: { label: string; step: number }) => (
  <h3 className="text-body tracking-label text-enamel flex gap-2 pl-1 leading-5.75">
    <span className="text-amber">{step}</span>
    <span>{label}</span>
  </h3>
);

const McpPanel = ({ wallet }: { wallet: WalletState }) => (
  <div className="flex flex-col gap-5">
    <Callout rule="amber">
      <p className="text-body text-enamel leading-5.75">
        Add RentAnLLM to Claude Desktop as a connector. Claude finds a model,
        tells you the price and, when you confirm, pays the seller from your
        agent wallet. Your wallet sign-in here is the login: no key leaves your
        wallet, and no API key to copy.
      </p>
    </Callout>
    <StepHeading label="SIGN IN AND FUND YOUR AGENT WALLET" step={1} />
    <GroupedList className="-mt-3">
      {wallet === "signed-out" ? (
        <li className="flex flex-col items-start gap-3 p-4">
          <p className="text-body text-cement">
            Sign in with your wallet. The connector uses the same sign-in.
          </p>
          <SignInButton variant="light" />
        </li>
      ) : (
        <li className="p-4">
          <AgentWalletCard wallet={wallet} />
        </li>
      )}
    </GroupedList>
    <StepHeading label="ADD THE CONNECTOR IN CLAUDE DESKTOP" step={2} />
    <Callout className="-mt-3" rule="mud">
      <div className="flex flex-col gap-3">
        <p className="text-body text-cement leading-5.75">
          Settings → Connectors → Add custom connector. Name it RentAnLLM and
          paste this URL:
        </p>
        <pre className="text-enamel overflow-x-auto bg-black p-3 text-sm leading-5">
          {MCP_URL}
        </pre>
        <CopyButton
          label="COPY URL"
          text={MCP_URL}
          toast="Connector URL copied"
          className="self-start"
          variant="chip"
        />
        <p className="text-body text-cement leading-5.75">
          Press Connect. Claude opens RentAnLLM in your browser; you are already
          signed in, so approve once and you are back in Claude.
        </p>
      </div>
    </Callout>
    <StepHeading label="ASK CLAUDE" step={3} />
    <GroupedList
      className="-mt-3"
      footer="Claude asks before every buy_inference · your Budget limits are checked before each payment settles"
    >
      {TOOLS.map((tool) => (
        <GroupedRow
          detail={tool.detail}
          key={tool.label}
          label={tool.label}
          tone={tool.value === "pays" ? "amber" : "plain"}
          value={tool.value}
        />
      ))}
    </GroupedList>
    <Note>
      try: &quot;use RentAnLLM to ask llama3.1:8b for a haiku about Hedera&quot;
    </Note>
  </div>
);

const ApiPanel = ({ example }: { example: string }) => (
  <div className="flex flex-col gap-5">
    <Callout rule="amber">
      <div className="flex flex-col gap-3">
        <p className="text-body text-enamel leading-5.75">
          Call it like any OpenAI-compatible API. The first answer is a 402 with
          the price: your prompt plus the full max_tokens, at the cheapest
          online seller&apos;s rates. Pay it with x402 and the gateway streams
          the answer.
        </p>
        <pre className="text-cement overflow-x-auto bg-black p-3 text-sm leading-5">
          {callSnippet(example)}
        </pre>
        <CopyButton
          label="COPY"
          text={callSnippet(example)}
          toast="Command copied"
          className="self-start"
          variant="chip"
        />
      </div>
    </Callout>
    <Callout rule="mud">
      <div className="flex flex-col gap-3">
        <p className="text-label tracking-label text-mud">
          OR RUN THE MCP SERVER ON YOUR MACHINE
        </p>
        <p className="text-body text-cement leading-5.75">
          For Claude Code, Cursor or any local MCP client. It pays from your own
          Hedera account, and the key stays in your macOS keychain behind Touch
          ID.
        </p>
        <pre className="text-cement overflow-x-auto bg-black p-3 text-sm leading-5">
          {localMcpConfig()}
        </pre>
        <CopyButton
          label="COPY CONFIG"
          text={localMcpConfig()}
          toast="Config copied"
          className="self-start"
          variant="chip"
        />
        <Note>
          store the key once with bun src/main.ts store-key · see
          apps/mcp/README.md
        </Note>
      </div>
    </Callout>
  </div>
);

const MarketPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ use?: string | string[] }>;
}) => {
  const [{ use }, offers, walletResult] = await Promise.all([
    searchParams,
    getMarketOffers(),
    getAgentWallet(),
  ]);
  const wallet: WalletState = walletResult.ok
    ? walletResult.data
    : "signed-out";
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
      <UseTabs
        api={<ApiPanel example={example} />}
        initial={initialMode(use)}
        mcp={<McpPanel wallet={wallet} />}
      />
    </AppMain>
  );
};

export default MarketPage;
