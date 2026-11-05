import { describe, expect, it } from "vitest";

import {
  formatPrice,
  formatTokens,
  formatUsd,
  formatTokenCost,
  formatUsdExact,
  sanitizePriceInput,
  formatUsdCompact,
  formatUsdcAmount,
  microsToInput,
  parseUsdInput,
  toMicros,
} from "@/lib/money";

describe("toMicros", () => {
  it("parses the API's decimal strings into bigint", () => {
    expect(toMicros("19200000")).toBe(19_200_000n);
    expect(toMicros(" -5 ")).toBe(-5n);
    expect(toMicros(7n)).toBe(7n);
  });

  it("rejects anything that is not an integer string", () => {
    expect(() => toMicros("19.20")).toThrow();
    expect(() => toMicros("1e6")).toThrow();
    expect(() => toMicros("")).toThrow();
  });

  it("keeps precision beyond Number.MAX_SAFE_INTEGER", () => {
    expect(toMicros("9007199254740993123")).toBe(9_007_199_254_740_993_123n);
    expect(formatUsd("9007199254740993123")).toBe("$9,007,199,254,740.99");
  });
});

describe("formatUsd", () => {
  it("formats micros as dollars and cents", () => {
    expect(formatUsd(19_200_000n)).toBe("$19.20");
    expect(formatUsd("2880000")).toBe("$2.88");
    expect(formatUsd(0n)).toBe("$0.00");
    expect(formatUsd(1_204_000_000n)).toBe("$1,204.00");
  });

  it("rounds half away from zero to the cent", () => {
    expect(formatUsd(5000n)).toBe("$0.01");
    expect(formatUsd(4999n)).toBe("$0.00");
    expect(formatUsd(-2_885_000n)).toBe("-$2.89");
  });

  it("can keep four decimals", () => {
    expect(formatUsd(80_000n, { fractionDigits: 4 })).toBe("$0.0800");
    expect(formatUsd(12_550n, { fractionDigits: 4 })).toBe("$0.0126");
  });
});

describe("compact and price formats", () => {
  it("drops cents on whole dollars", () => {
    expect(formatUsdCompact(10_000_000n)).toBe("$10");
    expect(formatUsdCompact(2_500_000n)).toBe("$2.50");
  });

  it("shows sub-cent prices per million tokens", () => {
    expect(formatPrice(1_600_000n)).toBe("$1.60");
    expect(formatPrice(80_000n)).toBe("$0.08");
    expect(formatPrice(12_500n)).toBe("$0.0125");
  });

  it("formats USDC amounts", () => {
    expect(formatUsdcAmount(20_000_000n)).toBe("20.00 USDC");
  });

  it("formats token counts", () => {
    expect(formatTokens(40_000_000)).toBe("40.0M");
    expect(formatTokens(1250)).toBe("1k");
    expect(formatTokens(12)).toBe("12");
  });
});

describe("price input round trip", () => {
  it("parses what owners type", () => {
    expect(parseUsdInput("1.6")).toBe(1_600_000n);
    expect(parseUsdInput("$1.60")).toBe(1_600_000n);
    expect(parseUsdInput(".08")).toBe(80_000n);
    expect(parseUsdInput("20")).toBe(20_000_000n);
    expect(parseUsdInput("0.000001")).toBe(1n);
  });

  it("rejects malformed input", () => {
    for (const raw of ["", ".", "-1", "1.2.3", "abc", "1.0000001"]) {
      expect(parseUsdInput(raw)).toBeNull();
    }
  });

  it("renders micros back into an editable string", () => {
    expect(microsToInput(1_600_000n)).toBe("1.60");
    expect(microsToInput(125_000n)).toBe("0.125");
    expect(microsToInput(20_000_000n)).toBe("20.00");
    const typed = microsToInput(12_345n);
    expect(parseUsdInput(typed)).toBe(12_345n);
  });
});

describe("formatUsdExact", () => {
  it("keeps whole cents short and never rounds sub-cent amounts away", () => {
    expect(formatUsdExact(5_000_000n)).toBe("$5.00");
    expect(formatUsdExact(4_999_997n)).toBe("$4.999997");
    expect(formatUsdExact(3n)).toBe("$0.000003");
    expect(formatUsdExact(1_250_000n)).toBe("$1.25");
    expect(formatUsdExact(-1500n)).toBe("-$0.0015");
    expect(formatUsdExact("1204000000")).toBe("$1,204.00");
  });
});

describe("sanitizePriceInput", () => {
  it("keeps one decimal point and at most six decimals", () => {
    expect(sanitizePriceInput("0.4.00")).toBe("0.400");
    expect(sanitizePriceInput("0.4.")).toBe("0.4");
    expect(sanitizePriceInput("$1.60")).toBe("1.60");
    expect(sanitizePriceInput("1.1234567")).toBe("1.123456");
    expect(sanitizePriceInput("12a.5")).toBe("12.5");
    expect(sanitizePriceInput(".08")).toBe(".08");
    expect(sanitizePriceInput("")).toBe("");
  });
});

describe("formatTokenCost", () => {
  it("prices tokens exactly, before the request's rounding", () => {
    expect(formatTokenCost(309, 800_000n)).toBe("$0.0002472");
    expect(formatTokenCost(31, 200_000n)).toBe("$0.0000062");
    expect(formatTokenCost(1_000_000, 1_600_000n)).toBe("$1.60");
    expect(formatTokenCost(0, 800_000n)).toBe("$0.00");
  });
});
