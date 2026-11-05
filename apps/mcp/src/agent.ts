/**
 * `rentanllm-mcp agent "<prompt>"`: an autonomous buyer. It finds a model on the market,
 * gets the price from the gateway's 402, checks the caps, pays from its own key and prints
 * the answer with the Hedera transaction. No person approves anything: the caps are the
 * only limit, so it needs RENTANLLM_MCP_APPROVAL=none and a key (see config.ts).
 *
 * Options: --model <id> (default: the model with the cheapest online seller),
 *          --max-tokens <n> (default 256), --max-price <usdc>.
 */
import { parseArgs } from "node:util";

import { buyInference } from "./buy.ts";
import { ConfigError, formatUsdc, usdcToMicros } from "./config.ts";
import type { McpConfig } from "./config.ts";
import {
  listModels,
  MarketError,
  payAndCall,
  requestQuote,
  txLine,
} from "./market.ts";
import type { ChatRequest, ModelListing } from "./market.ts";
import { approvedKey, signPayment } from "./payer.ts";
import { appendSpend, readSpends } from "./spend.ts";

const DEFAULT_MAX_TOKENS = 256;

const log = (line: string) => process.stdout.write(`${line}\n`);

/** Cheapest output price among models with at least one seller online. */
const pickModel = (models: readonly ModelListing[]): ModelListing | null => {
  const online = models.filter(
    (m) => m.sellers_online > 0 && m.cheapest_output_usdc_per_mtok !== null
  );
  const [cheapest] = online.toSorted(
    (a, b) =>
      Number(a.cheapest_output_usdc_per_mtok) -
      Number(b.cheapest_output_usdc_per_mtok)
  );
  return cheapest ?? null;
};

const chooseModel = async (
  config: McpConfig,
  wanted: string | undefined
): Promise<string> => {
  const models = await listModels(config.gatewayUrl);
  log(
    `market: ${models.map((m) => `${m.id} (${m.sellers_online}/${m.sellers} online, out $${m.cheapest_output_usdc_per_mtok ?? "-"}/M)`).join(", ") || "nothing for sale"}`
  );
  if (wanted !== undefined) {
    if (!models.some((m) => m.id === wanted && m.sellers_online > 0)) {
      throw new MarketError(`no seller of ${wanted} is online`);
    }
    return wanted;
  }
  const picked = pickModel(models);
  if (picked === null) {
    throw new MarketError("no model has a seller online");
  }
  return picked.id;
};

export const runAgent = async (
  config: McpConfig,
  argv: readonly string[]
): Promise<void> => {
  if (config.approval !== "none") {
    throw new ConfigError(
      "the autonomous agent pays without a person: set RENTANLLM_MCP_APPROVAL=none and RENTANLLM_MCP_KEY_FILE"
    );
  }
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    args: [...argv],
    options: {
      "max-price": { type: "string" },
      "max-tokens": { type: "string" },
      model: { type: "string" },
    },
  });
  const prompt = positionals.join(" ").trim();
  if (prompt.length === 0) {
    throw new ConfigError(
      'usage: rentanllm-mcp agent [--model id] [--max-tokens n] [--max-price usdc] "<prompt>"'
    );
  }
  log(
    `gateway: ${config.gatewayUrl}  payer: ${config.account}  caps: ${formatUsdc(config.maxPerRequestMicros)} per request, ${formatUsdc(config.maxPerDayMicros)} per 24h`
  );
  const model = await chooseModel(config, values.model);
  const request: ChatRequest = {
    maxTokens: Number(values["max-tokens"] ?? DEFAULT_MAX_TOKENS),
    messages: [{ content: prompt, role: "user" }],
    model,
  };
  const result = await buyInference(
    {
      approve: (reason) => {
        log(`auto-approved (inside caps): ${reason}`);
        return approvedKey(config, reason);
      },
      call: (payment) => payAndCall(config.gatewayUrl, request, payment),
      caps: config,
      log: (entry) => appendSpend(config.stateDir, entry),
      now: () => new Date(),
      quote: async () => {
        const quote = await requestQuote(
          config.gatewayUrl,
          config.network,
          request
        );
        log(
          `402 quote: ${formatUsdc(BigInt(quote.terms.amount))} USDC to ${quote.terms.payTo} on ${quote.terms.network} (asset ${quote.terms.asset})`
        );
        return quote;
      },
      sign: (key, quote) => signPayment(config, key, quote),
      spends: () => readSpends(config.stateDir),
    },
    request,
    values["max-price"] === undefined ? null : usdcToMicros(values["max-price"])
  );
  if (result.kind === "refused") {
    throw new MarketError(`not paid: ${result.reason}`);
  }
  const { answer } = result;
  log(`paid ${formatUsdc(result.paidMicros)} USDC to ${result.payTo}`);
  log(txLine(config.network, answer.tx));
  if (answer.error !== null) {
    throw new MarketError(`paid, but the seller failed: ${answer.error}`);
  }
  log(
    `tokens: ${answer.inputTokens ?? "?"} in, ${answer.outputTokens ?? "?"} out  request: ${answer.requestId ?? "-"}`
  );
  log(`\n${answer.content}`);
};
