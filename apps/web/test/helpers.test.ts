import { describe, expect, it } from "vitest";

import { presetFor, stopAt } from "@/lib/cutoffs";
import { modelsLabel } from "@/lib/market";
import { nodeStartCommand, tunnelUrl } from "@/lib/node-command";
import { percentOfApi, verdictFor } from "@/lib/pricing";
import { formatDays, formatDuration, formatWindow } from "@/lib/time";

const MINUTE_MS = 60_000;
const at = (ms: number) => new Date(ms);

describe("node agent command", () => {
  it("builds the tunnel URL from the gateway URL", () => {
    expect(tunnelUrl("https://gw.rentanllm.xyz")).toBe(
      "wss://gw.rentanllm.xyz/tunnel"
    );
    expect(tunnelUrl("http://localhost:8787/")).toBe(
      "ws://localhost:8787/tunnel"
    );
  });

  it("prints the exact start command", () => {
    expect(
      nodeStartCommand({
        gatewayUrl: "https://gw.rentanllm.xyz",
        nodeId: "node-1",
        nodeToken: "nt_secret",
      })
    ).toBe(
      "ral start --gateway wss://gw.rentanllm.xyz/tunnel --node-id node-1 --node-token nt_secret --ollama-model llama3.1:8b"
    );
  });
});

describe("listing labels", () => {
  it("names the first model and counts the rest", () => {
    expect(modelsLabel(["llama3.1:8b"])).toBe("llama3.1:8b");
    expect(modelsLabel(["llama3.1:8b", "qwen2.5:7b"])).toBe("llama3.1:8b +1");
    expect(modelsLabel([])).toBe("any model");
  });
});

describe("pricing verdict (shared with the API via @rentanllm/core)", () => {
  const api = { inputPerMtok: 4_000_000n, outputPerMtok: 20_000_000n };
  it("judges against the API list price", () => {
    expect(
      verdictFor({ inputPerMtok: 1_600_000n, outputPerMtok: 8_000_000n }, api)
    ).toBe("fair");
    expect(
      verdictFor({ inputPerMtok: 400_000n, outputPerMtok: 2_000_000n }, api)
    ).toBe("underpriced");
    expect(
      verdictFor({ inputPerMtok: 3_000_000n, outputPerMtok: 15_000_000n }, api)
    ).toBe("pricey");
    expect(
      verdictFor({ inputPerMtok: 4_000_000n, outputPerMtok: 20_000_000n }, api)
    ).toBe("above_api");
    expect(verdictFor(api, { inputPerMtok: 0n, outputPerMtok: 0n })).toBeNull();
    expect(
      Math.round(
        percentOfApi(
          { inputPerMtok: 1_600_000n, outputPerMtok: 8_000_000n },
          api
        )
      )
    ).toBe(40);
  });
});

describe("cut-offs and time", () => {
  it("knows the presets and the stop margin", () => {
    expect(presetFor(90, 50)).toBe("balanced");
    expect(presetFor(91, 50)).toBeNull();
    expect(stopAt(90)).toBe(87);
  });

  it("formats windows in a zone", () => {
    expect(
      formatWindow(
        at(18 * 60 * MINUTE_MS + 30 * MINUTE_MS),
        at(26 * 60 * MINUTE_MS + 30 * MINUTE_MS),
        "Asia/Kolkata"
      )
    ).toBe("00:00 → 08:00");
    expect(formatDuration(79 * 60_000)).toBe("1h19m");
    expect(formatDays([1, 2, 3, 4, 5])).toBe("Mon–Fri");
    expect(formatDays([0, 1, 2, 3, 4, 5, 6])).toBe("every day");
    expect(formatDays([1, 3])).toBe("Mon, Wed");
  });
});
