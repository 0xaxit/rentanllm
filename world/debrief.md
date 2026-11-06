# Integration debrief: World ID Agent Pass

What it was like to integrate World ID Agent Pass into RentAnLLM's payment approvals, written for the World team.

## Time to first success

- **Integration built and tested end to end against a fake World IdP:** one working session, on 6 Nov 2026. That covers:
  - the API's device flow and ID-token validation;
  - the approval states and database table;
  - the MCP tools;
  - tests for every path.
- **First live approval on the sandbox:** _to fill in after the first run with real portal credentials (time from creating the portal app to the first validated approval)._

Most of the time went into finding out _what_ Agent Pass is, not into wiring it up. Once it was clear it is a standard OIDC provider with the device grant, the client took about 300 lines.

## Friction

- **The name.** The prize page says "World ID Agent Pass", but the docs at `auth.world.org/docs` never use that name. They call it World IdP, so it took a while to be sure they were the same thing.
- **The docs are a JavaScript app.** A plain fetch of the docs returns an empty shell. We read them through the developer MCP endpoint (`/mcp/developer`, `get_idp_guide`) instead, which helps agents but is not obvious to people.
- **The npm package is out of date.** `@worldcoin/human-in-the-loop` on npm (0.2.1) is the older IDKit-based design, while the repo's README describes the new device-flow version. Following the README with the published package does not work, so we wrote our own client (with `jose`) and used the repo's `src/idp.ts` as a reference.
- **The `acr` values disagree.** The reference code checks for `.../acr/orb-v3`, while the discovery document advertises `.../acr/orb` and `.../acr/orb-face`. We made the accepted values configurable and rely on `amr` containing `pop` instead.
- **The testing guide disagrees with the prize page.** The guide still describes the TestFlight sandbox app and "Manual verify". The prize page says proofs are mocked and no sandbox app is needed.
- **A redirect URI is required for device-only clients.** It is never used, but the portal requires one, and it must be HTTPS.

## Missing capability or documentation

- **No way to bind the approved action.** The device profile says `binding_message` and action terms are not displayed or signed. For an agent-payment approval, the most important thing the person should see is _what_ they are approving ("pay 0.0123 USDC to 0.0.4242"). Today the person sees only the requester name and a code, and the application has to keep the binding itself, as we do in `world_approvals`.
- **No push or webhook.** The backend has to poll, and the person has to be handed a link out of band.
- **No documented sandbox test identities for denial cases.** It would help to be able to force `access_denied` or an expired approval from the sandbox, to test the unhappy paths against World rather than against a fake.

## The one improvement with the greatest impact

**Show and sign a short action message (a CIBA-style `binding_message`) on the approval page and in the ID token.** The person would then see "Pay 0.0123 USDC to 0.0.4242 for one llama3.1:8b answer?" on World ID's own page, and the backend could check the signed message instead of trusting its own copy. That turns Agent Pass from "a human is here" into "this human approved this exact action", which is what agent products need.
