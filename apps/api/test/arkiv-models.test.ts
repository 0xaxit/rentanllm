import type { PublishedOffer } from "@rentanllm/arkiv";
import { describe, expect, it } from "vitest";

import { modelsFromOffers, modelsText } from "../src/mcp/arkiv-models";

const offer = (
  key: string,
  model: string,
  online: boolean,
  priceIn: bigint,
  priceOut: bigint
): PublishedOffer => ({
  key: key as `0x${string}`,
  listing: `listing-${key}`,
  model,
  network: "hedera:testnet",
  online,
  payTo: `0.0.${key.length}`,
  priceIn,
  priceOut,
  url: "https://gw.test/v1/chat/completions",
});

describe("list_models from Arkiv", () => {
  it("groups by model, online and cheapest first", () => {
    const rows = modelsFromOffers([
      offer("0xa", "llama3.1:8b", true, 50_000n, 300_000n),
      offer("0xb", "llama3.1:8b", true, 40_000n, 200_000n),
      offer("0xc", "llama3.1:8b", false, 10_000n, 10_000n),
      offer("0xd", "qwen3:4b", false, 20_000n, 90_000n),
    ]);
    expect(rows.map((r) => [r.model, r.sellers, r.sellers_online])).toEqual([
      ["llama3.1:8b", 3, 2],
      ["qwen3:4b", 1, 0],
    ]);
    const [llama, qwen] = rows;
    // The offline seller is cheaper but cannot be paid now.
    expect(llama?.cheapest_output_usdc_per_mtok).toBe("0.2");
    expect(llama?.offers.map((o) => o.entity)).toEqual(["0xb", "0xa", "0xc"]);
    expect(qwen?.cheapest_input_usdc_per_mtok).toBeNull();
  });

  it("says where the list came from", () => {
    const text = modelsText({
      models: modelsFromOffers([
        offer("0xb", "llama3.1:8b", true, 50_000n, 200_000n),
      ]),
      source: "arkiv",
      writer: "0x7A67",
    });
    expect(text).toContain("Read from the public Arkiv board");
    expect(text).toContain("https://rabdi.explorer.arkiv.network/entity/0xb");
    expect(
      modelsText({ models: [], source: "gateway", writer: null })
    ).toContain("Arkiv did not answer");
  });
});
