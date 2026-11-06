import { describe, expect, it } from "vitest";

import { base58, canonicalAid, hcs14Uaid } from "../src/reputation/uaid";
import { feedbackFor } from "../src/services/agents";

const INPUT = {
  name: "  Seller ",
  nativeId: "eip155:296:0xabc",
  protocol: "X402",
  registry: "ERC-8004",
  skills: [17, 0, 3],
  uid: "7",
  version: "1",
};

describe("HCS-14 UAID", () => {
  it("encodes base58 like Bitcoin, keeping leading zero bytes", () => {
    expect(base58(new TextEncoder().encode("hello world"))).toBe(
      "StV1DL6CwTryKyV"
    );
    expect(base58(Uint8Array.from([0, 0, 1]))).toBe("112");
  });

  it("normalizes before hashing: trimmed, lowercased registry and protocol, sorted skills", () => {
    expect(canonicalAid(INPUT)).toBe(
      '{"name":"Seller","nativeId":"eip155:296:0xabc","protocol":"x402","registry":"erc-8004","skills":[0,3,17],"version":"1"}'
    );
  });

  it("is deterministic and carries the routing parameters", () => {
    const uaid = hcs14Uaid(INPUT);
    expect(uaid).toBe(hcs14Uaid({ ...INPUT, skills: [3, 17, 0] }));
    expect(uaid).toMatch(
      /^uaid:aid:[1-9A-HJ-NP-Za-km-z]{60,70};uid=7;registry=erc-8004;proto=x402;nativeId=eip155:296:0xabc$/u
    );
  });
});

describe("reputation feedback", () => {
  it("posts only what was measured, percentages with two decimals", () => {
    expect(
      feedbackFor({ successPct: null, ttfbMs: null, uptimePct: 99.87 }, "e")
    ).toEqual([
      { decimals: 2, endpoint: "e", tag1: "uptime", tag2: "24h", value: 9987n },
    ]);
    expect(
      feedbackFor({ successPct: 100, ttfbMs: 412, uptimePct: null }, "e").map(
        (f) => [f.tag1, f.value]
      )
    ).toEqual([
      ["ttfbMs", 412n],
      ["successRate", 10_000n],
    ]);
  });
});
