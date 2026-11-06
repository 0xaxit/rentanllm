# Arkiv friction log

Notes from building on SDK 1.0.0 and the Rabdi testnet.

## 1. Docs and the SDK disagree right after the 1.0 release

- **Expected:** the docs to match the published SDK.
- **What happened:**
  - Several docs pages still describe Tiramisu and SDK 0.8.
  - The docs sidebar still lists `jsonToPayload` and `stringToPayload`, which 1.0 removed.
  - The package README's install line says `"^0.9.0"` while `latest` is 1.0.0.
- **Workaround:** we built against the type definitions shipped in the package.
- **Repro:** compare docs.arkiv.network with `npm view @arkiv-network/sdk version`.

## 2. The faucet needs a browser wallet

- **Expected:** to fund a freshly generated server key by pasting its address.
- **What happened:** hub.arkiv.network/faucet only works with a connected browser wallet. A headless gateway key has to be imported into a browser wallet just to claim tGLM.
- **Ask:** a paste-an-address faucet, or a CLI one.

## 3. Public RPC warning

- **What happened:** with no access key, the SDK logs a rate-limit warning. That's fine, but it would help if `rabdi()` without a key were documented as the read-only default.

## 4. Query operators

- **What happened:** there is no `ne` or `not`. To show only online offers, you must filter `eq("online", true)`. "Everything except X" queries need client-side filtering.

## 5. 128-byte strings

- **What happened:** `str` values cap at 128 bytes. Hedera transaction ids and gateway URLs fit, but a longer URL is rejected at write time, so a field like that has to be planned as a `bytes` column up front.
- **Ask:** let a schema declare a longer `str`, or say so in the column docs.

## 6. Moving to a new writer wallet starts the history over

- **What happened:** we moved the gateway to a fresh writer wallet. Every reader filters on `ownedBy(writer)`, so the offers and receipts written by the old wallet dropped out of every query at once. We deleted the old wallet's 13 receipts in one `executeBatch` so nothing stale was left behind.
- **Workaround:** keep the writer address in one config value (`ARKIV_WRITER_ADDRESS`) that the gateway, the API and the web app all read.
- **Ask:** a documented way to hand a set of entities over to a new owner.

## 7. Our own bug, for the record

- **What happened:** the first sync after a gateway restart published the seller's offer as offline, because it ran before the seller's node had reconnected through the tunnel. The next sync, 3 minutes later, set it back to online.
- **Fixed:** the first sync now waits 30 seconds after a restart, so nodes have reconnected before the gateway publishes their state.

No Arkiv write failed in the gateway logs during the paid test runs on 6 and 7 Nov 2026.
