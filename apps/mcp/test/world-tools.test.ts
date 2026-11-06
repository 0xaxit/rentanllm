/**
 * The MCP tools in approval mode "world", end to end over an in-memory MCP transport.
 * The gateway (402 + paid answer) and the RentAnLLM approvals API are faked at `fetch`;
 * the signer only records that it ran. What matters: nothing above the threshold is ever
 * signed unless the API has consumed a World ID approval for exactly that payment.
 */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import type { PaymentPayload } from "@x402/core/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "../src/config.ts";
import { registerTools } from "../src/tools.ts";

const GATEWAY = "http://gateway.test";
const API = "http://api.test";
const PAY_TO = "0.0.4242";
const TX = "0.0.9185802@1793671250.931164153";
const SUBJECT = "subject-alice";
const APPROVAL_ID = "4f6b7e1c-1b8e-4a49-9a35-6a8e2f7c0d11";
const LINK = "https://sandbox.auth.world.org/authorize?transaction_id=t1";
const PAYMENT_ID = /payment_id "(?<id>pay_[0-9a-f]+)"/u;

type WorldStatus = "pending" | "approved" | "denied" | "expired" | "cancelled";

interface Harness {
  readonly call: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<string>;
  readonly calls: {
    readonly body: Record<string, unknown>;
    readonly route: string;
  }[];
  /** Order of what happened: create, check, consume, cancel, sign, paid. */
  readonly events: string[];
  readonly stateDir: string;
}

const approvalJson = (status: WorldStatus | "used") => ({
  amountUsdc: "12300",
  createdAt: new Date().toISOString(),
  decidedAt: null,
  description: "d",
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  failureReason: null,
  id: APPROVAL_ID,
  network: "hedera:testnet",
  payTo: PAY_TO,
  payer: "0.0.1111",
  status,
  usedAt: null,
  userCode: "3YKMX-EMG8M",
  verificationUri: "https://sandbox.auth.world.org/device",
  verificationUriComplete: LINK,
  worldSubject: status === "approved" || status === "used" ? SUBJECT : null,
});

const json = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
) => Response.json(body, { headers, status });

const setUp = async (options: {
  readonly amount: bigint;
  readonly consumeConflict?: boolean;
  readonly world: WorldStatus;
}): Promise<Harness> => {
  const events: string[] = [];
  const calls: Harness["calls"] = [];
  const stateDir = mkdtempSync(path.join(tmpdir(), "rentanllm-world-"));
  let status: WorldStatus | "used" = "pending";

  const answer = (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<
      string,
      unknown
    >;
    if (url === `${GATEWAY}/v1/chat/completions`) {
      if (!headers.has("payment-signature")) {
        return json(
          402,
          {},
          {
            "payment-required": encodePaymentRequiredHeader({
              accepts: [
                {
                  amount: options.amount.toString(),
                  asset: "0.0.429274",
                  extra: { feePayer: "0.0.9185802" },
                  maxTimeoutSeconds: 300,
                  network: "hedera:testnet",
                  payTo: PAY_TO,
                  scheme: "exact",
                },
              ],
              resource: {
                description: "",
                mimeType: "application/json",
                url: "",
              },
              x402Version: 2,
            }),
          }
        );
      }
      events.push("paid");
      return json(
        200,
        {
          choices: [{ message: { content: "Hello from llama" } }],
          usage: { completion_tokens: 4, prompt_tokens: 9 },
        },
        {
          "payment-response": encodePaymentResponseHeader({
            network: "hedera:testnet",
            success: true,
            transaction: TX,
          }),
        }
      );
    }
    if (url.startsWith(`${API}/approvals`)) {
      const route = url.slice(`${API}/approvals`.length);
      calls.push({ body, route });
      if (route === "") {
        events.push("create");
        return json(201, {
          approval: approvalJson("pending"),
          secret: "s3cret",
        });
      }
      expect(body.secret).toBe("s3cret");
      if (route.endsWith("/check")) {
        events.push("check");
        if (status === "pending") {
          status = options.world;
        }
        return json(200, approvalJson(status));
      }
      if (route.endsWith("/consume")) {
        events.push("consume");
        if (options.consumeConflict === true || status !== "approved") {
          return json(409, {
            _tag: "Conflict",
            message: "approval was already used",
          });
        }
        status = "used";
        return json(200, approvalJson("used"));
      }
      if (route.endsWith("/cancel")) {
        events.push("cancel");
        status = "cancelled";
        return json(200, approvalJson("cancelled"));
      }
    }
    return json(404, {});
  };
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(answer(input, init))
  );

  const config = loadConfig({
    RENTANLLM_API_URL: API,
    RENTANLLM_GATEWAY_URL: GATEWAY,
    RENTANLLM_MCP_ACCOUNT: "0.0.1111",
    RENTANLLM_MCP_APPROVAL: "world",
    RENTANLLM_MCP_AUTO_APPROVE_USDC: "0.001",
    RENTANLLM_MCP_PRIVATE_KEY: "test-key",
    RENTANLLM_MCP_STATE_DIR: stateDir,
  });
  const server = new McpServer({ name: "rentanllm", version: "test" });
  registerTools(server, config, (_config, key, quote) => {
    events.push("sign");
    expect(key).toBe("test-key");
    return Promise.resolve({
      accepted: quote.terms,
      payload: {},
      x402Version: 2,
    } as unknown as PaymentPayload);
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "test" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ arguments: args, name });
    const content = result.content as { text: string }[];
    return content.map((part) => part.text).join("\n");
  };
  return { call, calls, events, stateDir };
};

const BUY = { max_tokens: 64, model: "llama3.1:8b", prompt: "Hi" };

const heldPaymentId = (text: string): string => {
  const id = PAYMENT_ID.exec(text)?.groups?.id;
  expect(id).toBeDefined();
  return id ?? "";
};

const approve = (h: Harness, id: string) =>
  h.call("approve_payment", {
    amount_usdc: "0.0123",
    pay_to: PAY_TO,
    payment_id: id,
  });

describe("World ID approval mode", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pays at once up to the threshold, without asking World", async () => {
    const h = await setUp({ amount: 900n, world: "approved" });
    const text = await h.call("buy_inference", BUY);
    expect(text).toContain("Hello from llama");
    expect(h.events).toEqual(["sign", "paid"]);
  });

  it("holds a larger payment and shows World's link, signing nothing", async () => {
    const h = await setUp({ amount: 12_300n, world: "approved" });
    const text = await h.call("buy_inference", BUY);
    expect(text).toContain(LINK);
    expect(text).toContain("3YKMX-EMG8M");
    expect(text).not.toContain("s3cret");
    expect(h.events).toEqual(["create"]);
    expect(h.calls[0]?.body).toMatchObject({
      amountUsdc: "12300",
      payTo: PAY_TO,
      payer: "0.0.1111",
    });
  });

  it("pays only after World ID approves and the API consumes the approval", async () => {
    const h = await setUp({ amount: 12_300n, world: "approved" });
    const id = heldPaymentId(await h.call("buy_inference", BUY));
    const text = await approve(h, id);
    expect(text).toContain("Hello from llama");
    expect(text).toContain(TX);
    expect(h.events).toEqual(["create", "check", "consume", "sign", "paid"]);
    // The approval is spent once; the hold is gone.
    expect(await approve(h, id)).toContain("no payment");
    // The person who approved is pinned, and asked for next time.
    const pinned = path.join(h.stateDir, "world-subject");
    expect(readFileSync(pinned, "utf-8").trim()).toBe(SUBJECT);
    await h.call("buy_inference", BUY);
    expect(h.calls.at(-1)?.body.expectedSubject).toBe(SUBJECT);
  });

  it.each(["denied", "expired"] as const)(
    "never signs when the World ID approval is %s",
    async (status) => {
      const h = await setUp({ amount: 12_300n, world: status });
      const id = heldPaymentId(await h.call("buy_inference", BUY));
      const text = await approve(h, id);
      expect(text).toContain(`Not paid: the World ID approval was ${status}`);
      expect(h.events).toEqual(["create", "check"]);
      expect(await approve(h, id)).toContain("no payment");
      expect(existsSync(path.join(h.stateDir, "world-subject"))).toBe(false);
    }
  );

  it("never signs a cancelled payment, even if World approves it afterwards", async () => {
    const h = await setUp({ amount: 12_300n, world: "approved" });
    const id = heldPaymentId(await h.call("buy_inference", BUY));
    expect(await h.call("cancel_payment", { payment_id: id })).toContain(
      "Nothing was paid"
    );
    expect(await approve(h, id)).toContain("no payment");
    expect(h.events).toEqual(["create", "cancel"]);
  });

  it("never signs when the API refuses to consume the approval", async () => {
    const h = await setUp({
      amount: 12_300n,
      consumeConflict: true,
      world: "approved",
    });
    const id = heldPaymentId(await h.call("buy_inference", BUY));
    const text = await approve(h, id);
    expect(text).toContain("already used");
    expect(h.events).toEqual(["create", "check", "consume"]);
  });

  it("refuses an approve_payment call for another amount or payee", async () => {
    const h = await setUp({ amount: 12_300n, world: "approved" });
    const id = heldPaymentId(await h.call("buy_inference", BUY));
    const text = await h.call("approve_payment", {
      amount_usdc: "0.5",
      pay_to: PAY_TO,
      payment_id: id,
    });
    expect(text).toContain("not 0.5 USDC");
    expect(h.events).toEqual(["create"]);
  });
});

describe("World ID approval config", () => {
  it("needs the API that validates approvals", () => {
    expect(() =>
      loadConfig({
        RENTANLLM_MCP_ACCOUNT: "0.0.1",
        RENTANLLM_MCP_APPROVAL: "world",
        RENTANLLM_MCP_PRIVATE_KEY: "k",
      })
    ).toThrow("RENTANLLM_API_URL");
  });
});
