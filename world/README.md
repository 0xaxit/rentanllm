# World ID Agent Pass: a person approves what the agent pays

RentAnLLM agents buy inference one request at a time and pay the seller in USDC on Hedera. Small payments go through on their own, inside spending caps. **Any payment above a set amount needs the person behind the agent to approve it with World ID Agent Pass**, and nothing is signed until the RentAnLLM API has validated that approval and used it up for that exact payment.

World ID makes this approval mean something: it is a unique human, the same one every time, and a fresh authentication for this payment. A prompt-injected agent cannot click it for them.

## The journey

```
agent (MCP)            MCP server                 RentAnLLM API                World IdP
   │ buy_inference        │                            │                           │
   │─────────────────────▶│ 402 quote: 0.0123 USDC     │                           │
   │                      │ above the 0.001 threshold  │                           │
   │                      │── POST /approvals ────────▶│── device_authorization ──▶│
   │                      │◀── link + code + secret ───│◀── device_code, user_code─│
   │◀── "show the person this link" (payment held, nothing signed)                 │
   │                                                                               │
   │  person opens the link, sees the code, approves (or denies) on World ID ────▶ │
   │                                                                               │
   │ approve_payment      │── POST /approvals/:id/check ─▶│── token (device_code) ─▶│
   │─────────────────────▶│                            │◀── ID token (RS256) ──────│
   │                      │                            │ verify signature (JWKS),  │
   │                      │                            │ iss, aud, exp, auth_time, │
   │                      │                            │ amr has "pop", subject    │
   │                      │◀── approved ───────────────│                           │
   │                      │ fresh 402 quote (not higher, same payee)               │
   │                      │── POST /approvals/:id/consume (amount, payee) ────────▶│
   │                      │◀── used (once, atomically) ─│                          │
   │                      │ only now: read key, sign the USDC transfer, pay        │
   │◀── answer + Hedera transaction id                                             │
```

1. **Request.** `buy_inference` gets the price from the gateway's 402. Above `RENTANLLM_MCP_AUTO_APPROVE_USDC` the MCP server asks the API for an approval of that exact payment (payer, payee, amount, network). The API starts a World IdP device authorization and keeps World's `device_code` to itself. The agent gets World's link and code, and tells the person.
2. **User completion.** The person opens the link, checks the code and approves or denies on World ID's page. The sandbox uses fake identities and needs no phone.
3. **Validated result.** `approve_payment` has the API check the approval. The API polls World's token endpoint, at most once per World's interval, and validates the ID token on the server:
   - **Signature:** RS256 against World's JWKS.
   - **Claims:** `iss`, `aud` (our client id) and `exp`.
   - **Freshness:** `auth_time` must be no earlier than the moment this approval was requested.
   - **Proof:** `amr` must contain `pop`, a World ID proof of human.
   - **Person:** the subject must be the person linked to this payer, when there is one.

   The first person to approve is pinned for the payer, and later approvals ask World for that person.

4. **Protected action.** The MCP server re-quotes, and the price may not have gone up. The API then _consumes_ the approval for exactly the approved amount and payee, in one conditional update. Only after that does the server read the payer key and sign the Hedera transfer.

## When it does not happen

Every path except `approved → used` ends with nothing signed.

| What happens | Approval state | What the agent is told |
| --- | --- | --- |
| The person clicks **Deny** on World ID | `denied` (World's `access_denied`) | "Not paid: the World ID approval was denied. Nothing was signed." |
| Nobody answers before World's code expires | `expired` (World's `expired_token`) | "...was expired" |
| Nobody uses an approval within 10 minutes of the request | `expired` | "...was expired" |
| The agent or person calls `cancel_payment` | `cancelled`, even if World approves afterwards | "Cancelled payment ... Nothing was paid." |
| A forged or stale ID token, the wrong audience, no proof of human, or a different person | `failed`, with the reason | "...was failed: a different person approved than the one linked to this payer" |
| World answers 5xx | `failed` | as above |
| A second use of the same approval, or another amount or payee | `used` / unchanged (409 `Conflict`) | "approval ... was already used" |

The tests run each of these:

- `apps/api/test/approvals-handlers.test.ts`: in memory, with a fake World IdP that signs real RS256 tokens.
- `apps/api/test/approvals.integration.test.ts`: on Postgres, including two racing consumes where exactly one wins.
- `apps/mcp/test/world-tools.test.ts`: the MCP tools end to end. It checks the order `create → check → consume → sign → paid` and that `sign` never runs on any other path.

## Security

- **World's client secret** is only in the API's environment (`WORLD_ID_CLIENT_SECRET`). It is sent only to World's token endpoints. The MCP server and the model never see it.
- **World's `device_code`** never leaves the API, and is cleared once the approval is decided.
- **The MCP server never trusts a World response itself.** It only gets the API's verdict. An approval is a 256-bit secret per attempt (only its SHA-256 is stored), handed to the MCP server and never shown to the model.
- **The payment is bound in our database, not in World's token.** World cannot sign the amount or payee into its token, so the API stores them with the attempt, and `consume` releases only that amount to that payee, once, before expiry.

## Where it lives

| Part | File |
| --- | --- |
| World IdP client (device flow, ID-token validation) | `apps/api/src/world/idp.ts` |
| Approval states and rules | `apps/api/src/services/approvals.ts` |
| Storage (`world_approvals`) | `packages/db/src/schema.ts`, `apps/api/src/world/approval-store.ts` |
| HTTP contract (`/approvals`) | `packages/api-contract/src/groups/approvals.ts` |
| MCP side (`RENTANLLM_MCP_APPROVAL=world`) | `apps/mcp/src/world.ts`, `apps/mcp/src/tools.ts` |

## Set it up

1. Register an app in the World IdP sandbox portal, https://sandbox.auth.world.org/portal:
   - **Client authentication:** `client_secret_post`.
   - **Redirect URL:** any one HTTPS URL. The device flow doesn't use it, but the portal requires one.
2. Give the API its credentials:

   ```sh
   WORLD_ID_ISSUER=https://sandbox.auth.world.org   # default
   WORLD_ID_CLIENT_ID=...
   WORLD_ID_CLIENT_SECRET=worldidp_client_secret_...
   # optional: only accept these assurance classes
   WORLD_ID_ACCEPTED_ACR=https://world.org/oidc/acr/orb
   ```

   Then run `bun run db:sync` to create `world_approvals`.

3. Point the MCP server at it:

   ```json
   "env": {
     "RENTANLLM_API_URL": "https://<the API>",
     "RENTANLLM_GATEWAY_URL": "https://gw.31-97-230-118.sslip.io",
     "RENTANLLM_MCP_ACCOUNT": "0.0.12345",
     "RENTANLLM_MCP_APPROVAL": "world",
     "RENTANLLM_MCP_AUTO_APPROVE_USDC": "0.001",
     "RENTANLLM_MCP_KEY_FILE": "~/.config/rentanllm/wallets/buyer.json"
   }
   ```

4. Ask the agent for an answer that costs more than the threshold, for example with `max_tokens` 2000. It will hand you World's link. Approve it once to see the payment settle. Then try again and deny it (or cancel it) to see that nothing is paid.

The integration debrief for World is in [`debrief.md`](debrief.md).
