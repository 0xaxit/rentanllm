/**
 * list_models from the public Arkiv board: the gateway's `rentanllm.offer` entities, read
 * straight from Arkiv (Rabdi) and grouped by model. Only entities owned by the gateway's
 * writer count; anyone can write entities under the same schema name.
 */
import { entityUrl } from "@rentanllm/arkiv";
import type { PublishedOffer } from "@rentanllm/arkiv";
import { formatUsdc } from "@rentanllm/mcp/remote";
import { z } from "zod";

export const arkivModelsShape = {
  models: z.array(
    z.object({
      cheapest_input_usdc_per_mtok: z
        .string()
        .nullable()
        .describe("Cheapest online seller; null when none is online"),
      cheapest_output_usdc_per_mtok: z.string().nullable(),
      model: z.string(),
      offers: z.array(
        z.object({
          entity: z.string().describe("Arkiv entity key"),
          explorer_url: z.string(),
          input_usdc_per_mtok: z.string(),
          network: z.string(),
          online: z.boolean(),
          output_usdc_per_mtok: z.string(),
          pay_to: z.string(),
        })
      ),
      sellers: z.number().int(),
      sellers_online: z.number().int(),
    })
  ),
  source: z
    .enum(["arkiv", "gateway"])
    .describe(
      "arkiv: read from the public Arkiv board; gateway: Arkiv was unreachable"
    ),
  writer: z
    .string()
    .nullable()
    .describe("The wallet whose Arkiv entities were trusted"),
};

export type ArkivModels = z.infer<z.ZodObject<typeof arkivModelsShape>>;
type ModelRow = ArkivModels["models"][number];

const byPrice = (a: PublishedOffer, b: PublishedOffer) => {
  if (a.priceOut !== b.priceOut) {
    return a.priceOut < b.priceOut ? -1 : 1;
  }
  return a.priceIn < b.priceIn ? -1 : 1;
};

/** Offers grouped by model, online sellers first, cheapest first. */
export const modelsFromOffers = (
  offers: readonly PublishedOffer[]
): ModelRow[] => {
  const groups = new Map<string, PublishedOffer[]>();
  for (const offer of offers) {
    groups.set(offer.model, [...(groups.get(offer.model) ?? []), offer]);
  }
  const rows: ModelRow[] = [];
  for (const [model, list] of groups) {
    const sorted = list.toSorted(
      (a, b) => Number(b.online) - Number(a.online) || byPrice(a, b)
    );
    const cheapest = sorted.find((o) => o.online);
    rows.push({
      cheapest_input_usdc_per_mtok:
        cheapest === undefined ? null : formatUsdc(cheapest.priceIn),
      cheapest_output_usdc_per_mtok:
        cheapest === undefined ? null : formatUsdc(cheapest.priceOut),
      model,
      offers: sorted.map((o) => ({
        entity: o.key,
        explorer_url: entityUrl(o.key),
        input_usdc_per_mtok: formatUsdc(o.priceIn),
        network: o.network,
        online: o.online,
        output_usdc_per_mtok: formatUsdc(o.priceOut),
        pay_to: o.payTo,
      })),
      sellers: list.length,
      sellers_online: list.filter((o) => o.online).length,
    });
  }
  return rows.toSorted(
    (a, b) =>
      b.sellers_online - a.sellers_online || a.model.localeCompare(b.model)
  );
};

/** The same, as text for clients that read only text. */
export const modelsText = (result: ArkivModels): string => {
  const head =
    result.source === "arkiv"
      ? `Read from the public Arkiv board (Rabdi testnet), entities written by ${result.writer}. Not from RentAnLLM's API.`
      : "Arkiv did not answer, so this list comes from the RentAnLLM gateway.";
  if (result.models.length === 0) {
    return `${head}\n\nNothing is for sale right now.`;
  }
  const lines = [head, ""];
  for (const m of result.models) {
    const price =
      m.cheapest_input_usdc_per_mtok === null
        ? "no seller online"
        : `cheapest online: ${m.cheapest_input_usdc_per_mtok} in / ${m.cheapest_output_usdc_per_mtok} out USDC per M tokens`;
    lines.push(
      `${m.model}: ${m.sellers_online} of ${m.sellers} sellers online, ${price}`
    );
    for (const o of m.offers) {
      lines.push(
        `  ${o.online ? "online " : "offline"} ${o.input_usdc_per_mtok} / ${o.output_usdc_per_mtok} · pays ${o.pay_to} · ${o.explorer_url}`
      );
    }
  }
  return lines.join("\n");
};
