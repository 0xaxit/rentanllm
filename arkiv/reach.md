# Reach

> Draft: the team should edit this before submitting.

**Who it's for:**

- **AI agents** that need inference on demand and can pay per request (x402), but have no account or API key.
- **People with a GPU** and Ollama who want to sell spare capacity.

**Can they try it today:**

- **Agents:** call `POST /v1/chat/completions` on the gateway, or add the MCP server (`apps/mcp`) to Claude Desktop, Claude Code or Cursor.
- **Sellers:** run `ral start … --ollama-model llama3.1:8b`.
- **Anyone:** read the market from Arkiv with `bun packages/arkiv/scripts/query.ts`.

**After Mumbai:** TODO (team).

**Numbers:** TODO (sellers, models listed, paid requests) once it is live.
