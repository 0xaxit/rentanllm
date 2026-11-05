/**
 * POST /v1/chat/completions: the pay-per-request market. No account, booking or API key:
 *
 *   body (400) -> model sold? (404) -> a seller online and payable? (503)
 *   -> no payment yet: 402 with the cheapest online sellers' terms
 *   -> payment matches one of those terms? (402) -> seller has a free slot? (429)
 *   -> settle (402 if refused) -> forward to that seller's node, stream back
 *
 * The price covers the prompt (estimated) plus the full max_tokens, which is enforced on
 * the forwarded request, and is paid straight to the seller's wallet. Nothing is charged
 * until a request has been admitted and a slot is held. A request that fails after the
 * payment settled is still recorded, with what it used, and its error response carries
 * the payment receipt.
 */
import { randomUUID } from "node:crypto";

import { formatUsdc } from "@rentanllm/core";
import type { Micros } from "@rentanllm/core";
import { ALLOWED_PATHS } from "@rentanllm/protocol";
import { encodePaymentResponseHeader } from "@x402/core/http";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";

import { Settings } from "../config.ts";
import type { MarketSettings } from "../config.ts";
import type { MarketOffer } from "../domain.ts";
import {
  InvalidRequest,
  NodeUnavailable,
  NotFound,
  PaymentDue,
  RateLimited,
  toErrorResponse,
} from "../errors.ts";
import { extractPaymentHeader, forwardableRequestHeaders } from "../headers.ts";
import { proxyToNode } from "../proxy.ts";
import type { Finished } from "../proxy.ts";
import { MarketStore } from "../services/market-store.ts";
import { RateLimiter } from "../services/rate-limiter.ts";
import { TunnelHub } from "../tunnel/tunnel-hub.ts";
import { mismatch, X402_VERSION } from "../x402/requirements.ts";
import { decodePaymentHeader, settleAgainst } from "../x402/settle.ts";
import type { Settlement } from "../x402/settle.ts";
import {
  costOf,
  countFinished,
  readBody,
  warnOnTokenMismatch,
} from "./accounting.ts";
import { ArkivMirror } from "./arkiv-mirror.ts";
import {
  parseChatBody,
  quotedInputTokens,
  quotePrice,
  withEnforcedCap,
} from "./quote.ts";
import type { ChatBody } from "./quote.ts";
import { MarketTerms } from "./terms.ts";

export const CHAT_COMPLETIONS_PATH = "/v1/chat/completions";

/** One seller's price for this request and how to pay it. */
interface Quote {
  readonly amountMicros: Micros;
  readonly offer: MarketOffer;
  readonly requirements: PaymentRequirements;
}

const servesChat = (offer: MarketOffer) =>
  ALLOWED_PATHS[offer.provider].includes(CHAT_COMPLETIONS_PATH);

/** The cheapest online, payable sellers of the body's model, cheapest first. */
const quotesFor = (market: MarketSettings, body: ChatBody) =>
  Effect.gen(function* quoteSellers() {
    const offers = (yield* (yield* MarketStore).offers(body.model)).filter(
      servesChat
    );
    if (offers.length === 0) {
      return yield* new NotFound({
        message: `Nothing on the market sells ${body.model}. GET /v1/models lists what is for sale.`,
      });
    }
    const hub = yield* TunnelHub;
    const online: MarketOffer[] = [];
    for (const offer of offers) {
      if (yield* hub.isOnline(offer.nodeId, offer.provider)) {
        online.push(offer);
      }
    }
    if (online.length === 0) {
      return yield* new NodeUnavailable({
        message: `No seller of ${body.model} is online right now. Try again later.`,
      });
    }
    const inputTokens = quotedInputTokens(body.messages);
    const priced = online
      .map((offer) => ({
        amountMicros: quotePrice(offer.prices, inputTokens, body.maxTokens),
        offer,
      }))
      .toSorted((a, b) => (a.amountMicros < b.amountMicros ? -1 : 1))
      .slice(0, market.maxQuotedOffers);
    const terms = yield* MarketTerms;
    const quotes: Quote[] = [];
    for (const { amountMicros, offer } of priced) {
      const requirements = yield* terms.requirementsFor(offer, amountMicros);
      if (requirements !== null) {
        quotes.push({ amountMicros, offer, requirements });
      }
    }
    if (quotes.length === 0) {
      return yield* new NodeUnavailable({
        message: `No online seller of ${body.model} can be paid on ${market.chain.name} right now.`,
      });
    }
    return quotes;
  });

const paymentDue = (
  market: MarketSettings,
  body: ChatBody,
  quotes: readonly Quote[],
  message: string
) =>
  new PaymentDue({
    message,
    x402: {
      accepts: quotes.map((quote) => quote.requirements),
      error: message,
      resource: {
        description: `One ${body.model} chat completion of up to ${body.maxTokens} output tokens, paid to the seller.`,
        mimeType: "application/json",
        url: market.resourceUrl,
      },
      x402Version: X402_VERSION,
    },
  });

/** The quote the payment was made against, or why it matches none of them. */
const matchQuote = (
  payload: PaymentPayload,
  quotes: readonly Quote[]
): Quote | string => {
  const quote = quotes.find((q) => mismatch(payload, q.requirements) === null);
  if (quote !== undefined) {
    return quote;
  }
  const [cheapest] = quotes;
  const reason =
    cheapest === undefined ? null : mismatch(payload, cheapest.requirements);
  return `it does not match any current offer (${reason ?? "no offers"}); the price may have changed, so pay the new terms`;
};

const recordPaid = (
  store: MarketStore["Service"],
  mirror: ArkivMirror["Service"],
  quote: Quote,
  body: ChatBody,
  settled: Settlement,
  requestId: string
) =>
  Effect.fn("recordPaidRequest")(
    function* recordPaidRequest(finished: Finished) {
      const { offer, requirements } = quote;
      const used = costOf(
        offer.prices,
        finished.usage,
        finished.status,
        finished.estimate
      );
      yield* warnOnTokenMismatch(finished);
      const recorded = yield* store.recordPaid({
        finishedAt: finished.finishedAt,
        httpStatus: finished.httpStatus,
        latencyMs: finished.totalLatencyMs,
        listingId: offer.listingId,
        maxTokens: body.maxTokens,
        model: finished.usage?.model ?? body.model,
        network: requirements.network,
        nodeId: offer.nodeId,
        ownerId: offer.ownerId,
        paidMicros: quote.amountMicros,
        payTo: requirements.payTo,
        payer: settled.payer,
        paymentTx: settled.transaction,
        prices: offer.prices,
        requestId,
        status: finished.status,
        ttfbMs: finished.ttfbMs,
        usage: finished.usage,
        usedMicros: used,
      });
      if (recorded) {
        yield* countFinished(finished, quote.amountMicros);
        yield* mirror.receipt({
          at: finished.finishedAt,
          inputTokens: finished.usage?.inputTokens ?? 0,
          listing: offer.listingId,
          model: finished.usage?.model ?? body.model,
          network: requirements.network,
          outputTokens: finished.usage?.outputTokens ?? 0,
          paid: quote.amountMicros,
          payTo: requirements.payTo,
          paymentTx: settled.transaction,
          requestId,
          status: finished.status,
        });
      }
      yield* Effect.logInfo("paid request finished").pipe(
        Effect.annotateLogs({
          httpStatus: finished.httpStatus,
          paidMicros: quote.amountMicros.toString(),
          status: finished.status,
          tx: settled.transaction,
          usedMicros: used.toString(),
        })
      );
    },
    Effect.catchTag("StoreError", (cause) =>
      Effect.logError("failed to record paid request", cause)
    )
  );

export const handleChatCompletions = Effect.gen(function* handleChat() {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const settings = yield* Settings;
  const { market } = settings;
  if (market === null) {
    return yield* new NotFound({
      message: "The pay-per-request market is not enabled on this gateway.",
    });
  }

  const raw = yield* readBody(request);
  if (Buffer.byteLength(raw, "utf-8") > settings.maxBodyBytes) {
    return yield* new InvalidRequest({ message: "Request body is too large." });
  }
  const body = yield* parseChatBody(raw, market);
  const quotes = yield* quotesFor(market, body);

  const header = extractPaymentHeader(request.headers);
  if (header === null) {
    return yield* paymentDue(
      market,
      body,
      quotes,
      `This request covers your prompt plus up to ${body.maxTokens} output tokens.`
    );
  }
  const refuse = (reason: string) =>
    paymentDue(market, body, quotes, `Payment not accepted: ${reason}.`);
  const payload = yield* decodePaymentHeader(header).pipe(
    Effect.catchTag("PaymentRejected", (rejected) =>
      Effect.fail(refuse(rejected.reason))
    )
  );
  const quote = matchQuote(payload, quotes);
  if (typeof quote === "string") {
    return yield* refuse(quote);
  }
  const { offer } = quote;

  // Hold the seller's slot before taking the money, so a busy seller costs nothing.
  const acquired = yield* (yield* RateLimiter).acquireSlot(
    `listing:${offer.listingId}`,
    offer.maxConcurrency
  );
  if (!acquired) {
    return yield* new RateLimited({
      message: `The seller is serving its limit of ${offer.maxConcurrency} requests at once. Retry shortly; nothing was charged.`,
      resetAt: null,
      retryAfterMs: null,
    });
  }

  const settled = yield* settleAgainst(payload, quote.requirements).pipe(
    Effect.catchTag("PaymentRejected", (rejected) =>
      Effect.fail(refuse(rejected.reason))
    )
  );
  const requestId = `req_${randomUUID().replaceAll("-", "")}`;
  yield* Effect.annotateCurrentSpan({
    listingId: offer.listingId,
    requestId,
    tx: settled.transaction,
  });

  const receipt = {
    "payment-response": encodePaymentResponseHeader(settled.settle),
    "x-rentanllm-listing": offer.listingId,
    "x-rentanllm-paid-usdc": formatUsdc(quote.amountMicros),
    "x-rentanllm-request-id": requestId,
  };
  return yield* proxyToNode({
    body: withEnforcedCap(body),
    bookingId: offer.listingId,
    headers: forwardableRequestHeaders(request.headers),
    nodeId: offer.nodeId,
    path: CHAT_COMPLETIONS_PATH,
    provider: offer.provider,
    record: recordPaid(
      yield* MarketStore,
      yield* ArkivMirror,
      quote,
      body,
      settled,
      requestId
    ),
    requestId,
    responseHeaders: receipt,
    stream: body.stream,
  }).pipe(
    // The payment has settled: a node failure still carries its receipt, so the buyer
    // knows it paid and can count it.
    Effect.catchTag("UpstreamFailed", (failure) =>
      Effect.succeed(
        HttpServerResponse.setHeaders(toErrorResponse(failure), receipt)
      )
    )
  );
}).pipe(Effect.withSpan("gateway.chat_completions"));
