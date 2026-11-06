/**
 * The MCP tools. Reads (what is for sale, what a request would cost, what has been spent)
 * are marked read-only. `buy_inference` and `approve_payment` move money and are writes.
 * Who approves a payment depends on the approval mode: Touch ID for every payment, the
 * person above a threshold (approval.ts), or nobody inside the caps.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { confirmMessage, HeldPayments, needsPerson } from "./approval.ts";
import { buyInference } from "./buy.ts";
import { formatUsdc, usdcToMicros } from "./config.ts";
import type { McpConfig } from "./config.ts";
import {
  listModels,
  MarketError,
  payAndCall,
  requestQuote,
  txLine,
} from "./market.ts";
import type { ChatMessage, ChatRequest, Quote } from "./market.ts";
import { approvedKey, PayerError, signPayment } from "./payer.ts";
import { PaymentHeldError } from "./payment-held-error.ts";
import { appendSpend, readSpends, spentLastDay } from "./spend.ts";

const DEFAULT_MAX_TOKENS = 512;
const MAX_TOKENS_LIMIT = 32_768;
const RECENT_SPENDS = 10;

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

interface RequestInput {
  readonly max_tokens?: number | undefined;
  readonly model: string;
  readonly prompt: string;
  readonly system?: string | undefined;
}

const toRequest = (input: RequestInput): ChatRequest => {
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

const explain = (error: unknown): string => {
  if (error instanceof MarketError || error instanceof PayerError) {
    return error.message;
  }
  return `unexpected failure: ${String(error)}`;
};

type Approve = (reason: string, quote: Quote) => Promise<string>;

/** Runs one purchase and turns the outcome into a tool result. */
const purchase = async (
  config: McpConfig,
  request: ChatRequest,
  maxPriceMicros: bigint | null,
  approve: Approve
) => {
  try {
    const result = await buyInference(
      {
        approve,
        call: (payment) => payAndCall(config.gatewayUrl, request, payment),
        caps: config,
        log: (entry) => appendSpend(config.stateDir, entry),
        now: () => new Date(),
        quote: () => requestQuote(config.gatewayUrl, config.network, request),
        sign: (key, quote) => signPayment(config, key, quote),
        spends: () => readSpends(config.stateDir),
      },
      request,
      maxPriceMicros
    );
    if (result.kind === "refused") {
      return failure(`Not paid: ${result.reason}.`);
    }
    const { answer } = result;
    const receipt = [
      `paid ${formatUsdc(result.paidMicros)} USDC to ${result.payTo}`,
      txLine(config.network, answer.tx),
      `spent in the last 24h: ${formatUsdc(result.spentTodayMicros)} of ${formatUsdc(config.maxPerDayMicros)} USDC`,
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
    if (error instanceof PaymentHeldError) {
      const { held } = error;
      return text(
        [
          `Not paid yet: ${formatUsdc(held.amountMicros)} USDC is above the ${formatUsdc(config.autoApproveMicros)} USDC this agent may pay on its own, so the person has to approve it.`,
          `Call approve_payment with payment_id "${held.id}", amount_usdc "${formatUsdc(held.amountMicros)}" and pay_to "${held.payTo}". The person confirms it in the approval dialog. The hold expires at ${held.expiresAt.toISOString()}.`,
        ].join("\n")
      );
    }
    if (error instanceof PayerError && error.kind === "not_approved") {
      return failure(
        "Not paid: the person did not approve the payment. Ask them before trying again."
      );
    }
    return failure(explain(error));
  }
};

const approvalLine = (config: McpConfig): string => {
  if (config.approval === "touchid") {
    return "approval: Touch ID for every payment";
  }
  if (config.approval === "threshold") {
    return `approval: automatic up to ${formatUsdc(config.autoApproveMicros)} USDC, the person approves anything above`;
  }
  return "approval: none, the caps are the only limit";
};

export const registerTools = (server: McpServer, config: McpConfig): void => {
  const held = new HeldPayments();

  /**
   * Asks the person in the client's own dialog (MCP elicitation). "unsupported" when the
   * client cannot show one; then the payment is held for approve_payment instead.
   */
  const askPerson = async (
    message: string
  ): Promise<"approved" | "declined" | "unsupported"> => {
    if (server.server.getClientCapabilities()?.elicitation === undefined) {
      return "unsupported";
    }
    const answer = await server.server.elicitInput({
      message,
      requestedSchema: {
        properties: {
          confirm: {
            description: "Tick to pay this amount to this seller",
            title: "Pay",
            type: "boolean",
          },
        },
        required: ["confirm"],
        type: "object",
      },
    });
    return answer.action === "accept" && answer.content?.confirm === true
      ? "approved"
      : "declined";
  };
  server.registerTool(
    "list_models",
    {
      annotations: { openWorldHint: true, readOnlyHint: true },
      description:
        "List the open models for sale on the RentAnLLM market right now, with how many sellers are online and the cheapest prices (USDC per million tokens).",
      title: "List models for sale",
    },
    async () => {
      try {
        const models = await listModels(config.gatewayUrl);
        if (models.length === 0) {
          return text("Nothing is for sale on the market right now.");
        }
        return text(
          models
            .map((m) =>
              m.sellers_online === 0
                ? `${m.id}: ${m.sellers} seller(s), none online`
                : `${m.id}: ${m.sellers_online} of ${m.sellers} seller(s) online, from ${m.cheapest_input_usdc_per_mtok} in / ${m.cheapest_output_usdc_per_mtok} out USDC per million tokens`
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
        "Get the price of one inference request without paying: the prompt plus the full max_tokens at the cheapest online seller's rates, and who would be paid.",
      inputSchema: requestShape,
      title: "Quote an inference request",
    },
    async (input) => {
      try {
        const quote = await requestQuote(
          config.gatewayUrl,
          config.network,
          toRequest(input)
        );
        return text(
          `${formatUsdc(BigInt(quote.terms.amount))} USDC to ${quote.terms.payTo} on ${quote.terms.network} for up to ${input.max_tokens ?? DEFAULT_MAX_TOKENS} output tokens of ${input.model}. Caps: ${formatUsdc(config.maxPerRequestMicros)} USDC per request, ${formatUsdc(config.maxPerDayMicros)} USDC per day.`
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
        "Pay for and run one inference request on the RentAnLLM market. The price is paid in USDC straight to the seller, within this server's per-request and daily caps. Depending on the setup, small payments go through on their own and larger ones need the person's approval (in a dialog, or by calling approve_payment with what this tool returns). Returns the answer and the payment receipt.",
      inputSchema: {
        ...requestShape,
        max_price_usdc: z
          .string()
          .optional()
          .describe(
            'Refuse to pay more than this for the request, e.g. "0.01"'
          ),
      },
      title: "Buy inference",
    },
    async (input) => {
      const request = toRequest(input);
      return await purchase(
        config,
        request,
        input.max_price_usdc === undefined
          ? null
          : usdcToMicros(input.max_price_usdc),
        async (reason, quote) => {
          if (needsPerson(config, BigInt(quote.terms.amount))) {
            const answer = await askPerson(confirmMessage(quote, request));
            if (answer === "declined") {
              throw new PayerError(
                "not_approved",
                "the person declined the payment"
              );
            }
            if (answer === "unsupported") {
              throw new PaymentHeldError(held.hold(request, quote));
            }
          }
          return await approvedKey(config, reason);
        }
      );
    }
  );

  server.registerTool(
    "approve_payment",
    {
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
        readOnlyHint: false,
      },
      description:
        "Pay a request that buy_inference held because it costs more than this agent may pay on its own. Only call it with the payment_id, amount_usdc and pay_to that buy_inference returned. The person confirms the payment in the approval dialog before it runs, and the price may not have gone up since.",
      inputSchema: {
        amount_usdc: z
          .string()
          .describe(
            'The held amount, exactly as buy_inference gave it, e.g. "0.0123"'
          ),
        pay_to: z
          .string()
          .describe("The seller's Hedera account the payment goes to (0.0.x)"),
        payment_id: z
          .string()
          .describe("The id buy_inference returned (pay_...)"),
      },
      title: "Approve a payment",
    },
    async (input) => {
      const taken = held.take(
        input.payment_id,
        usdcToMicros(input.amount_usdc),
        input.pay_to
      );
      if (typeof taken === "string") {
        return failure(`Not paid: ${taken}.`);
      }
      return await purchase(
        config,
        taken.request,
        taken.amountMicros,
        async (reason, quote) => {
          if (quote.terms.payTo !== taken.payTo) {
            throw new MarketError(
              `the seller changed from ${taken.payTo} to ${quote.terms.payTo}; ask buy_inference for a new price`
            );
          }
          return await approvedKey(config, reason);
        }
      );
    }
  );

  server.registerTool(
    "spending",
    {
      annotations: { readOnlyHint: true },
      description:
        "Show what this agent has spent on inference in the last 24 hours, the caps, and the latest payments with their on-chain links.",
      title: "Spending",
    },
    () => {
      const spends = readSpends(config.stateDir);
      const spent = spentLastDay(spends, new Date());
      const recent = spends
        .slice(-RECENT_SPENDS)
        .toReversed()
        .map(
          (s) =>
            `${s.at.toISOString()} ${formatUsdc(s.amountMicros)} USDC to ${s.payTo} for ${s.model}; ${txLine(s.network, s.tx)}`
        );
      return text(
        [
          `spent in the last 24h: ${formatUsdc(spent)} of ${formatUsdc(config.maxPerDayMicros)} USDC`,
          `per-request cap: ${formatUsdc(config.maxPerRequestMicros)} USDC`,
          approvalLine(config),
          ...(recent.length === 0 ? ["no payments yet"] : recent),
        ].join("\n")
      );
    }
  );
};
