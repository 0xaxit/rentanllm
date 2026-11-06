/**
 * The hosted MCP server behind the Claude Desktop connector. One stateless server per
 * request, for the user the OAuth access token belongs to. It pays sellers from that
 * user's agent wallet; the gateway applies the user's Budget limits to every payment.
 * Claude asks the person before each write tool (buy_inference, generate_image), as for
 * any connector.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PublishedOffer } from "@rentanllm/arkiv";
import {
  formatUsdc,
  listModels,
  MarketError,
  payAndCall,
  payForImage,
  requestImageQuote,
  requestQuote,
  signPaymentAs,
  txLine,
  usdcToMicros,
} from "@rentanllm/mcp/remote";
import type { ChatMessage, ChatRequest } from "@rentanllm/mcp/remote";
import { z } from "zod";

import { arkivModelsShape, modelsFromOffers, modelsText } from "./arkiv-models";
import type { ArkivModels } from "./arkiv-models";
import {
  IMAGE_VIEWER_URI,
  imageViewerHtml,
  imageViewerToolMeta,
  MCP_APP_MIME_TYPE,
} from "./image-viewer";
import type { ImageCaption } from "./image-viewer";
import { HostedWorldError, worldGate } from "./world-gate";
import type { HostedWorld } from "./world-gate";

const NETWORK = "hedera:testnet";
/** The image model the market sells today; generate_image uses it unless told otherwise. */
const DEFAULT_IMAGE_MODEL = "flux-2-klein-4b";
const IMAGE_SIZES = ["512x512", "768x768", "1024x1024"] as const;
const DEFAULT_MAX_TOKENS = 512;
const MAX_TOKENS_LIMIT = 32_768;

/** The gateway's own list, used when Arkiv does not answer. */
const gatewayModels = async (gatewayUrl: string): Promise<ArkivModels> => {
  const models = await listModels(gatewayUrl);
  return {
    models: models.map((m) => ({
      cheapest_input_usdc_per_mtok: m.cheapest_input_usdc_per_mtok,
      cheapest_output_usdc_per_mtok: m.cheapest_output_usdc_per_mtok,
      kind: m.kind ?? "chat",
      model: m.id,
      offers: [],
      sellers: m.sellers,
      sellers_online: m.sellers_online,
    })),
    source: "gateway",
    writer: null,
  };
};

export interface McpContext {
  /** The gateway's offers on Arkiv; null when Arkiv is off or did not answer in time. */
  readonly arkivOffers: () => Promise<{
    readonly offers: readonly PublishedOffer[];
    readonly writer: string;
  } | null>;
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
  /** World ID approval above the user's threshold; null when the API has no World ID. */
  readonly world: HostedWorld | null;
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
  error instanceof MarketError || error instanceof HostedWorldError
    ? error.message
    : `unexpected failure: ${String(error)}`;

const worldApprovalId = z
  .string()
  .optional()
  .describe(
    "Only after this tool returned a World ID link: the world_approval_id it gave, to pay once the person has approved"
  );

const WEBSITE = "https://rentanllm.xyz";

const hashscanTx = (tx: string) =>
  `https://hashscan.io/testnet/transaction/${encodeURIComponent(tx)}`;

/** buy_inference's structured result: what was sent, what came back, what was paid. */
const purchaseShape = {
  answer: z.string().describe("The model's answer, verbatim"),
  max_tokens: z.number().int(),
  model: z.string(),
  payment: z.object({
    amount_usdc: z.string(),
    from: z.string().describe("The agent wallet that paid"),
    network: z.string(),
    to: z.string().describe("The seller's Hedera account"),
    transaction: z.string().nullable(),
    url: z.string().nullable().describe("The payment on HashScan"),
  }),
  prompt: z
    .array(z.object({ content: z.string(), role: z.string() }))
    .describe("The exact messages sent to the model"),
  seller_error: z
    .string()
    .nullable()
    .describe("Set when the payment settled but the seller failed to answer"),
  tokens: z.object({
    input: z.number().int().nullable(),
    output: z.number().int().nullable(),
  }),
  truncated: z.boolean().describe("True when the answer stopped at max_tokens"),
};

export type Purchase = z.infer<z.ZodObject<typeof purchaseShape>>;

/** The same result as text, in labelled sections, for clients that read only text. */
export const purchaseText = (p: Purchase): string => {
  const lines = [`MODEL\n${p.model}`, ""];
  for (const message of p.prompt) {
    lines.push(`PROMPT (${message.role})`, message.content, "");
  }
  if (p.seller_error === null) {
    lines.push(
      p.truncated
        ? `ANSWER (verbatim, cut off at max_tokens ${p.max_tokens})`
        : "ANSWER (verbatim)",
      p.answer,
      ""
    );
  } else {
    lines.push(
      "ANSWER",
      `none: the seller failed to answer (${p.seller_error})`,
      ""
    );
  }
  lines.push(
    "PAYMENT",
    `${p.payment.amount_usdc} USDC from ${p.payment.from} to ${p.payment.to} on ${p.payment.network}`,
    p.payment.url ?? "no transaction id returned",
    `tokens: ${p.tokens.input ?? "?"} in, ${p.tokens.output ?? "?"} out`
  );
  return lines.join("\n");
};

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
        "RentAnLLM sells open-model inference from people's own machines, paid per request in USDC on Hedera testnet. Use list_models once per question (it reads the public Arkiv board and its answer is complete, so do not call it again to check), then quote_inference to see a price, then buy_inference to pay the seller from the user's agent wallet and get the answer. For a picture, use generate_image with an image model (kind image in list_models). agent_wallet shows the balance and recent payments. When you show a buy_inference result, show the exact prompt that was sent and the model's answer verbatim (in a quote or code block), then one payment line with the HashScan link. Do not summarize, grade or comment on the answer unless the user asks. If buy_inference or generate_image says the payment needs World ID approval, show the person the link and code exactly, let them approve on World ID, then call the same tool again with the same arguments plus the world_approval_id it gave; if they no longer want it, call cancel_payment.",
    }
  );

  server.registerTool(
    "list_models",
    {
      annotations: { openWorldHint: true, readOnlyHint: true },
      description:
        "Open models for sale on RentAnLLM right now, read from the public Arkiv board (not RentAnLLM's API): sellers online, the cheapest prices per million tokens, and each offer's Arkiv entity. Prices to pay come from quote_inference.",
      outputSchema: arkivModelsShape,
      title: "List models",
    },
    async () => {
      try {
        const board = await ctx.arkivOffers();
        const result: ArkivModels =
          board === null
            ? await gatewayModels(ctx.gatewayUrl)
            : {
                models: modelsFromOffers(board.offers),
                source: "arkiv",
                writer: board.writer,
              };
        return {
          content: [{ text: modelsText(result), type: "text" as const }],
          structuredContent: result,
        };
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
        "Pays the cheapest online seller from the user's agent wallet (USDC on Hedera testnet) and returns the exact prompt sent, the model's verbatim answer and the on-chain receipt. Show the user the prompt and the answer as returned, without commentary unless asked.",
      inputSchema: {
        ...requestShape,
        max_price_usdc: z
          .string()
          .optional()
          .describe('Refuse if the price is above this, e.g. "0.01"'),
        world_approval_id: worldApprovalId,
      },
      outputSchema: purchaseShape,
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
        const gate = await worldGate(ctx.world, {
          amountUsdc: formatUsdc(price),
          approvalId: input.world_approval_id,
          description: `${request.model}, up to ${request.maxTokens} tokens`,
          payTo: quote.terms.payTo,
          payer: signer.accountId,
          priceMicros: price,
          tool: "buy_inference",
        });
        if (!gate.pay) {
          return failure(gate.text);
        }
        const payment = await signPaymentAs(
          signer.accountId,
          NETWORK,
          signer.privateKeyHex,
          quote
        );
        const answer = await payAndCall(ctx.gatewayUrl, request, payment);
        const result = {
          answer: answer.content,
          max_tokens: request.maxTokens,
          model: request.model,
          payment: {
            amount_usdc: formatUsdc(price),
            from: signer.accountId,
            network: NETWORK,
            to: quote.terms.payTo,
            transaction: answer.tx,
            url: answer.tx === null ? null : hashscanTx(answer.tx),
          },
          prompt: request.messages.map((m) => ({
            content: m.content,
            role: m.role,
          })),
          seller_error: answer.error,
          tokens: { input: answer.inputTokens, output: answer.outputTokens },
          truncated:
            answer.outputTokens !== null &&
            answer.outputTokens >= request.maxTokens,
        };
        return {
          content: [{ text: purchaseText(result), type: "text" as const }],
          isError: answer.error !== null,
          structuredContent: result,
        };
      } catch (error) {
        return failure(`Not paid: ${explain(error)}`);
      }
    }
  );

  server.registerTool(
    "cancel_payment",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
        readOnlyHint: false,
      },
      description:
        "Drops a payment that buy_inference or generate_image held for World ID approval. Nothing is paid, and that approval can no longer be used, even if the person approves it afterwards.",
      inputSchema: {
        world_approval_id: z
          .string()
          .describe("The world_approval_id the held tool call returned"),
      },
      title: "Cancel payment",
    },
    async (input) => {
      if (ctx.world === null) {
        return failure("World ID approvals are not set up on this server.");
      }
      try {
        return text(await ctx.world.cancel(input.world_approval_id));
      } catch (error) {
        return failure(explain(error));
      }
    }
  );

  server.registerResource(
    "Image viewer",
    IMAGE_VIEWER_URI,
    {
      description: "Shows a generate_image result in the chat.",
      mimeType: MCP_APP_MIME_TYPE,
    },
    () => ({
      contents: [
        {
          mimeType: MCP_APP_MIME_TYPE,
          text: imageViewerHtml,
          uri: IMAGE_VIEWER_URI,
        },
      ],
    })
  );

  server.registerTool(
    "generate_image",
    {
      _meta: imageViewerToolMeta,
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
        readOnlyHint: false,
      },
      description:
        "Makes one image from a text prompt on a seller's own GPU, paying the cheapest online seller of the image model from the user's agent wallet (USDC on Hedera testnet). Returns the image and the on-chain receipt. Show the image and one payment line with the HashScan link.",
      inputSchema: {
        max_price_usdc: z
          .string()
          .optional()
          .describe('Refuse if the price is above this, e.g. "0.01"'),
        model: z
          .string()
          .optional()
          .describe(
            `An image model from list_models (kind "image"); default ${DEFAULT_IMAGE_MODEL}`
          ),
        prompt: z.string().min(1).max(2000).describe("What to draw"),
        size: z
          .enum(IMAGE_SIZES)
          .optional()
          .describe("Default 512x512, which keeps the reply small"),
        world_approval_id: worldApprovalId,
      },
      title: "Generate image",
    },
    async (input) => {
      try {
        const signer = await ctx.signer();
        if (signer === null) {
          return failure(
            `The user has no agent wallet yet. They can create one and add USDC at ${ctx.walletPage}`
          );
        }
        const request = {
          model: input.model ?? DEFAULT_IMAGE_MODEL,
          prompt: input.prompt,
          size: input.size ?? "512x512",
        };
        const quote = await requestImageQuote(ctx.gatewayUrl, NETWORK, request);
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
        const gate = await worldGate(ctx.world, {
          amountUsdc: formatUsdc(price),
          approvalId: input.world_approval_id,
          description: `${request.model} image, ${request.size}`,
          payTo: quote.terms.payTo,
          payer: signer.accountId,
          priceMicros: price,
          tool: "generate_image",
        });
        if (!gate.pay) {
          return failure(gate.text);
        }
        const payment = await signPaymentAs(
          signer.accountId,
          NETWORK,
          signer.privateKeyHex,
          quote
        );
        const image = await payForImage(ctx.gatewayUrl, request, payment);
        const paid = `PAYMENT\n${formatUsdc(price)} USDC from ${signer.accountId} to ${quote.terms.payTo} · ${txLine(NETWORK, image.tx)}`;
        const head = `MODEL ${request.model} · ${request.size}\nPROMPT\n${request.prompt}`;
        if (image.base64 === null) {
          return {
            content: [
              {
                text: `${head}\n\nThe seller failed after the payment settled: ${image.error}\n\n${paid}`,
                type: "text" as const,
              },
            ],
            isError: true,
          };
        }
        const caption: ImageCaption = {
          model: request.model,
          payment: {
            amount_usdc: formatUsdc(price),
            from: signer.accountId,
            to: quote.terms.payTo,
            transaction: image.tx,
            url: image.tx === null ? null : hashscanTx(image.tx),
          },
          prompt: request.prompt,
          size: request.size,
        };
        return {
          content: [
            {
              data: image.base64,
              mimeType: "image/png",
              type: "image" as const,
            },
            { text: `${head}\n\n${paid}`, type: "text" as const },
          ],
          structuredContent: { ...caption },
        };
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
