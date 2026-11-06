# How RentAnLLM uses Arkiv

## What users see

- **Market page, "ON ARKIV · OFFERS":**
  - Every model for sale, read straight from Arkiv with no RentAnLLM API in the path.
  - Each row shows its price, online state and network, and links to its entity on the Rabdi explorer.
  - Code: [`apps/web/lib/arkiv.ts`](../apps/web/lib/arkiv.ts), [`components/market/arkiv-board.tsx`](../apps/web/components/market/arkiv-board.tsx).
- **Market page, "ON ARKIV · RECEIPTS":** the latest paid requests, newest first. Each row shows the amount paid and links to its entity.
- **Claude Desktop, `list_models`:** the remote MCP server answers "what models can I buy?" from the Arkiv board, not from RentAnLLM's database. It groups offers by model, puts online and cheapest first, and tells the user the list came from Arkiv. It falls back to the gateway only if Arkiv doesn't answer within 5 seconds.
  - Code: [`apps/api/src/mcp/arkiv-board.ts`](../apps/api/src/mcp/arkiv-board.ts), [`apps/api/src/mcp/arkiv-models.ts`](../apps/api/src/mcp/arkiv-models.ts).
- **For agents and judges:** `bun packages/arkiv/scripts/query.ts [writer] [model]` reads the same data from the command line, with no account.

## Does each feature fit what the app does?

- **Filters match how people browse:**
  - Buyers look for a model, then the cheapest online seller of it.
  - So `model`, `online` and `priceOut` are indexed.
  - The payee and the gateway URL are only displayed, so they are stored but not indexed.
- **Who can edit:** only the gateway's writer. Readers trust that one owner (`ownedBy`), so a third party writing a fake offer under the same schema name is ignored.
- **Expiry matches the market:**
  - An offer is only true while its seller is listed, so it lives 15 minutes and is refreshed every 3.
  - A seller that goes away disappears from Arkiv without anyone deleting it.
  - Receipts are history buyers and sellers look back on, so they keep 30 days.
- **One transaction per sync:** `executeBatch` creates, patches, extends and deletes the whole offer set at once. Readers never see half a sync.

## Query to run

```sh
bun packages/arkiv/scripts/query.ts 0x7A67B250ECa8Ed822B8439b331f8Eff22c1C20F8 llama3.1:8b
```

Or with the SDK:

```ts
publicClient
  .select({ $key: true, model: true, priceOut: true, online: true })
  .from(OfferSchema)
  .where(eq("model", "llama3.1:8b"))
  .ownedBy("0x7A67B250ECa8Ed822B8439b331f8Eff22c1C20F8")
  .orderBy(asc("priceOut"))
  .fetch();
```
