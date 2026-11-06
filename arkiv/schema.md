# Arkiv schema

RentAnLLM's gateway writes two entity types to Arkiv's Rabdi testnet (chain 7794095) with `@arkiv-network/sdk` 1.0. Both schemas live in [`packages/arkiv/src/index.ts`](../packages/arkiv/src/index.ts).

**Writer and owner:** `0x7A67B250ECa8Ed822B8439b331f8Eff22c1C20F8` (the gateway). It creates, patches and deletes every entity. Readers filter with `ownedBy(writer)`, because anyone can write entities under the same schema names.

## `rentanllm.offer`

One entity per (listing, model) for sale right now.

| Field | Type | Indexed | Holds |
| --- | --- | --- | --- |
| `id` | str | yes | `${listing}:${model}`, unique per offer |
| `kind` | str | yes | `chat` or `image`; entities written before it read as `chat` |
| `listing` | str | yes | The seller's listing id |
| `model` | str | yes | Model name, e.g. `llama3.1:8b` or `flux-2-klein-4b` |
| `network` | str | yes | CAIP-2 network buyers pay on, e.g. `hedera:testnet` |
| `online` | bool | yes | Whether the seller's node was connected at the last sync |
| `priceIn` | u64 | yes | Micro-USDC per million input tokens |
| `priceOut` | u64 | yes | Micro-USDC per million output tokens; for an image model, per image |
| `payTo` | str | no | Who the payment goes to (Hedera `0.0.x` account or EVM address) |
| `url` | str | no | The gateway endpoint to send the request to |

**Expiry:** 15 minutes. The gateway re-publishes every 3 minutes (`ARKIV_SYNC_SECONDS`) in one transaction:

- Existing offers are patched and their TTL restarts.
- New offers are created.
- Offers no longer listed are deleted.

If the gateway stops, every offer expires by itself within 15 minutes, so a stale price never outlives its seller.

**Queried by:** `model` (what is for sale), `online`, and `priceOut` (cheapest first).

## `rentanllm.receipt`

One entity per paid request.

| Field | Type | Indexed | Holds |
| --- | --- | --- | --- |
| `requestId` | str | yes | The gateway's request id |
| `listing` | str | yes | Listing that served it |
| `model` | str | yes | Model that answered |
| `network` | str | yes | Network the payment settled on |
| `payTo` | str | yes | Seller paid |
| `paid` | u64 | yes | Micro-USDC paid before the request ran |
| `status` | str | yes | `ok`, `error` or `cancelled` |
| `at` | u64 | yes | Unix milliseconds |
| `paymentTx` | str | no | Settlement transaction (EVM hash or Hedera transaction id) |
| `inputTokens` | u64 | no | Prompt tokens used |
| `outputTokens` | u64 | no | Output tokens used |

**Expiry:** 30 days.

**Queried by:** `at` (newest first), and by `payTo` or `model` for one seller's or one model's history.
