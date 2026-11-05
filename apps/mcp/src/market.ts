/**
 * The gateway's market API as the MCP server uses it: what is for sale, what a request
 * would cost (the 402 the gateway answers an unpaid request with), and the paid call.
 */
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";
import type {
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
} from "@x402/core/types";

import type { PayNetwork } from "./config.ts";

export interface ChatMessage {
  readonly content: string;
  readonly role: "system" | "user" | "assistant";
}

export interface ChatRequest {
  readonly maxTokens: number;
  readonly messages: readonly ChatMessage[];
  readonly model: string;
}

export interface ModelListing {
  readonly cheapest_input_usdc_per_mtok: string | null;
  readonly cheapest_output_usdc_per_mtok: string | null;
  readonly id: string;
  readonly sellers: number;
  readonly sellers_online: number;
}

/** What the gateway asked for, narrowed to the terms payable on our network. */
export interface Quote {
  readonly paymentRequired: PaymentRequired;
  /** The cheapest terms on our network. */
  readonly terms: PaymentRequirements;
}

export interface PaidAnswer {
  readonly content: string;
  /** Set when the payment settled but the seller failed to answer. */
  readonly error: string | null;
  readonly inputTokens: number | null;
  readonly listingId: string | null;
  readonly outputTokens: number | null;
  readonly requestId: string | null;
  /** Settlement transaction (Hedera transaction id). */
  readonly tx: string | null;
}

const TX_URL: Readonly<Record<string, (tx: string) => string>> = {
  "hedera:testnet": (tx) =>
    `https://hashscan.io/testnet/transaction/${encodeURIComponent(tx)}`,
};

/** "payment tx: <id> (<HashScan link>)" for a receipt. */
export const txLine = (network: string, tx: string | null): string => {
  if (tx === null) {
    return "payment: settled (no transaction id returned)";
  }
  const url = TX_URL[network]?.(tx);
  return url === undefined ? `payment tx: ${tx}` : `payment tx: ${tx} (${url})`;
};

export class MarketError extends Error {
  override readonly name = "MarketError";
}

const chatBody = (request: ChatRequest) =>
  JSON.stringify({
    max_tokens: request.maxTokens,
    messages: request.messages,
    model: request.model,
    stream: false,
  });

/** The `error.message` of a gateway error body, or the HTTP status. */
const errorMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    if (typeof body.error?.message === "string") {
      return body.error.message;
    }
  } catch {
    // Not JSON: fall through to the status.
  }
  return `the gateway answered HTTP ${response.status}`;
};

export const listModels = async (
  gatewayUrl: string
): Promise<readonly ModelListing[]> => {
  const response = await fetch(`${gatewayUrl}/v1/models`);
  if (!response.ok) {
    throw new MarketError(await errorMessage(response));
  }
  const body = (await response.json()) as { data: ModelListing[] };
  return body.data;
};

/** Asks for the price: an unpaid request, which the gateway answers with a 402. */
export const requestQuote = async (
  gatewayUrl: string,
  network: PayNetwork,
  request: ChatRequest
): Promise<Quote> => {
  const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
    body: chatBody(request),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (response.status !== 402) {
    throw new MarketError(await errorMessage(response));
  }
  const header = response.headers.get("payment-required");
  if (header === null) {
    throw new MarketError("the gateway's 402 carried no payment terms");
  }
  const paymentRequired = decodePaymentRequiredHeader(header);
  const payable = paymentRequired.accepts
    .filter((terms) => terms.network === network)
    .toSorted((a, b) => (BigInt(a.amount) < BigInt(b.amount) ? -1 : 1));
  const [terms] = payable;
  if (terms === undefined) {
    throw new MarketError(
      `no seller of ${request.model} can be paid on ${network} right now`
    );
  }
  return { paymentRequired, terms };
};

interface ChatCompletion {
  readonly choices?: readonly {
    readonly message?: { readonly content?: unknown };
  }[];
  readonly usage?: {
    readonly completion_tokens?: unknown;
    readonly prompt_tokens?: unknown;
  };
}

const int = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null;

/** Sends the request again with the signed payment and reads the answer. */
export const payAndCall = async (
  gatewayUrl: string,
  request: ChatRequest,
  payment: PaymentPayload
): Promise<PaidAnswer> => {
  const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
    body: chatBody(request),
    headers: {
      "content-type": "application/json",
      "payment-signature": encodePaymentSignatureHeader(payment),
    },
    method: "POST",
  });
  const receipt = response.headers.get("payment-response");
  const tx =
    receipt === null ? null : decodePaymentResponseHeader(receipt).transaction;
  const requestId = response.headers.get("x-rentanllm-request-id");
  const listingId = response.headers.get("x-rentanllm-listing");
  if (!response.ok) {
    const message = await errorMessage(response);
    // No receipt: the gateway refused before taking the money.
    if (receipt === null) {
      throw new MarketError(message);
    }
    return {
      content: "",
      error: message,
      inputTokens: null,
      listingId,
      outputTokens: null,
      requestId,
      tx,
    };
  }
  const completion = (await response.json()) as ChatCompletion;
  const content = completion.choices?.[0]?.message?.content;
  return {
    content: typeof content === "string" ? content : "",
    error: null,
    inputTokens: int(completion.usage?.prompt_tokens),
    listingId,
    outputTokens: int(completion.usage?.completion_tokens),
    requestId,
    tx,
  };
};
