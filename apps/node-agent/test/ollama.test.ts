import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Effect, Redacted } from "effect";
import { describe, expect, it } from "vitest";

import { ConfigError } from "../src/config-error.ts";
import { resolveConfig } from "../src/config.ts";
import { makeCliProxyApiCredentialStore } from "../src/credentials.ts";
import {
  makeOllamaAdapter,
  openAiJsonUsageTracker,
  openAiSseUsageTracker,
  readOllamaMeters,
  withStreamUsage,
} from "../src/providers/ollama.ts";

const NOW = new Date(0);
const base = {
  gatewayUrl: "wss://gw.example",
  nodeId: "node-1",
  nodeToken: "nt_test",
};
const dir = () => mkdtempSync(path.join(tmpdir(), "rentanllm-ollama-"));

describe("Ollama usage", () => {
  it("reads usage from the last stream chunk, even when split across feeds", () => {
    const tracker = openAiSseUsageTracker();
    tracker.feed(
      'data: {"model":"llama3.1:8b","choices":[{"delta":{"content":"Hi"}}]}\n\n'
    );
    tracker.feed(
      'data: {"model":"llama3.1:8b","choices":[],"usage":{"prompt_tokens":12,'
    );
    tracker.feed('"completion_tokens":34}}\n\ndata: [DONE]\n\n');
    expect(tracker.finish()).toEqual({
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      inputTokens: 12,
      model: "llama3.1:8b",
      outputTokens: 34,
    });
  });

  it("reports no usage when the stream never sent any", () => {
    const tracker = openAiSseUsageTracker();
    tracker.feed('data: {"model":"llama3.1:8b","choices":[]}\n\n');
    expect(tracker.finish()).toBeNull();
  });

  it("reads usage from a plain JSON response", () => {
    const tracker = openAiJsonUsageTracker();
    tracker.feed('{"model":"qwen2.5:7b","usage":{"prompt_tokens":5,');
    tracker.feed('"completion_tokens":7,"total_tokens":12}}');
    expect(tracker.finish()).toMatchObject({
      inputTokens: 5,
      model: "qwen2.5:7b",
      outputTokens: 7,
    });
  });
});

describe("Ollama requests", () => {
  it("asks for usage on streamed requests and keeps other stream options", () => {
    const body = JSON.parse(
      withStreamUsage(
        JSON.stringify({
          messages: [],
          model: "m",
          stream: true,
          stream_options: { other: 1 },
        })
      )
    );
    expect(body.stream_options).toEqual({ include_usage: true, other: 1 });
  });

  it("leaves non-streamed and non-JSON bodies alone", () => {
    const plain = JSON.stringify({ messages: [], model: "m" });
    expect(withStreamUsage(plain)).toBe(plain);
    expect(withStreamUsage("not json")).toBe("not json");
  });

  it("forwards to the local Ollama without any credential header", () => {
    const adapter = makeOllamaAdapter({
      baseUrl: "http://127.0.0.1:11434",
      imageBaseUrl: null,
      probeModel: "llama3.1:8b",
    });
    const built = adapter.buildRequest(
      {
        _tag: "ProxyRequest",
        body: "{}",
        bookingId: "b",
        headers: {
          authorization: "Bearer leak",
          "content-type": "application/json",
        },
        method: "POST",
        path: "/v1/chat/completions",
        provider: "ollama",
        requestId: "r",
      },
      Redacted.make("none")
    );
    expect(built.url).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(built.headers.authorization).toBeUndefined();
    expect(adapter.meterProbe(Redacted.make("none"))?.url).toBe(
      "http://127.0.0.1:11434/api/show"
    );
  });

  it("treats any answer as a fresh, unused meter and silence as none", () => {
    expect(
      readOllamaMeters({ "content-type": "application/json" }, NOW)
    ).toMatchObject({
      readAt: NOW.toISOString(),
      sessionUsedPct: 0,
      weeklyUsedPct: null,
    });
    expect(readOllamaMeters({}, NOW)).toBeNull();
  });
});

describe("Ollama config", () => {
  it("is off unless a model is named", () => {
    expect(resolveConfig(base, dir()).ollama).toBeNull();
  });

  it("defaults to the local Ollama port", () => {
    expect(
      resolveConfig({ ...base, ollamaModel: "llama3.1:8b" }, dir()).ollama
    ).toEqual({
      baseUrl: "http://127.0.0.1:11434",
      imageBaseUrl: null,
      probeModel: "llama3.1:8b",
    });
  });

  it("refuses plain http to a remote Ollama", () => {
    expect(() =>
      resolveConfig(
        { ...base, ollamaModel: "m", ollamaUrl: "http://10.0.0.5:11434" },
        dir()
      )
    ).toThrow(ConfigError);
  });

  it("needs no CLIProxyAPI key to serve Ollama", async () => {
    const store = makeCliProxyApiCredentialStore(
      resolveConfig({ ...base, ollamaModel: "m" }, dir())
    );
    const credential = await Effect.runPromise(store.get("ollama"));
    expect(Redacted.value(credential)).toBe("none");
  });

  it("sends image requests to the image server and bills each image as 1M output tokens", () => {
    const adapter = makeOllamaAdapter({
      baseUrl: "http://127.0.0.1:11434",
      imageBaseUrl: "http://127.0.0.1:1234",
      probeModel: "llama3.1:8b",
    });
    const built = adapter.buildRequest(
      {
        body: JSON.stringify({ model: "flux-2-klein-4b", prompt: "a cat" }),
        headers: {},
        id: "r1",
        maxOutputTokens: null,
        method: "POST",
        path: "/v1/images/generations",
        provider: "ollama",
        stream: false,
        type: "proxy_request",
      } as never,
      Redacted.make("")
    );
    expect(built.url).toBe("http://127.0.0.1:1234/v1/images/generations");
    const tracker = adapter.usageTracker("application/json");
    tracker.feed(
      JSON.stringify({
        created: 1,
        data: [{ b64_json: "AA" }, { b64_json: "BB" }],
      })
    );
    expect(tracker.finish()).toMatchObject({
      inputTokens: 0,
      outputTokens: 2_000_000,
    });
  });
});
