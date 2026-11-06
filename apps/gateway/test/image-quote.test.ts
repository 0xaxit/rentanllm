import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import {
  IMAGE_OUTPUT_TOKENS,
  parseImageBody,
  quotePrice,
} from "../src/market/quote.ts";

const limits = { defaultMaxTokens: 1024, maxTokensCeiling: 32_768 };
const parse = (body: unknown) =>
  Effect.runSyncExit(parseImageBody(JSON.stringify(body), limits));

describe("image requests", () => {
  it("defaults to one 512x512 image and forwards base64 PNG", () => {
    const exit = parse({ model: "flux-2-klein-4b", prompt: "a fox" });
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.n).toBe(1);
      expect(exit.value.size).toBe("512x512");
      expect(exit.value.forward).toMatchObject({
        model: "flux-2-klein-4b",
        response_format: "b64_json",
      });
    }
  });

  it("refuses a missing prompt, too many images and odd sizes", () => {
    expect(Exit.isFailure(parse({ model: "m" }))).toBe(true);
    expect(Exit.isFailure(parse({ model: "m", n: 5, prompt: "x" }))).toBe(true);
    expect(
      Exit.isFailure(parse({ model: "m", prompt: "x", size: "640x480" }))
    ).toBe(true);
  });

  it("prices each image at the listing's output price", () => {
    const prices = {
      cacheReadPerMtok: 0n,
      inputPerMtok: 0n,
      outputPerMtok: 2000n,
    };
    expect(quotePrice(prices, 0, IMAGE_OUTPUT_TOKENS)).toBe(2000n);
    expect(quotePrice(prices, 0, 3 * IMAGE_OUTPUT_TOKENS)).toBe(6000n);
  });
});
