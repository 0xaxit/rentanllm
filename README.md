# RentAnLLM

An inference market for AI agents. People sell open models running on their own machines (Ollama). Agents buy one request at a time and pay the seller in USDC over x402 on Hedera, with no account and no API key.

## How a request works

1. A seller runs the node agent next to Ollama (`apps/node-agent`) and lists a model with a price per million tokens (`apps/web`, seller console).
2. An agent calls the gateway's OpenAI-compatible `POST /v1/chat/completions` (`apps/gateway`).
   - The first answer is a `402` quoting the cheapest online sellers.
   - The price covers the prompt plus the full `max_tokens`.
3. The agent pays with x402 straight to the seller's wallet and sends the request again. The answer streams back with the payment receipt.
4. From Claude Desktop, Claude Code or Cursor, the MCP server (`apps/mcp`) does steps 2–3 for the agent, within spending caps. Small payments can go through on their own, and the person confirms anything above a set amount (or every payment, with Touch ID).

## Layout

| Path | What |
| --- | --- |
| `apps/gateway` | x402 market route, tunnel to seller nodes, Arkiv mirror |
| `apps/node-agent` | Runs on the seller's machine, serves Ollama through the tunnel |
| `apps/api` | Seller accounts, nodes, listings, sales |
| `apps/web` | Market, agent setup and seller console |
| `apps/mcp` | MCP server for agents: spending caps, approval above a threshold, autonomous buyer |
| `packages/arkiv` | Arkiv schemas, publishing and queries |

Run everything locally with `bun dev` (Postgres and Redis in Docker; web on :3000, API on :8788, gateway on :8787).

## Payments on Hedera (x402)

Every paid request settles as one USDC transfer on Hedera testnet, straight from the agent's account to the seller's. The gateway never holds the money.

|  |  |
| --- | --- |
| Endpoint | `POST https://gw.31-97-230-118.sslip.io/v1/chat/completions` (OpenAI-compatible; `GET /v1/models` lists what is for sale) |
| Network | `hedera:testnet` (x402 v2, scheme `exact`) |
| Asset | Circle's testnet USDC, HTS token [`0.0.429274`](https://hashscan.io/testnet/token/0.0.429274) (6 decimals) |
| Facilitator | [x402.org](https://x402.org/facilitator). Its account `0.0.9185802` submits the transfer and pays the HBAR fee, so agents need only USDC |

### Payment flow

```
agent                         gateway                      facilitator           Hedera
  │ POST /v1/chat/completions    │                              │                     │
  │─────────────────────────────▶│ prices prompt + max_tokens   │                     │
  │◀───── 402 PAYMENT-REQUIRED ──│ payTo = seller 0.0.x          │                     │
  │ signs a USDC TransferTransaction (buyer → seller)            │                     │
  │ POST again + PAYMENT-SIGNATURE                               │                     │
  │─────────────────────────────▶│ checks amount/payTo/asset     │                     │
  │                              │──── verify, settle ─────────▶│── submits transfer ─▶│
  │                              │◀──────── transaction id ─────│◀──── SUCCESS ────────│
  │                              │ tunnels the prompt to the seller's Ollama node       │
  │◀── answer + PAYMENT-RESPONSE (receipt with the transaction id) ─│                    │
```

1. The gateway answers an unpaid request with `402` and x402 terms: amount (micro-USDC), `payTo` (the seller's Hedera account), the asset and the facilitator's `feePayer`.
2. The agent signs a Hedera `TransferTransaction` moving exactly that amount of USDC to the seller, and retries with it in the `PAYMENT-SIGNATURE` header.
3. The gateway checks that the payment matches its terms, then has the facilitator verify and settle it on Hedera.
4. Only after settlement is the prompt sent to the seller's node. The answer comes back with a `PAYMENT-RESPONSE` receipt carrying the Hedera transaction id.

### An agent paying with no human in the loop

`apps/mcp` includes an autonomous buyer (`rentanllm-mcp agent`). It finds the model on the market, reads the 402, checks its spending caps (per request and per 24 hours), signs the payment and prints the answer. Nobody approves anything:

```sh
bun install
cd apps/mcp
RENTANLLM_GATEWAY_URL=https://gw.31-97-230-118.sslip.io \
RENTANLLM_MCP_ACCOUNT=<your 0.0.x account> \
RENTANLLM_MCP_APPROVAL=none \
RENTANLLM_MCP_KEY_FILE=<file with its ECDSA private key> \
bun src/main.ts agent --max-tokens 64 "In one sentence, what is Hedera?"
```

The paying account needs testnet USDC (https://faucet.circle.com, Hedera Testnet) and must be associated with `0.0.429274`. It needs no HBAR for payments.

### A settled payment

One run of the command above, on 6 Nov 2026:

- **Transaction:** [`0.0.9185802@1793922799.072231068`](https://hashscan.io/testnet/transaction/0.0.9185802%401793922799.072231068) (`SUCCESS`)
- **Transfer:** 0.000014 USDC from the agent `0.0.11331175` to the seller `0.0.11331176`
- **Fee:** paid in HBAR by the facilitator `0.0.9185802`
- **Answer:** 19 prompt tokens and 40 answer tokens from `llama3.1:8b`, served from the seller's own machine

### Spending limits and the audit log

- **Limits:** a buyer signs in on `/budget` with the wallet behind their paying Hedera account. There they set a 24-hour budget, a max per request, a 24-hour limit per seller, a seller allowlist, or a pause. The gateway checks these after the facilitator verifies a payment and **before it settles**. A payment over a limit gets a 402 with the reason, and no USDC moves, whatever client sent it.
- **Audit log:** every settled payment is posted as one message to the Hedera Consensus Service topic [`0.0.11332573`](https://hashscan.io/testnet/topic/0.0.11332573). Only the platform's submit key can post to it. Hedera gives each message a consensus timestamp, a sequence number and a running hash that chains it to every earlier message, so the log cannot be edited or trimmed without it showing. Each payment on `/budget` links to its message.

To read one buyer's spending straight from a mirror node (no account or key needed):

```sh
bun scripts/hcs-audit.ts 0.0.11331175
```

## Arkiv

The gateway writes the live offers and one receipt per paid request to Arkiv's Rabdi testnet. The market page reads them back from Arkiv. See [`arkiv/`](arkiv/) for the schema and how each part is used.

- **Writer wallet:** `0x9d8942916A81159596BD37384403d90466e8E84b`
- **Query to run** (no account or key needed):

  ```sh
  bun install
  bun packages/arkiv/scripts/query.ts 0x9d8942916A81159596BD37384403d90466e8E84b
  ```

## AI use

Much of this code was written with Claude Code (Anthropic), under the team's direction and review.
