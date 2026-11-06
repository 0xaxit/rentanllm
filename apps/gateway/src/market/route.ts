/**
 * POST /v1/chat/completions and POST /v1/images/generations: the pay-per-request market.
 * No account, booking or API key:
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
import { PaymentRejected } from "../x402/payment-rejected.ts";
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
import { policyRefusal } from "./buyer-policy.ts";
import {
  IMAGE_OUTPUT_TOKENS,
  parseChatBody,
  parseImageBody,
  quotedInputTokens,
  quotePrice,
  withEnforcedCap,
} from "./quote.ts";
import type { ChatBody, ImageBody } from "./quote.ts";
import { SpendAudit } from "./spend-audit.ts";
import { MarketTerms } from "./terms.ts";

export const CHAT_COMPLETIONS_PATH = "/v1/chat/completions";
export const IMAGE_GENERATIONS_PATH = "/v1/images/generations";

/** One request the market prices, routes and forwards: a chat completion or an image. */
interface PricedRequest {
  /** What the 402's resource says the buyer is paying for. */
  readonly description: string;
  readonly dueMessage: string;
  readonly forwardBody: string;
  readonly kind: MarketOffer["kind"];
  /** The output cap the price covers, recorded with the purchase (tokens; for images, images x 1M). */
  readonly maxTokens: number;
  readonly model: string;
  readonly path: string;
  readonly price: (offer: MarketOffer) => Micros;
  readonly stream: boolean;
}

const chatRequest = (body: ChatBody): PricedRequest => {
  const inputTokens = quotedInputTokens(body.messages);
  return {
    description: `One ${body.model} chat completion of up to ${body.maxTokens} output tokens, paid to the seller.`,
    dueMessage: `This request covers your prompt plus up to ${body.maxTokens} output tokens.`,
    forwardBody: withEnforcedCap(body),
    kind: "chat",
    maxTokens: body.maxTokens,
    model: body.model,
    path: CHAT_COMPLETIONS_PATH,
    price: (offer) => quotePrice(offer.prices, inputTokens, body.maxTokens),
    stream: body.stream,
  };
};

const imageRequest = (body: ImageBody): PricedRequest => {
  const units = body.n * IMAGE_OUTPUT_TOKENS;
  const images = body.n === 1 ? "image" : "images";
  return {
    description: `${body.n} ${body.model} ${images} at ${body.size}, paid to the seller.`,
    dueMessage: `This request covers ${body.n} ${images} at ${body.size}.`,
    forwardBody: JSON.stringify(body.forward),
    kind: "image",
    maxTokens: units,
    model: body.model,
    path: IMAGE_GENERATIONS_PATH,
    price: (offer) => quotePrice(offer.prices, 0, units),
    stream: false,
  };
};

/** One seller's price for this request and how to pay it. */
interface Quote {
  readonly amountMicros: Micros;
  readonly offer: MarketOffer;
  readonly requirements: PaymentRequirements;
}

/** Buyers' budgets and per-seller limits cover this rolling window. */
const BUYER_WINDOW_MS = 24 * 60 * 60 * 1000;
const serves = (body: PricedRequest) => (offer: MarketOffer) =>
  offer.kind === body.kind && ALLOWED_PATHS[offer.provider].includes(body.path);

/** The cheapest online, payable sellers of the body's model, cheapest first. */
const quotesFor = (market: MarketSettings, body: PricedRequest) =>
  Effect.gen(function* quoteSellers() {
    const offers = (yield* (yield* MarketStore).offers(body.model)).filter(
      serves(body)
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
    const priced = online
      .map((offer) => ({ amountMicros: body.price(offer), offer }))
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
  body: PricedRequest,
  quotes: readonly Quote[],
  message: string
) =>
  new PaymentDue({
    message,
    x402: {
      accepts: quotes.map((quote) => quote.requirements),
      error: message,
      resource: {
        description: body.description,
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
  audit: SpendAudit["Service"],
  quote: Quote,
  body: PricedRequest,
  settled: Settlement,
  requestId: string
) =>
  Effect.fn("recordPaidRequest")(
    function* recordPaidRequest(finished: Finished) {
      const { offer, requirements } = quote;
      // Image servers name no model in their answer, so images keep the model paid for.
      const model =
        body.kind === "image"
          ? body.model
          : (finished.usage?.model ?? body.model);
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
        model,
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
          model,
          network: requirements.network,
          outputTokens: finished.usage?.outputTokens ?? 0,
          paid: quote.amountMicros,
          payTo: requirements.payTo,
          paymentTx: settled.transaction,
          requestId,
          status: finished.status,
        });
        yield* audit.record({
          amount: quote.amountMicros,
          asset: requirements.asset,
          at: finished.finishedAt,
          maxTokens: body.maxTokens,
          model,
          network: requirements.network,
          payTo: requirements.payTo,
          payer: settled.payer,
          requestId,
          status: finished.status,
          tx: settled.transaction,
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

const handleMarket = <E, R>(
  parse: (
    raw: string,
    market: MarketSettings
  ) => Effect.Effect<PricedRequest, E, R>
) =>
  Effect.gen(function* handleMarketRequest() {
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
      return yield* new InvalidRequest({
        message: "Request body is too large.",
      });
    }
    const body = yield* parse(raw, market);
    const quotes = yield* quotesFor(market, body);

    const header = extractPaymentHeader(request.headers);
    if (header === null) {
      return yield* paymentDue(market, body, quotes, body.dueMessage);
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

    const store = yield* MarketStore;
    const checkBuyer = (payer: string | null) =>
      Effect.gen(function* checkBuyerPolicy() {
        if (payer === null) {
          return;
        }
        const policy = yield* store.buyerPolicy(payer);
        if (policy === null) {
          return;
        }
        const since = new Date(Date.now() - BUYER_WINDOW_MS);
        const { payTo } = quote.requirements;
        const spend = yield* store.buyerSpend(payer, payTo, since);
        const refusal = policyRefusal(policy, spend, payTo, quote.amountMicros);
        if (refusal !== null) {
          return yield* new PaymentRejected({ reason: refusal });
        }
      });
    const settled = yield* settleAgainst(
      payload,
      quote.requirements,
      checkBuyer
    ).pipe(
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
      body: body.forwardBody,
      bookingId: offer.listingId,
      headers: forwardableRequestHeaders(request.headers),
      nodeId: offer.nodeId,
      path: body.path,
      provider: offer.provider,
      record: recordPaid(
        store,
        yield* ArkivMirror,
        yield* SpendAudit,
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
  });

export const handleChatCompletions = handleMarket((raw, market) =>
  parseChatBody(raw, market).pipe(Effect.map(chatRequest))
).pipe(Effect.withSpan("gateway.chat_completions"));

export const handleImageGenerations = handleMarket((raw, market) =>
  parseImageBody(raw, market).pipe(Effect.map(imageRequest))
).pipe(Effect.withSpan("gateway.image_generations"));
