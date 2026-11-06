# Reach

**Who it's for:**

- **AI agents** that need inference on demand and can pay per request (x402), but have no account or API key.
- **People with a GPU** and Ollama who want to sell spare capacity.

**Can they try it today:**

- **Agents:** call `POST /v1/chat/completions` on the gateway, or add the MCP server (`apps/mcp`) to Claude Desktop, Claude Code or Cursor.
- **Sellers:** run `ral start … --ollama-model llama3.1:8b`.
- **Anyone:** read the market from Arkiv with `bun packages/arkiv/scripts/query.ts`.

## Will we keep building it after Mumbai?

Yes. RentAnLLM answers a need that exists without us: people and agents who want to use an LLM without handing over who they are.

**The problem today.** Every major AI API asks for an account, an email and a card, and ties every prompt to that identity. That shuts out the people who most want privacy, and it shuts out AI agents, which can't sign up for anything. Meanwhile, plenty of people have a GPU and Ollama sitting idle, with no simple way to earn from it.

**What we built is already the whole loop.** An agent with nothing but a Hedera wallet can find a model, see the price, pay the seller directly in USDC and get the answer. No account, no API key, no sign-up, and the gateway never holds the money. It runs in production today: a seller node, paid requests settling on Hedera testnet, and Claude Desktop buying answers through our MCP server.

**Why that keeps working as it grows:**

- **Sellers bring the supply.** Anyone can run the node agent next to Ollama and list a model, so adding capacity needs no deal with us.
- **Payment replaces sign-up.** x402 means each request is paid for on its own, so there's nothing to register and nothing to revoke.
- **Arkiv keeps the market honest.** Offers and receipts are public on Arkiv, so agents and other front-ends can read prices and sales without trusting our API, and a market that grows doesn't become a black box.
- **The guard-rails are in place.** Spending caps, budgets per seller, an HCS audit log and on-chain seller reputation are already built, so agents can be given a wallet without being given a blank cheque.

**Next after Mumbai:**

- More sellers and more models on the market than our one demo node.
- Moving from testnet to mainnet USDC once the payment path has run in the open for a while.
- More of the market readable straight from Arkiv, so other apps can build on the same order book.

**Numbers** (production, as of 7 Nov 2026):

- **1 seller** with 1 node, listing `llama3.1:8b` on Ollama, with 99.97% uptime over 24 hours.
- **12 paid requests**, all settled in USDC on Hedera testnet, from 2 buyer accounts. Together they paid 360 micro-USDC ($0.00036). The first was on 6 Nov at 5:24 AM IST and the latest on 6 Nov at 9:03 PM IST.
- **1 agent wallet** created for Claude Desktop, and 7 MCP clients registered through OAuth.
- **On Arkiv:** 1 live offer from the current writer `0x7A67…20F8`. Its receipts start with the next paid request, because the writer wallet is new.
