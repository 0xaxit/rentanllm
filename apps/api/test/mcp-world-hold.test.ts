/**
 * The hosted connector with a World ID threshold, end to end over MCP: a payment above
 * the user's limit is held with World's link and nothing reaches the seller; calling the
 * tool again pays only after World ID approved it; a refused approval pays nothing.
 * The gateway (402 + paid answer) is faked at `fetch`; World ID at the HostedWorld seam.
 */
import { randomBytes } from "node:crypto";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildMcpServer } from "../src/mcp/server";
import type { HostedWorld, SettleOutcome } from "../src/mcp/world-gate";

const GATEWAY = "https://gw.test";
const PAY_TO = "0.0.4242";
const TX = "0.0.9185802@1793000000.000000001";
const PRICE = 12_300n;
const APPROVAL_ID = "8d6f3a52-3b1c-4b7e-9a51-6f1f0c2d9e11";
const ID_IN_TEXT = /world_approval_id "(?<id>[^"]+)"/u;

/** x402 headers are base64 JSON (what @x402/core's encoders produce). */
const encodePaymentRequiredHeader = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64");
const encodePaymentResponseHeader = encodePaymentRequiredHeader;

const json = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
) => Response.json(body, { headers, status });

const setUp = async (options: {
  readonly above: bigint | null;
  readonly settle?: SettleOutcome;
}) => {
  const events: string[] = [];
  vi.stubGlobal(
    "fetch",
    (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url !== `${GATEWAY}/v1/chat/completions`) {
        return Promise.resolve(json(404, {}));
      }
      if (!new Headers(init?.headers).has("payment-signature")) {
        return Promise.resolve(
          json(
            402,
            {},
            {
              "payment-required": encodePaymentRequiredHeader({
                accepts: [
                  {
                    amount: PRICE.toString(),
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
          )
        );
      }
      events.push("paid");
      return Promise.resolve(
        json(
          200,
          {
            choices: [{ message: { content: "Llamas run about 35 mph." } }],
            usage: { completion_tokens: 8, prompt_tokens: 9 },
          },
          {
            "payment-response": encodePaymentResponseHeader({
              network: "hedera:testnet",
              success: true,
              transaction: TX,
            }),
          }
        )
      );
    }
  );
  const world: HostedWorld = {
    approvalAbove: () => Promise.resolve(options.above),
    cancel: (id) => {
      events.push("cancel");
      return Promise.resolve(`Cancelled payment ${id}. Nothing was paid.`);
    },
    hold: (input) => {
      events.push(`hold ${input.amountMicros} to ${input.payTo}`);
      return Promise.resolve({
        expiresAt: new Date(Date.now() + 600_000),
        id: APPROVAL_ID,
        link: "https://sandbox.auth.world.org/authorize?transaction_id=t1",
        userCode: "ABCD-EFGH",
      });
    },
    settle: (input) => {
      events.push(`settle ${input.amountMicros} to ${input.payTo}`);
      return Promise.resolve(options.settle ?? { kind: "approved" });
    },
  };
  const server = buildMcpServer({
    arkivOffers: () => Promise.resolve(null),
    balance: () => Promise.resolve(null),
    gatewayUrl: GATEWAY,
    icon: { sizes: ["192x192"], src: "https://api.example/icon.png" },
    recent: () => Promise.resolve([]),
    signer: () =>
      Promise.resolve({
        accountId: "0.0.1111",
        privateKeyHex: randomBytes(32).toString("hex"),
      }),
    walletPage: "https://rentanllm.example/budget",
    world,
  });
  const client = new Client({ name: "test", version: "1" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ arguments: args, name });
    const content = result.content as { text?: string }[];
    return content.map((c) => c.text ?? "").join("\n");
  };
  return { call, events };
};

const ASK = {
  max_tokens: 64,
  model: "llama3.1:8b",
  prompt: "How fast do llamas run?",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hosted connector with a World ID limit", () => {
  it("pays straight away below the user's limit", async () => {
    const { call, events } = await setUp({ above: 20_000n });
    expect(await call("buy_inference", ASK)).toContain(
      "Llamas run about 35 mph."
    );
    expect(events).toEqual(["paid"]);
  });

  it("holds a payment above the limit, then pays once World ID approved it", async () => {
    const { call, events } = await setUp({ above: 1000n });
    const held = await call("buy_inference", ASK);
    expect(held).toContain("Not paid yet: 0.0123 USDC to 0.0.4242");
    expect(held).toContain("ABCD-EFGH");
    expect(events).toEqual([`hold ${PRICE} to ${PAY_TO}`]);

    const id = ID_IN_TEXT.exec(held)?.groups?.id;
    expect(id).toBe(APPROVAL_ID);
    const paid = await call("buy_inference", { ...ASK, world_approval_id: id });
    expect(paid).toContain("Llamas run about 35 mph.");
    // World's approval was used for exactly this payment before anything was paid.
    expect(events).toEqual([
      `hold ${PRICE} to ${PAY_TO}`,
      `settle ${PRICE} to ${PAY_TO}`,
      "paid",
    ]);
  });

  it("pays nothing when World ID refused the approval", async () => {
    const { call, events } = await setUp({
      above: 1000n,
      settle: { kind: "refused", reason: "the World ID approval was denied" },
    });
    const text = await call("buy_inference", {
      ...ASK,
      world_approval_id: APPROVAL_ID,
    });
    expect(text).toBe(
      "Not paid: the World ID approval was denied. Nothing was signed."
    );
    expect(events).not.toContain("paid");
  });

  it("cancels a held payment", async () => {
    const { call, events } = await setUp({ above: 1000n });
    expect(
      await call("cancel_payment", { world_approval_id: APPROVAL_ID })
    ).toBe(`Cancelled payment ${APPROVAL_ID}. Nothing was paid.`);
    expect(events).toEqual(["cancel"]);
  });
});
