# Integration debrief: World ID Agent Pass

What it was like to integrate World ID Agent Pass into RentAnLLM's payment approvals, written for the World team.

## Time to first success

- **Integration built and tested end to end against a fake World IdP:** one working session, on 6 Nov 2026. That covers:
  - the API's device flow and ID-token validation;
  - the approval states and database table;
  - the MCP tools;
  - tests for every path.
- **First live approval on the sandbox: about 1 hour 40 minutes from first portal sign-in, on 7 Nov 2026 (IST).**

  | Time (IST) | Step |
  | --- | --- |
  | about 1:02 AM | First successful sign-in to the sandbox portal, after `invalid_login` and `account_not_eligible` (below). |
  | 1:22 AM | Sandbox World ID created in World ID Beta ("V3 and V4 verified"), after turning on feature flags. |
  | 1:28 AM | App registered. Our API's first `device_authorization` with the real credentials succeeds. |
  | 1:30 AM | First approval attempt: "Failed to share", because the sandbox identity was not issued yet. |
  | 2:40 AM | **First validated approval.** World's ID token passed every check in our backend: signature against the JWKS, `iss`, `aud`, `exp`, `auth_time` after the request, and `amr` containing `pop`. |

  Our code needed no changes to work against the real sandbox. Almost all of the 1 hour 40 minutes was account setup and the wait for the sandbox identity to be issued.

Before that, most of the time went into finding out _what_ Agent Pass is, not into wiring it up. Once it was clear it is a standard OIDC provider with the device grant, the client took about 300 lines.

## Friction

- **The name.** The prize page says "World ID Agent Pass", but the docs at `auth.world.org/docs` never use that name. They call it World IdP, so it took a while to be sure they were the same thing.
- **The docs are a JavaScript app.** A plain fetch of the docs returns an empty shell. We read them through the developer MCP endpoint (`/mcp/developer`, `get_idp_guide`) instead, which helps agents but is not obvious to people.
- **The npm package is out of date.** `@worldcoin/human-in-the-loop` on npm (0.2.1) is the older IDKit-based design, while the repo's README describes the new device-flow version. Following the README with the published package does not work, so we wrote our own client (with `jose`) and used the repo's `src/idp.ts` as a reference.
- **The `acr` values disagree.** The reference code checks for `.../acr/orb-v3`, while the discovery document advertises `.../acr/orb` and `.../acr/orb-face`. A real sandbox token carried `https://world.org/oidc/acr/orb` and `amr` `["pop", "user", "mfa"]`, so code that checks for `orb-v3` would reject every approval. We made the accepted values configurable and rely on `amr` containing `pop`.
- **The prize page says no app is needed, but it is.** The prize page says "We are mocking proofs now, so you don't need sandbox app anymore". In practice, both connecting a proof of human in the portal and approving a device login needed the World ID Beta app on a phone (TestFlight). The testing guide was right, and the prize page sent us the wrong way first.
- **Portal errors are raw JSON with no next step.** Signing in showed `{"error":"invalid_login"}` and then `{"error":"account_not_eligible"}` as bare JSON pages. `invalid_login` is not in the docs at all. It cleared after restarting sign-in in a fresh tab, so it seems to mean the Google callback could not be matched to the sign-in it started. A sentence saying what to do next would have saved time.
- **An undocumented feature flag blocks Manual verify.** World ID Beta refused with "V4 protocol and credential issuance must both be enabled for this account". The fix, Developer settings → Feature Flags, is not in the testing guide.
- **About an hour before the sandbox identity works.** The guide warns that the "Human" card appears before the identity is usable, and it was right: the first attempt failed with "Failed to share". A visible "ready" state in the app, or a shorter wait, would remove the guessing.
- **Approving takes a step back in the browser.** After "proof shared" in the app, nothing reached our backend until the person returned to the browser page to finish. The page says "Return here to finish verification", but on a phone it is easy to miss, and to an agent's user the approval looks done when it isn't.
- **Two pages look like the portal.** The account pages (Home, Agents, Apps, Credentials, Sessions) have an "Apps" tab listing apps you have signed in to. Registering an app is on a different page, `/portal`. We looked for "Create app" on the wrong one first.
- **A redirect URI is required for device-only clients.** It is never used, but the portal requires one, and it must be HTTPS.

## Missing capability or documentation

- **No way to bind the approved action.** The device profile says `binding_message` and action terms are not displayed or signed. For an agent-payment approval, the most important thing the person should see is _what_ they are approving ("pay 0.0123 USDC to 0.0.4242"). Today the person sees only the requester name and a code, and the application has to keep the binding itself, as we do in `world_approvals`.
- **No push or webhook.** The backend has to poll, and the person has to be handed a link out of band.
- **No documented sandbox test identities for denial cases.** It would help to be able to force `access_denied` or an expired approval from the sandbox, to test the unhappy paths against World rather than against a fake.

## The one improvement with the greatest impact

**Show and sign a short action message (a CIBA-style `binding_message`) on the approval page and in the ID token.** The person would then see "Pay 0.0123 USDC to 0.0.4242 for one llama3.1:8b answer?" on World ID's own page, and the backend could check the signed message instead of trusting its own copy. That turns Agent Pass from "a human is here" into "this human approved this exact action", which is what agent products need.
