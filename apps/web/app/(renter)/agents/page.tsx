import type { Metadata } from "next";

import { GroupedList, GroupedRow } from "@/components/app-shell/grouped-list";
import { AppMain, PageHeader } from "@/components/app-shell/page-header";
import { CopyButton } from "@/components/copy-button";
import { BlockHeading, Callout, Note } from "@/components/primitives";
import { GATEWAY_URL } from "@/lib/env";

export const metadata: Metadata = {
  description:
    "Give an agent in Claude, Cursor or any MCP client a capped budget to buy inference, with Touch ID approval for every payment.",
  title: "Agents",
};

const TOOLS = [
  {
    detail: "models for sale, sellers online, cheapest prices",
    label: "list_models",
    value: "read",
  },
  {
    detail: "what one request would cost and who gets paid",
    label: "quote_inference",
    value: "read",
  },
  {
    detail: "pays the seller after your Touch ID, returns the answer",
    label: "buy_inference",
    value: "pays",
  },
  {
    detail: "last 24 hours, the caps, payment links",
    label: "spending",
    value: "read",
  },
] as const;

const STEPS = [
  "The agent asks the gateway for a price: an unpaid request, answered with a 402.",
  "The MCP server checks your per-request and daily caps.",
  "Your Mac asks for Touch ID, naming the amount, the seller and the network.",
  "Only then is the key read, that one payment signed and the request sent.",
  "The answer comes back with the on-chain receipt.",
] as const;

const mcpConfig = () =>
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

const AgentsPage = () => (
  <AppMain>
    <PageHeader
      kicker="MCP · TOUCH ID FOR EVERY PAYMENT"
      note="for Claude Desktop, Claude Code, Cursor and other local MCP clients"
      title="Agents"
    />
    <div className="hidden flex-col items-start gap-2 pt-11 md:flex">
      <Note tone="mud">your agent spends · you approve every payment</Note>
      <BlockHeading lines={["GIVE AN AGENT A BUDGET"]} tone="ash" />
    </div>
    <GroupedList title="WHAT THE AGENT CAN DO">
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
    <Callout rule="amber">
      <div className="flex flex-col gap-3">
        <p className="text-body text-enamel leading-5.75">
          Add the server to your MCP client. The payer key lives in your macOS
          keychain and is released only after Touch ID, one payment at a time.
        </p>
        <pre className="text-cement overflow-x-auto bg-black p-3 text-sm leading-5">
          {mcpConfig()}
        </pre>
        <CopyButton
          label="COPY CONFIG"
          text={mcpConfig()}
          toast="Config copied"
          variant="outline"
        />
        <Note>
          store the key once: bun run build:signer, then pipe it into bun
          src/main.ts store-key · see apps/mcp/README.md
        </Note>
      </div>
    </Callout>
    <GroupedList
      footer="a refusal at any step costs nothing"
      title="EVERY PURCHASE"
    >
      {STEPS.map((step, index) => (
        <GroupedRow key={step} label={step} value={String(index + 1)} />
      ))}
    </GroupedList>
  </AppMain>
);

export default AgentsPage;
