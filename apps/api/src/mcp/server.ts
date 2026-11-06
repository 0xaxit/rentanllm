/**
 * The hosted MCP server behind the Claude Desktop connector. One stateless server per
 * request, for the user the OAuth access token belongs to. It pays sellers from that
 * user's agent wallet; the gateway applies the user's Budget limits to every payment.
 * Claude asks the person before each write tool (buy_inference), as for any connector.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  formatUsdc,
  listModels,
  MarketError,
  payAndCall,
  requestQuote,
  signPaymentAs,
  txLine,
  usdcToMicros,
} from "@rentanllm/mcp/remote";
import type { ChatMessage, ChatRequest } from "@rentanllm/mcp/remote";
import { z } from "zod";

const NETWORK = "hedera:testnet";
const DEFAULT_MAX_TOKENS = 512;
const MAX_TOKENS_LIMIT = 32_768;

export interface McpContext {
  /** The user's agent wallet balance in micro-USDC, or null when unknown. */
  readonly balance: (accountId: string) => Promise<bigint | null>;
  readonly gatewayUrl: string;
  /** The RentAnLLM logo, on the server's own origin. */
  readonly icon: { readonly sizes: readonly string[]; readonly src: string };
  /** The user's recent paid requests from the agent wallet, newest first. */
  readonly recent: (accountId: string) => Promise<
    readonly {
      readonly createdAt: Date;
      readonly model: string;
      readonly paidMicros: bigint;
      readonly payTo: string;
      readonly tx: string;
    }[]
  >;
  /** The agent wallet's account and key; null when the user has none yet. */
  readonly signer: () => Promise<{
    readonly accountId: string;
    readonly privateKeyHex: string;
  } | null>;
  /** Where the user creates and funds the agent wallet. */
  readonly walletPage: string;
}

const text = (value: string) => ({
  content: [{ text: value, type: "text" as const }],
});
const failure = (value: string) => ({ ...text(value), isError: true });

const requestShape = {
  max_tokens: z
    .number()
    .int()
    .min(1)
    .max(MAX_TOKENS_LIMIT)
    .optional()
    .describe(
      `Longest answer to pay for, in tokens (default ${DEFAULT_MAX_TOKENS}). The price covers all of it.`
    ),
  model: z
    .string()
    .min(1)
    .describe("A model id from list_models, e.g. llama3.1:8b"),
  prompt: z.string().min(1).describe("What to ask the model"),
  system: z.string().optional().describe("Optional system prompt"),
};

const toRequest = (input: {
  readonly max_tokens?: number | undefined;
  readonly model: string;
  readonly prompt: string;
  readonly system?: string | undefined;
}): ChatRequest => {
  const messages: ChatMessage[] = [];
  if (input.system !== undefined && input.system.length > 0) {
    messages.push({ content: input.system, role: "system" });
  }
  messages.push({ content: input.prompt, role: "user" });
  return {
    maxTokens: input.max_tokens ?? DEFAULT_MAX_TOKENS,
    messages,
    model: input.model,
  };
};

const explain = (error: unknown) =>
  error instanceof MarketError
    ? error.message
    : `unexpected failure: ${String(error)}`;

const WEBSITE = "https://rentanllm.vercel.app";

export const buildMcpServer = (ctx: McpContext): McpServer => {
  const icons = [
    { mimeType: "image/png", sizes: [...ctx.icon.sizes], src: ctx.icon.src },
  ];
  const server = new McpServer(
    {
      icons,
      name: "rentanllm",
      title: "RentAnLLM",
      version: "1.0.0",
      websiteUrl: WEBSITE,
    },
    {
      instructions:
        "RentAnLLM sells open-model inference from people's own machines, paid per request in USDC on Hedera testnet. Use list_models, then quote_inference to see a price, then buy_inference to pay the seller from the user's agent wallet and get the answer. agent_wallet shows the balance and recent payments.",
    }
  );

  server.registerTool(
    "list_models",
    {
      annotations: { openWorldHint: true, readOnlyHint: true },
      description:
        "Open models for sale on RentAnLLM right now: sellers online and the cheapest prices per million tokens.",
      title: "List models",
    },
    async () => {
      try {
        const models = await listModels(ctx.gatewayUrl);
        if (models.length === 0) {
          return text("Nothing is for sale right now.");
        }
        return text(
          models
            .map(
              (m) =>
                `${m.id}: ${m.sellers_online} of ${m.sellers} sellers online, from ${m.cheapest_input_usdc_per_mtok ?? "?"} in / ${m.cheapest_output_usdc_per_mtok ?? "?"} out USDC per M tokens`
            )
            .join("\n")
        );
      } catch (error) {
        return failure(explain(error));
      }
    }
  );

  server.registerTool(
    "quote_inference",
    {
      annotations: { openWorldHint: true, readOnlyHint: true },
      description:
        "What one request would cost and which seller gets paid. Pays nothing.",
      inputSchema: requestShape,
      title: "Quote a request",
    },
    async (input) => {
      try {
        const quote = await requestQuote(
          ctx.gatewayUrl,
          NETWORK,
          toRequest(input)
        );
        return text(
          `${formatUsdc(BigInt(quote.terms.amount))} USDC to seller ${quote.terms.payTo} on ${NETWORK}, covering the prompt and up to ${input.max_tokens ?? DEFAULT_MAX_TOKENS} output tokens.`
        );
      } catch (error) {
        return failure(explain(error));
      }
    }
  );

  server.registerTool(
    "buy_inference",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
        readOnlyHint: false,
      },
      description:
        "Pays the cheapest online seller from the user's agent wallet (USDC on Hedera testnet) and returns the model's answer with the on-chain receipt.",
      inputSchema: {
        ...requestShape,
        max_price_usdc: z
          .string()
          .optional()
          .describe('Refuse if the price is above this, e.g. "0.01"'),
      },
      title: "Buy inference",
    },
    async (input) => {
      try {
        const signer = await ctx.signer();
        if (signer === null) {
          return failure(
            `The user has no agent wallet yet. They can create one and add USDC at ${ctx.walletPage}`
          );
        }
        const request = toRequest(input);
        const quote = await requestQuote(ctx.gatewayUrl, NETWORK, request);
        const price = BigInt(quote.terms.amount);
        if (
          input.max_price_usdc !== undefined &&
          price > usdcToMicros(input.max_price_usdc)
        ) {
          return failure(
            `Not paid: the price is ${formatUsdc(price)} USDC, above the ${input.max_price_usdc} USDC limit.`
          );
        }
        const balance = await ctx.balance(signer.accountId);
        if (balance !== null && balance < price) {
          return failure(
            `Not paid: the agent wallet ${signer.accountId} holds ${formatUsdc(balance)} USDC and this costs ${formatUsdc(price)}. Add USDC at ${ctx.walletPage}`
          );
        }
        const payment = await signPaymentAs(
          signer.accountId,
          NETWORK,
          signer.privateKeyHex,
          quote
        );
        const answer = await payAndCall(ctx.gatewayUrl, request, payment);
        const receipt = [
          `paid ${formatUsdc(price)} USDC from ${signer.accountId} to ${quote.terms.payTo}`,
          txLine(NETWORK, answer.tx),
        ];
        if (answer.error !== null) {
          return failure(
            [
              `Paid, but the seller failed to answer: ${answer.error}`,
              "",
              "---",
              ...receipt,
            ].join("\n")
          );
        }
        return text(
          [
            answer.content,
            "",
            "---",
            ...receipt,
            `tokens: ${answer.inputTokens ?? "?"} in, ${answer.outputTokens ?? "?"} out`,
          ].join("\n")
        );
      } catch (error) {
        return failure(`Not paid: ${explain(error)}`);
      }
    }
  );

  server.registerTool(
    "agent_wallet",
    {
      annotations: { openWorldHint: true, readOnlyHint: true },
      description:
        "The user's agent wallet: its Hedera account, USDC balance and latest payments with their transactions.",
      title: "Agent wallet",
    },
    async () => {
      const signer = await ctx.signer();
      if (signer === null) {
        return text(
          `No agent wallet yet. Create one and add USDC at ${ctx.walletPage}`
        );
      }
      const [balance, recent] = await Promise.all([
        ctx.balance(signer.accountId),
        ctx.recent(signer.accountId),
      ]);
      const lines = [
        `account: ${signer.accountId} (Hedera testnet)`,
        `balance: ${balance === null ? "unknown" : `${formatUsdc(balance)} USDC`}`,
        `top up: ${ctx.walletPage}`,
      ];
      if (recent.length > 0) {
        lines.push("", "latest payments:");
        for (const r of recent) {
          lines.push(
            `${r.createdAt.toISOString()} ${r.model} ${formatUsdc(r.paidMicros)} USDC to ${r.payTo} · ${txLine(NETWORK, r.tx)}`
          );
        }
      }
      return text(lines.join("\n"));
    }
  );

  return server;
};
