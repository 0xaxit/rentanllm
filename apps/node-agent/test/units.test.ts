import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Duration, Effect, Redacted, Schedule } from "effect";
import { describe, expect, it } from "vitest";

import { evaluateAdmission } from "../src/admission.ts";
import { ConfigError } from "../src/config-error.ts";
import {
  mergeInputs,
  readCliProxyApiConfig,
  resolveConfig,
} from "../src/config.ts";
import { makeCliProxyApiCredentialStore } from "../src/credentials.ts";
import {
  makeAnthropicAdapter,
  readAnthropicMeters,
  sseUsageTracker,
} from "../src/providers/anthropic.ts";
import {
  makeCliProxyApiAdapter,
  probeCandidates,
  readCodexMeters,
} from "../src/providers/cliproxyapi.ts";
import { reconnectSchedule } from "../src/tunnel.ts";
import { SSE_EVENTS } from "./harness.ts";

const dir = () => mkdtempSync(path.join(tmpdir(), "rentanllm-cred-"));
const NOW = 0;
const freshMeters = (
  sessionUsedPct: number | null,
  weeklyUsedPct: number | null
) => ({
  readAt: new Date(NOW - 1000).toISOString(),
  sessionResetsAt: null,
  sessionUsedPct,
  weeklyResetsAt: null,
  weeklyUsedPct,
});
const openAt = { open: true, sessionCutoffPct: 80, weeklyCutoffPct: 60 };

describe("evaluateAdmission", () => {
  it("admits when open, fresh and under the cut-offs", () => {
    expect(
      evaluateAdmission({
        availability: openAt,
        circuitOpenUntilMs: 0,
        meters: freshMeters(76, 56),
        nowMs: NOW,
      })
    ).toBeNull();
  });

  it.each([
    ["closed", { ...openAt, open: false }, 0, freshMeters(1, 1), "node_closed"],
    [
      "circuit open",
      openAt,
      NOW + 5000,
      freshMeters(1, 1),
      "provider_rate_limited",
    ],
    ["no meters", openAt, 0, null, "meters_unreadable"],
    ["no session meter", openAt, 0, freshMeters(null, 1), "meters_unreadable"],
    [
      "stale meters",
      openAt,
      0,
      { ...freshMeters(1, 1), readAt: new Date(NOW - 121_000).toISOString() },
      "meters_unreadable",
    ],
    [
      "session at cut-off minus margin",
      openAt,
      0,
      freshMeters(77, 1),
      "cutoff_reached",
    ],
    [
      "weekly at cut-off minus margin",
      openAt,
      0,
      freshMeters(1, 57),
      "cutoff_reached",
    ],
  ] as const)(
    "refuses when %s",
    (_label, availability, circuitOpenUntilMs, meters, code) => {
      expect(
        evaluateAdmission({
          availability,
          circuitOpenUntilMs,
          meters,
          nowMs: NOW,
        })?.code
      ).toBe(code);
    }
  );
});

describe("Anthropic usage parsing", () => {
  it("parses SSE usage no matter how the stream is split", () => {
    const body = SSE_EVENTS.join("");
    for (const size of [1, 7, 64, body.length]) {
      const tracker = sseUsageTracker();
      for (let i = 0; i < body.length; i += size) {
        tracker.feed(body.slice(i, i + size));
      }
      expect(tracker.finish()).toEqual({
        cacheReadTokens: 5,
        cacheWriteTokens: 3,
        inputTokens: 25,
        model: "claude-test-1",
        outputTokens: 42,
      });
    }
  });

  it("returns null usage for bodies without a model (e.g. count_tokens)", () => {
    const tracker = makeAnthropicAdapter(
      "https://api.anthropic.com"
    ).usageTracker("application/json");
    tracker.feed('{"input_tokens": 12}');
    expect(tracker.finish()).toBeNull();
  });
});

const keyMeters = (limit: string, now: Date) =>
  readAnthropicMeters(
    {
      "anthropic-ratelimit-tokens-limit": limit,
      "anthropic-ratelimit-tokens-remaining": "1",
    },
    now
  );

describe("Anthropic meters", () => {
  const now = new Date(NOW);

  it("reads plan utilization headers", () => {
    expect(
      readAnthropicMeters(
        {
          "Anthropic-Ratelimit-Unified-5h-Reset": "1900000000",
          "anthropic-ratelimit-unified-5h-utilization": "0.42",
          "anthropic-ratelimit-unified-7d-utilization": "0.1",
        },
        now
      )
    ).toEqual({
      plan: "Claude subscription",
      readAt: now.toISOString(),
      sessionResetsAt: new Date(1_900_000_000_000).toISOString(),
      sessionUsedPct: 42,
      source: "plan",
      weeklyResetsAt: null,
      weeklyUsedPct: 10,
    });
  });

  it("falls back to the documented token bucket headers", () => {
    expect(
      readAnthropicMeters(
        {
          "anthropic-ratelimit-tokens-limit": "1000",
          "anthropic-ratelimit-tokens-remaining": "250",
          "anthropic-ratelimit-tokens-reset": new Date(
            NOW + 60_000
          ).toISOString(),
        },
        now
      )
    ).toMatchObject({ sessionUsedPct: 75, weeklyUsedPct: null });
  });

  it("labels an API key with its per-minute token limit", () => {
    expect(keyMeters("450000", now)?.plan).toBe("API key · 450K tokens/min");
    expect(keyMeters("2000000", now)?.plan).toBe("API key · 2M tokens/min");
    expect(keyMeters("800", now)?.plan).toBe("API key · 800 tokens/min");
  });

  it("returns null without meter headers", () => {
    expect(
      readAnthropicMeters({ "content-type": "application/json" }, now)
    ).toBeNull();
  });
});

describe("Anthropic request building", () => {
  it("uses x-api-key and an honest user agent, forwarding only allowlisted headers", () => {
    const adapter = makeAnthropicAdapter("https://api.anthropic.com");
    const built = adapter.buildRequest(
      {
        _tag: "ProxyRequest",
        body: "{}",
        bookingId: "b",
        headers: {
          "Anthropic-Beta": "x",
          "user-agent": "spoofed/1.0",
          "x-api-key": "renter-key",
        },
        method: "POST",
        path: "/v1/messages",
        provider: "anthropic",
        requestId: "r",
      },
      Redacted.make("owner-key")
    );
    expect(built.url).toBe("https://api.anthropic.com/v1/messages");
    expect(built.headers).toEqual({
      "anthropic-beta": "x",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "user-agent": "rentanllm-node/0.0.2",
      "x-api-key": "owner-key",
    });
  });
});

const codexWindow = (name: string, used: string, minutes: string) => ({
  [`x-codex-${name}-reset-at`]: "1900000000",
  [`x-codex-${name}-used-percent`]: used,
  [`x-codex-${name}-window-minutes`]: minutes,
});

describe("CLIProxyAPI upstream", () => {
  const now = new Date(NOW);

  it("maps the Codex 5h and weekly windows by their length", () => {
    expect(
      readCodexMeters(
        {
          ...codexWindow("primary", "12", "300"),
          ...codexWindow("secondary", "40", "10080"),
          "X-Codex-Plan-Type": "plus",
        },
        now
      )
    ).toEqual({
      plan: "ChatGPT plus",
      readAt: now.toISOString(),
      sessionResetsAt: new Date(1_900_000_000_000).toISOString(),
      sessionUsedPct: 12,
      source: "plan",
      weeklyResetsAt: new Date(1_900_000_000_000).toISOString(),
      weeklyUsedPct: 40,
    });
  });

  it("uses a lone weekly window as the session meter too", () => {
    expect(
      readCodexMeters(
        {
          ...codexWindow("primary", "7", "10080"),
          "x-codex-secondary-reset-at": "",
          "x-codex-secondary-used-percent": "0",
          "x-codex-secondary-window-minutes": "0",
        },
        now
      )
    ).toMatchObject({ sessionUsedPct: 7, weeklyUsedPct: 7 });
  });

  it("returns null without quota headers", () => {
    expect(
      readCodexMeters({ "content-type": "application/json" }, now)
    ).toBeNull();
  });

  it("probes with a one-token message to the configured model", () => {
    const adapter = makeCliProxyApiAdapter({
      baseUrl: "http://127.0.0.1:8317",
      probeModel: "gpt-test",
      provider: "openai",
    });
    expect(adapter.provider).toBe("openai");
    const probe = adapter.meterProbe(Redacted.make("proxy-key"));
    expect(probe?.url).toBe("http://127.0.0.1:8317/v1/messages");
    expect(probe?.headers["x-api-key"]).toBe("proxy-key");
    expect(JSON.parse(probe?.body ?? "")).toMatchObject({
      max_tokens: 1,
      model: "gpt-test",
    });
    expect(
      adapter.readMeters(
        { "anthropic-ratelimit-unified-5h-utilization": "0.5" },
        now
      )
    ).toMatchObject({ plan: "Claude subscription", sessionUsedPct: 50 });
    expect(
      makeCliProxyApiAdapter({
        baseUrl: "http://127.0.0.1:8317",
        probeModel: null,
        provider: "anthropic",
      }).meterProbe(Redacted.make("proxy-key"))
    ).toBeNull();
  });
});

describe("probe model candidates", () => {
  it("tries current, light models before snapshots and heavier ones", () => {
    expect(
      probeCandidates("anthropic", [
        "gpt-6-sol",
        "claude-sonnet-4-20250514",
        "claude-opus-5-5",
        "claude-haiku-4-5-20251001",
        "claude-sonnet-4-6",
        "claude-haiku-5-5",
        "claude-sonnet-5-5",
      ])
    ).toEqual([
      "claude-haiku-5-5",
      "claude-sonnet-5-5",
      "claude-sonnet-4-6",
      "claude-opus-5-5",
      "claude-haiku-4-5-20251001",
      "claude-sonnet-4-20250514",
    ]);
    expect(
      probeCandidates("openai", [
        "gpt-6-sol",
        "claude-opus-5-5",
        "gpt-image-2",
        "gpt-5.6-luna",
        "codex-auto-review",
        "gpt-6-luna",
      ])
    ).toEqual(["gpt-6-luna", "gpt-5.6-luna", "gpt-6-sol"]);
  });
});

describe("CLIProxyAPI credential", () => {
  const base = { gatewayUrl: "wss://g.example", nodeId: "n", nodeToken: "t" };

  it("reads the port and first api key from its config.yaml", () => {
    const file = path.join(dir(), "config.yaml");
    writeFileSync(
      file,
      [
        "# CLIProxyAPI",
        "port: 9000",
        'auth-dir: "~/.cli-proxy-api"',
        "api-keys:",
        '  - "first-key" # used by the node',
        "  - second-key",
        "debug: false",
      ].join("\n")
    );
    expect(readCliProxyApiConfig(file)).toEqual({
      apiKey: "first-key",
      port: 9000,
    });
    expect(readCliProxyApiConfig(path.join(dir(), "missing.yaml"))).toEqual({});
  });

  it("serves that key, and fails clearly without one", async () => {
    const config = resolveConfig(
      { ...base, cliProxyApiKey: "proxy-key", cliProxyApiPort: 9000 },
      dir()
    );
    const value = await Effect.runPromise(
      makeCliProxyApiCredentialStore(config).get("anthropic")
    );
    expect(Redacted.value(value)).toBe("proxy-key");
    expect(String(value)).not.toContain("proxy-key");

    const error = await Effect.runPromise(
      Effect.flip(
        makeCliProxyApiCredentialStore(resolveConfig(base, dir())).get(
          "anthropic"
        )
      )
    );
    expect(error.message).toContain("api-keys");
  });
});

describe("config", () => {
  const configDir = mkdtempSync(path.join(tmpdir(), "rentanllm-config-"));

  it("lets flags win over env over file", () => {
    const merged = mergeInputs(
      { gatewayUrl: "wss://flag.example/node", nodeId: "flag-node" },
      { gatewayUrl: "wss://env.example/node", nodeToken: "env-token" },
      { nodeId: "file-node", nodeToken: "file-token" }
    );
    const config = resolveConfig(merged, configDir);
    expect(config.gatewayUrl).toBe("wss://flag.example/node");
    expect(Redacted.value(config.nodeToken)).toBe("env-token");
    expect(config.nodeId).toBe("flag-node");
  });

  it("requires TLS except for localhost", () => {
    expect(() =>
      resolveConfig(
        {
          gatewayUrl: "ws://gateway.example/node",
          nodeId: "n",
          nodeToken: "t",
        },
        configDir
      )
    ).toThrow(ConfigError);
    expect(() =>
      resolveConfig(
        {
          cliProxyApiUrl: "http://evil.example",
          gatewayUrl: "wss://g.example",
          nodeId: "n",
          nodeToken: "t",
        },
        configDir
      )
    ).toThrow(ConfigError);
    expect(
      resolveConfig(
        { gatewayUrl: "ws://127.0.0.1:8787/node", nodeId: "n", nodeToken: "t" },
        configDir
      ).gatewayUrl
    ).toBe("ws://127.0.0.1:8787/node");
  });

  it("requires the registered node id and never generates one", () => {
    const missing = () =>
      resolveConfig(
        { gatewayUrl: "wss://g.example", nodeToken: "t" },
        configDir
      );
    expect(missing).toThrow(ConfigError);
    expect(missing).toThrow("RENTANLLM_NODE_ID");
    expect(() =>
      resolveConfig(
        { gatewayUrl: "wss://g.example", nodeId: "  ", nodeToken: "t" },
        configDir
      )
    ).toThrow("node id is required");
    expect(existsSync(path.join(configDir, "node-id"))).toBe(false);
  });

  it("always serves through a localhost CLIProxyAPI, on the port its config sets", () => {
    const base = { gatewayUrl: "wss://g.example", nodeId: "n", nodeToken: "t" };
    expect(resolveConfig(base, configDir).cliProxyApi).toMatchObject({
      apiKey: null,
      baseUrl: "http://127.0.0.1:8317",
      probeModels: {},
    });
    expect(
      resolveConfig({ ...base, cliProxyApiPort: 9000 }, configDir).cliProxyApi
        .baseUrl
    ).toBe("http://127.0.0.1:9000");
    expect(
      resolveConfig(
        {
          ...base,
          cliProxyApiPort: 9000,
          cliProxyApiUrl: "http://localhost:8400/",
        },
        configDir
      ).cliProxyApi.baseUrl
    ).toBe("http://localhost:8400");
    expect(() =>
      resolveConfig(
        { ...base, cliProxyApiUrl: "http://proxy.example:8317" },
        configDir
      )
    ).toThrow(ConfigError);
  });

  const url = (gatewayUrl: string) =>
    resolveConfig({ gatewayUrl, nodeId: "n", nodeToken: "t" }, configDir)
      .gatewayUrl;

  it("appends the tunnel path to a bare gateway host only", () => {
    expect(url("wss://gw.example")).toBe("wss://gw.example/tunnel");
    expect(url("wss://gw.example/")).toBe("wss://gw.example/tunnel");
    expect(url("wss://gw.example/tunnel")).toBe("wss://gw.example/tunnel");
    expect(url("ws://localhost:8787/custom")).toBe(
      "ws://localhost:8787/custom"
    );
  });
});

describe("reconnect schedule", () => {
  it("grows exponentially, is capped and jittered", async () => {
    const delays = await Effect.runPromise(
      Effect.gen(function* delays() {
        const step = yield* Schedule.toStep(reconnectSchedule(100, 1000));
        const out: number[] = [];
        for (let i = 0; i < 8; i += 1) {
          const [, delay] = yield* step(0, undefined);
          out.push(Duration.toMillis(delay));
        }
        return out;
      })
    );
    expect(delays[0]).toBeGreaterThanOrEqual(80);
    expect(delays[0]).toBeLessThanOrEqual(120);
    expect(delays[2]).toBeGreaterThan(delays[0] ?? 0);
    for (const d of delays) {
      expect(d).toBeLessThanOrEqual(1200);
    }
    expect(delays[7]).toBeGreaterThanOrEqual(800);
  });
});
