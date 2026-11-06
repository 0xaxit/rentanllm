# Reach

**Who it's for:**

- **AI agents** that need inference on demand and can pay per request (x402), but have no account or API key.
- **People with a GPU** and Ollama who want to sell spare capacity.

**Can they try it today:**

- **Agents:** call `POST /v1/chat/completions` on the gateway, or add the MCP server (`apps/mcp`) to Claude Desktop, Claude Code or Cursor.
- **Sellers:** run `ral start … --ollama-model llama3.1:8b`.
- **Anyone:** read the market from Arkiv with `bun packages/arkiv/scripts/query.ts`.

**After Mumbai:** yes, we will keep building it. People want to use LLMs without handing over who they are, and RentAnLLM lets them: no account, no API key and no sign-up, just a wallet that pays per request. Arkiv keeps the market's offers and receipts public as it grows.

**Numbers** (production, as of 7 Nov 2026):

- **1 seller** with 1 node, listing `llama3.1:8b` on Ollama, with 99.97% uptime over 24 hours.
- **12 paid requests**, all settled in USDC on Hedera testnet, from 2 buyer accounts. Together they paid 360 micro-USDC ($0.00036). The first was on 6 Nov at 5:24 AM IST and the latest on 6 Nov at 9:03 PM IST.
- **1 agent wallet** created for Claude Desktop, and 7 MCP clients registered through OAuth.
- **On Arkiv:** 1 live offer from the current writer `0x7A67…20F8`. Its receipts start with the next paid request, because the writer wallet is new.
