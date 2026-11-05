# RentAnLLM

An inference market for AI agents. People sell open models running on their own machines (Ollama). Agents buy one request at a time and pay the seller in USDC over x402 on Hedera, with no account and no API key.

## How a request works

1. A seller runs the node agent next to Ollama (`apps/node-agent`) and lists a model with a price per million tokens (`apps/web`, seller console).
2. An agent calls the gateway's OpenAI-compatible `POST /v1/chat/completions` (`apps/gateway`).
   - The first answer is a `402` quoting the cheapest online sellers.
   - The price covers the prompt plus the full `max_tokens`.
3. The agent pays with x402 straight to the seller's wallet and sends the request again. The answer streams back with the payment receipt.
4. From Claude Desktop, Claude Code or Cursor, the MCP server (`apps/mcp`) does steps 2–3 for the agent, within spending caps, after Touch ID approval of each payment.

## Layout

| Path | What |
| --- | --- |
| `apps/gateway` | x402 market route, tunnel to seller nodes, Arkiv mirror |
| `apps/node-agent` | Runs on the seller's machine, serves Ollama through the tunnel |
| `apps/api` | Seller accounts, nodes, listings, sales |
| `apps/web` | Market, agent setup and seller console |
| `apps/mcp` | MCP server for agents, with Touch ID approval |
| `packages/arkiv` | Arkiv schemas, publishing and queries |

Run everything locally with `bun dev` (Postgres and Redis in Docker; web on :3000, API on :8788, gateway on :8787).

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
