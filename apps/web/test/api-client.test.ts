import { beforeEach, describe, expect, it, vi } from "vitest";

import { callApi } from "@/lib/api/client";

const BASE = "http://api.test";

const json = (status: number, body: unknown) => Response.json(body, { status });

type Responder = (
  url: string,
  init?: RequestInit
) => Response | Promise<Response>;

let responder: Responder = () => json(500, {});

/**
 * Effect's FetchHttpClient reads globalThis.fetch once, so the stub is
 * installed once and each test swaps what it answers.
 */
const fetchMock = vi.fn(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    return await responder(url, init);
  }
);
vi.stubGlobal("fetch", fetchMock);

const stubFetch = (respond: Responder) => {
  responder = respond;
  return fetchMock;
};

beforeEach(() => {
  fetchMock.mockClear();
});

const totals = (paidUsdc: string) => ({
  inputTokens: 1000,
  outputTokens: 200,
  paidUsdc,
  requests: 3,
});

describe("callApi (contract-derived client)", () => {
  it("decodes micros strings to bigint and instants to Date", async () => {
    stubFetch((url) =>
      url.endsWith("/owner/sales")
        ? json(200, {
            last24h: totals("4250000"),
            lifetime: totals("9007199254740993123"),
            recent: [],
          })
        : json(200, {
            nodes: [
              {
                connectedAt: null,
                createdAt: new Date(0).toISOString(),
                detectedPlans: {},
                id: "7f2c0000-0000-4000-8000-000000000419",
                lastHeartbeatAt: null,
                mode: "owner_hosted",
                region: null,
                status: "offline",
                version: null,
              },
            ],
            providerAccounts: [],
          })
    );
    const sales = await callApi((api) => api.owner.sales(), { baseUrl: BASE });
    const dashboard = await callApi((api) => api.owner.dashboard(), {
      baseUrl: BASE,
    });
    expect(sales.ok && dashboard.ok).toBe(true);
    if (!(sales.ok && dashboard.ok)) {
      return;
    }
    expect(sales.data.lifetime.paidUsdc).toBe(9_007_199_254_740_993_123n);
    expect(sales.data.last24h.paidUsdc).toBe(4_250_000n);
    const [node] = dashboard.data.nodes;
    expect(node?.createdAt).toBeInstanceOf(Date);
    expect(node?.createdAt.getTime()).toBe(0);
  });

  it("keeps a path prefix in the base URL (the browser's /api proxy)", async () => {
    const calls = stubFetch(() =>
      json(401, { _tag: "Unauthorized", message: "no" })
    );
    await callApi((api) => api.auth.me(), {
      baseUrl: "https://rentanllm.vercel.app/api",
    });
    const [url] = calls.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://rentanllm.vercel.app/api/auth/me");
  });

  it("encodes bigint payloads as decimal strings and sends credentials", async () => {
    const calls = stubFetch(() =>
      json(422, { _tag: "InvalidRequest", message: "nope" })
    );
    await callApi(
      (api) =>
        api.owner.updateListing({
          params: { listingId: "11110000-0000-4000-8000-000000000001" },
          payload: { priceInPerMtokUsdc: 1_600_000n },
        }),
      { baseUrl: BASE }
    );
    const [url, init] = calls.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      `${BASE}/owner/listings/11110000-0000-4000-8000-000000000001`
    );
    expect(init?.method).toBe("PATCH");
    expect(init?.credentials).toBe("include");
    const headers = new Headers(init?.headers);
    expect(headers.has("traceparent")).toBe(false);
    expect(headers.has("b3")).toBe(false);
    const body = init?.body;
    const text =
      body instanceof Uint8Array
        ? new TextDecoder().decode(body)
        : String(body);
    expect(JSON.parse(text)).toEqual({ priceInPerMtokUsdc: "1600000" });
  });

  it("maps a 404 NotFound to a plain error", async () => {
    stubFetch(() =>
      json(404, { _tag: "NotFound", message: "No such listing" })
    );
    const result = await callApi(
      (api) =>
        api.owner.pauseListing({
          params: { listingId: "11110000-0000-4000-8000-000000000001" },
        }),
      { baseUrl: BASE }
    );
    expect(result).toEqual({
      error: { kind: "NotFound", message: "No such listing" },
      ok: false,
    });
  });

  it("maps 401 from the session middleware", async () => {
    stubFetch(() => json(401, { _tag: "Unauthorized", message: "No session" }));
    const result = await callApi((api) => api.auth.me(), { baseUrl: BASE });
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.kind).toBe("Unauthorized");
  });

  it("forwards a cookie header when given one (server components)", async () => {
    const calls = stubFetch(() =>
      json(401, { _tag: "Unauthorized", message: "x" })
    );
    await callApi((api) => api.auth.me(), {
      baseUrl: BASE,
      cookie: "rentanllm_session=abc",
    });
    const [, init] = calls.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).get("cookie")).toBe(
      "rentanllm_session=abc"
    );
  });

  it("reports network failures", async () => {
    stubFetch(async () => await Promise.reject(new TypeError("fetch failed")));
    const result = await callApi((api) => api.auth.me(), { baseUrl: BASE });
    expect(result.ok ? null : result.error.kind).toBe("Network");
  });
});
