import { describe, expect, it } from "vitest";

import { offerId, planOfferSync } from "../src/index";
import type { Offer } from "../src/index";

const offer = (listing: string, model: string): Offer => ({
  listing,
  model,
  network: "hedera:testnet",
  online: true,
  payTo: "0.0.4242",
  priceIn: 50_000n,
  priceOut: 200_000n,
  url: "https://gw.test/v1/chat/completions",
});

const published = (key: `0x${string}`, listing: string, model: string) => ({
  key,
  listing,
  model,
});

describe("planOfferSync", () => {
  it("creates new offers, refreshes existing ones and removes the rest", () => {
    const plan = planOfferSync(
      [published("0x01", "l1", "llama3.1:8b"), published("0x02", "l2", "qwen")],
      [offer("l1", "llama3.1:8b"), offer("l3", "mistral:7b")]
    );
    expect(plan.create.map(offerId)).toEqual(["l3:mistral:7b"]);
    expect(plan.refresh.map((r) => r.key)).toEqual(["0x01"]);
    expect(plan.remove).toEqual(["0x02"]);
  });

  it("deletes duplicates of one offer left by an interrupted sync", () => {
    const plan = planOfferSync(
      [published("0x01", "l1", "m"), published("0x02", "l1", "m")],
      [offer("l1", "m")]
    );
    expect(plan.refresh.map((r) => r.key)).toEqual(["0x01"]);
    expect(plan.remove).toEqual(["0x02"]);
    expect(plan.create).toEqual([]);
  });

  it("writes one entity per model even if a listing repeats one", () => {
    const plan = planOfferSync([], [offer("l1", "m"), offer("l1", "m")]);
    expect(plan.create).toHaveLength(1);
  });

  it("does nothing when nothing is for sale or published", () => {
    expect(planOfferSync([], [])).toEqual({
      create: [],
      refresh: [],
      remove: [],
    });
  });
});
