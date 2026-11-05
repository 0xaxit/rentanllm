import type { GatewayToNode } from "@rentanllm/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  fixedMeters,
  forRequest,
  framesOf,
  NODE_TOKEN,
  SSE_EVENTS,
  sleep,
  startAgent,
  startFakeAnthropic,
  startFakeGateway,
  TEST_CREDENTIAL,
  testConfig,
  waitFor,
} from "./harness.ts";
import type { AgentHandle, FakeAnthropic, FakeGateway } from "./harness.ts";

let gateway: FakeGateway;
let anthropic: FakeAnthropic;
let agent: AgentHandle | undefined;

const proxyRequest = (
  requestId: string,
  overrides: Partial<Extract<GatewayToNode, { _tag: "ProxyRequest" }>> = {}
): GatewayToNode => ({
  _tag: "ProxyRequest",
  body: JSON.stringify({
    max_tokens: 16,
    messages: [],
    model: "claude-test-1",
    stream: true,
  }),
  bookingId: "booking-1",
  headers: {
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
    "x-renter-tracking": "should-not-forward",
  },
  method: "POST",
  path: "/v1/messages",
  provider: "anthropic",
  requestId,
  ...overrides,
});

const open = (sessionCutoffPct = 90, weeklyCutoffPct = 90) =>
  gateway.send({
    _tag: "SetAvailability",
    open: true,
    sessionCutoffPct,
    weeklyCutoffPct,
  });

const terminal = (requestId: string) =>
  waitFor(
    () =>
      forRequest(gateway, requestId).find(
        (f) => f._tag === "ResponseEnd" || f._tag === "ResponseError"
      ),
    `terminal frame for ${requestId}`
  );

/** Connect, open the node and wait until a heartbeat carries fresh meters. */
const connectAndOpen = async () => {
  agent = startAgent(testConfig(gateway.url, anthropic.baseUrl));
  await waitFor(() => gateway.connections() > 0, "agent connection");
  open();
  await waitFor(
    () => framesOf(gateway, "Heartbeat").some((h) => h.meters.length > 0),
    "heartbeat with meters"
  );
};

beforeEach(() => {
  gateway = startFakeGateway();
  anthropic = startFakeAnthropic();
});

afterEach(async () => {
  await agent?.stop();
  agent = undefined;
  gateway.close();
  anthropic.close();
});

describe("tunnel", () => {
  it("sends NodeHello first, authenticates with the node token, then heartbeats", async () => {
    agent = startAgent(testConfig(gateway.url, anthropic.baseUrl));
    await waitFor(
      () => framesOf(gateway, "Heartbeat").length >= 2,
      "two heartbeats"
    );

    expect(gateway.frames[0]).toEqual({
      _tag: "NodeHello",
      agentVersion: "0.0.2",
      nodeId: "node-test",
      protocolVersion: 1,
      providers: ["anthropic"],
    });
    expect(gateway.handshakes[0]?.get("authorization")).toBe(
      `Bearer ${NODE_TOKEN}`
    );
    expect(gateway.handshakes[0]?.get("user-agent")).toBe(
      "rentanllm-node/0.0.2"
    );
    const [first] = framesOf(gateway, "Heartbeat");
    expect(Number.isNaN(Date.parse(first?.at ?? ""))).toBe(false);
    // Closed node: one detection probe, so the gateway learns the plan before anything is listed.
    expect(first?.meters).toHaveLength(1);
    expect(first?.meters[0]?.meters.plan).toBe("Claude subscription");
  });

  it("reconnects and re-sends NodeHello after the gateway drops the socket", async () => {
    agent = startAgent(testConfig(gateway.url, anthropic.baseUrl));
    await waitFor(
      () => framesOf(gateway, "NodeHello").length === 1,
      "first hello"
    );
    gateway.dropAll();
    await waitFor(
      () => framesOf(gateway, "NodeHello").length === 2,
      "second hello"
    );
    expect(gateway.handshakes.length).toBeGreaterThanOrEqual(2);
    await waitFor(
      () =>
        (agent?.status()?.connection.reconnects ?? 0) >= 1 &&
        agent?.status()?.connection.connected,
      "status shows reconnect"
    );
  });

  it("keeps retrying with backoff until the gateway comes up", async () => {
    const port = Number(new URL(gateway.url).port);
    gateway.close();
    agent = startAgent(
      testConfig(`ws://127.0.0.1:${port}/node`, anthropic.baseUrl)
    );
    await sleep(300);
    gateway = startFakeGateway(port);
    await waitFor(
      () => framesOf(gateway, "NodeHello").length === 1,
      "hello after gateway starts"
    );
  });
});

describe("proxying", () => {
  it("streams the upstream body through chunk by chunk and reports usage", async () => {
    await connectAndOpen();
    gateway.send(proxyRequest("r1"));
    const end = await terminal("r1");

    const frames = forRequest(gateway, "r1");
    const [head] = frames;
    expect(head).toMatchObject({ _tag: "ResponseHead", status: 200 });
    expect(head?._tag === "ResponseHead" && head.headers).toEqual({
      "content-type": "text/event-stream",
      "request-id": "req_stream",
    });
    const chunks = frames.filter((f) => f._tag === "ResponseChunk");
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(
      chunks.map((c) => (c._tag === "ResponseChunk" ? c.data : "")).join("")
    ).toBe(SSE_EVENTS.join(""));
    expect(end).toEqual({
      _tag: "ResponseEnd",
      requestId: "r1",
      usage: {
        cacheReadTokens: 5,
        cacheWriteTokens: 3,
        inputTokens: 25,
        model: "claude-test-1",
        outputTokens: 42,
      },
    });

    const [upstream] = anthropic.requests;
    expect(upstream?.path).toBe("/v1/messages");
    expect(upstream?.headers.get("x-api-key")).toBe(TEST_CREDENTIAL);
    expect(upstream?.headers.get("user-agent")).toBe("rentanllm-node/0.0.2");
    expect(upstream?.headers.get("anthropic-version")).toBe("2023-06-01");
    expect(upstream?.headers.get("x-renter-tracking")).toBeNull();
    expect(upstream?.headers.get("authorization")).toBeNull();

    // The credential and owner-identifying headers never reach the gateway.
    expect(gateway.raw.some((f) => f.includes(TEST_CREDENTIAL))).toBe(false);
    expect(gateway.raw.some((f) => f.includes("org-secret-owner"))).toBe(false);
  });

  it("serves concurrent requests over one socket", async () => {
    await connectAndOpen();
    for (const id of ["c1", "c2", "c3"]) {
      gateway.send(proxyRequest(id));
    }
    const ends = await Promise.all(["c1", "c2", "c3"].map(terminal));
    expect(ends.every((f) => f._tag === "ResponseEnd")).toBe(true);
    expect(gateway.handshakes).toHaveLength(1);
  });

  it("reads usage from a non-streaming JSON response", async () => {
    await connectAndOpen();
    anthropic.mode = "json";
    gateway.send(proxyRequest("j1"));
    const end = await terminal("j1");
    expect(end).toEqual({
      _tag: "ResponseEnd",
      requestId: "j1",
      usage: {
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        inputTokens: 11,
        model: "claude-test-1",
        outputTokens: 7,
      },
    });
  });

  it("refuses paths outside the allowlist without calling the provider", async () => {
    await connectAndOpen();
    gateway.send(proxyRequest("p1", { path: "/v1/models" }));
    gateway.send(proxyRequest("p2", { path: "/v1/messages/../files" }));
    gateway.send(
      proxyRequest("p3", { path: "/v1/chat/completions", provider: "openai" })
    );
    const refusals = await Promise.all(["p1", "p2", "p3"].map(terminal));
    for (const refusal of refusals) {
      expect(refusal).toMatchObject({
        _tag: "ResponseError",
        code: "not_allowed",
      });
    }
    expect(anthropic.requests).toHaveLength(0);
  });

  it("aborts the upstream request on CancelRequest", async () => {
    await connectAndOpen();
    anthropic.mode = "hang";
    gateway.send(proxyRequest("x1"));
    await waitFor(
      () => forRequest(gateway, "x1").some((f) => f._tag === "ResponseChunk"),
      "first chunk"
    );
    gateway.send({ _tag: "CancelRequest", requestId: "x1" });
    expect(await terminal("x1")).toMatchObject({
      _tag: "ResponseError",
      code: "cancelled",
    });
    await waitFor(() => anthropic.aborted > 0, "upstream abort");
  });

  it("reports the usage seen so far when the request is cancelled mid-stream", async () => {
    await connectAndOpen();
    anthropic.mode = "hang";
    gateway.send(proxyRequest("x2"));
    await waitFor(
      () => forRequest(gateway, "x2").some((f) => f._tag === "ResponseChunk"),
      "first chunk"
    );
    gateway.send({ _tag: "CancelRequest", requestId: "x2" });
    // Only message_start arrived: its usage is what the provider reported so far.
    expect(await terminal("x2")).toEqual({
      _tag: "ResponseError",
      code: "cancelled",
      message: "request cancelled",
      requestId: "x2",
      usage: {
        cacheReadTokens: 5,
        cacheWriteTokens: 3,
        inputTokens: 25,
        model: "claude-test-1",
        outputTokens: 1,
      },
    });
  });

  it("sends no usage on a cancel before the provider answered", async () => {
    await connectAndOpen();
    anthropic.mode = "hang";
    gateway.send(proxyRequest("x3"));
    gateway.send({ _tag: "CancelRequest", requestId: "x3" });
    const end = await terminal("x3");
    expect(end).toMatchObject({ _tag: "ResponseError", code: "cancelled" });
    expect(end._tag === "ResponseError" && end.usage).toBeFalsy();
  });

  it("maps 429 to provider_rate_limited and trips the circuit breaker", async () => {
    await connectAndOpen();
    anthropic.mode = "rate_limited";
    gateway.send(proxyRequest("l1"));
    expect(await terminal("l1")).toMatchObject({
      _tag: "ResponseError",
      code: "provider_rate_limited",
    });
    expect(anthropic.requests).toHaveLength(1);

    anthropic.mode = "stream";
    gateway.send(proxyRequest("l2"));
    expect(await terminal("l2")).toMatchObject({
      _tag: "ResponseError",
      code: "provider_rate_limited",
    });
    // Refused locally: the provider was not called again.
    expect(anthropic.requests).toHaveLength(1);
    await waitFor(
      () => Object.keys(agent?.status()?.circuitOpenUntil ?? {}).length > 0,
      "status shows cool-off"
    );
  });
});

describe("fail closed", () => {
  it("refuses while closed and toggles the wake lock with availability", async () => {
    agent = startAgent(testConfig(gateway.url, anthropic.baseUrl));
    await waitFor(() => gateway.connections() > 0, "connection");
    gateway.send(proxyRequest("f1"));
    expect(await terminal("f1")).toMatchObject({
      _tag: "ResponseError",
      code: "node_closed",
    });

    open();
    await waitFor(
      () => agent?.status()?.wakeLockHeld === true,
      "wake lock held"
    );
    gateway.send({
      _tag: "SetAvailability",
      open: false,
      sessionCutoffPct: 90,
      weeklyCutoffPct: 90,
    });
    await waitFor(
      () => agent?.status()?.wakeLockHeld === false,
      "wake lock released"
    );
    expect(anthropic.requests).toHaveLength(0);
  });

  it("refuses with meters_unreadable when the provider exposes no meters", async () => {
    anthropic.sessionUtilization = null;
    agent = startAgent(testConfig(gateway.url, anthropic.baseUrl));
    await waitFor(() => gateway.connections() > 0, "connection");
    open();
    await waitFor(
      () => framesOf(gateway, "Heartbeat").length >= 2,
      "heartbeats"
    );
    gateway.send(proxyRequest("m1"));
    expect(await terminal("m1")).toMatchObject({
      _tag: "ResponseError",
      code: "meters_unreadable",
    });
    expect(anthropic.requests).toHaveLength(0);
  });

  it("refuses with meters_unreadable when the reading is stale", async () => {
    const staleMeters = fixedMeters({
      readAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      sessionResetsAt: null,
      sessionUsedPct: 1,
      weeklyResetsAt: null,
      weeklyUsedPct: 1,
    });
    agent = startAgent(testConfig(gateway.url, anthropic.baseUrl), {
      meters: staleMeters,
    });
    await waitFor(() => gateway.connections() > 0, "connection");
    open();
    await sleep(50);
    gateway.send(proxyRequest("s1"));
    expect(await terminal("s1")).toMatchObject({
      _tag: "ResponseError",
      code: "meters_unreadable",
    });
  });

  it("refuses with cutoff_reached at the cut-off minus the safety margin", async () => {
    anthropic.sessionUtilization = 0.8;
    agent = startAgent(testConfig(gateway.url, anthropic.baseUrl));
    await waitFor(() => gateway.connections() > 0, "connection");
    // 80% used, cut-off 82% - 3 point margin = 79% => refuse.
    open(82, 95);
    await waitFor(
      () => framesOf(gateway, "Heartbeat").some((h) => h.meters.length > 0),
      "meters"
    );
    gateway.send(proxyRequest("k1"));
    expect(await terminal("k1")).toMatchObject({
      _tag: "ResponseError",
      code: "cutoff_reached",
    });

    // Raising the cut-off re-admits requests.
    open(90, 95);
    await sleep(50);
    gateway.send(proxyRequest("k2"));
    expect(await terminal("k2")).toMatchObject({ _tag: "ResponseEnd" });
  });
});
