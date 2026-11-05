---
name: ethglobal
description: Look up ETHGlobal hackathon sponsor bounties, prize requirements, past projects and winners, and event rules. Use when the user asks about an ETHGlobal event's prizes or qualification rules, past winning projects, sponsor docs, or hackathon rules like team size, partner-prize limits or AI-use policy.
---

# ETHGlobal lookup

Answer questions about ETHGlobal events from three free sources. Never pay for a request.

- **Search API** at `https://ethglobalskills.vercel.app`: sponsors, bounties and past projects across every event from ETHWaterloo on. Third-party, not run by ETHGlobal.
- **ethglobal.com**: the source of truth. Use it for a live event the API hasn't indexed yet, and to confirm anything the user will act on.
- **Local files** in this directory: `HACKATHON_FAQ.md` for rules (partner-prize cap, start-from-scratch, AI attribution, teams, staking) and `SPONSOR_RESOURCES.md` for sponsor docs, MCP servers and skills.

## Rate limit: wait, never pay

The API allows 10 requests a minute. Past that it may answer 402 Payment Required and offer paid access in USDC. It may also fail with a 500 `MIDDLEWARE_INVOCATION_FAILED`, which is what it did when this was written. Paying only lifts the rate limit. It unlocks no extra data.

When you hit the limit:

1. Don't install a payment tool, sign a payment, or retry through a paying client.
2. Wait 60 seconds and retry, or answer from ethglobal.com instead.
3. Batch your questions: one `/api/prizes?event=...` call returns every sponsor for an event, so filter locally instead of making one call per sponsor.

## Endpoints

All are `GET` and return JSON.

### /api/sponsors

Exact sponsor names. Call it when a sponsor filter comes back empty.

| Param     | Meaning                       |
| --------- | ----------------------------- |
| `keyword` | Partial name match (optional) |

`/api/sponsors?keyword=uniswap` → `{"sponsors":["Uniswap Foundation"]}`

### /api/prizes

Bounties grouped by sponsor, with `about`, `docs` links, and each prize's `title`, `description` and `qualifications`. Needs `event`, `sponsor`, or both.

| Param | Meaning |
| --- | --- |
| `event` | Exact event name (list below) |
| `sponsor` | Exact sponsor name. Without `event`, returns that sponsor's 10 most recent prizes across events |

### /api/projects

Search past projects.

| Param     | Meaning                                                      |
| --------- | ------------------------------------------------------------ |
| `event`   | Exact event name                                             |
| `keyword` | Searches title, tagline, description and how-it's-made       |
| `sponsor` | Only projects that won a prize from this sponsor             |
| `prize`   | Partial prize title, e.g. `Finalist`, `Best Mini App`        |
| `pool`    | `true` to include pool-prize winners (default `false`)       |
| `include` | Extra fields, comma-separated: `description`, `how_its_made` |
| `limit`   | Default 30, max 100                                          |

`prizes_won` appears only when `sponsor` or `prize` is set.

Examples:

- Past Hedera winners, to see what judges reward: `/api/projects?sponsor=Hedera&include=how_its_made`
- Finalists at one event: `/api/projects?event=ETHGlobal+Bangkok&prize=Finalist`
- Prior art for an idea: `/api/projects?keyword=inference+marketplace`

## When the API has nothing

A live or upcoming event can return `{"results":[]}` before it's indexed. When this was written, ETHGlobal Mumbai returned no prizes and no projects. Fall back to the site:

- Prizes: `https://ethglobal.com/events/<slug>/prizes`, e.g. `/events/mumbai/prizes`. The page is long (~105k characters), so read it in two passes.
- Projects and winners: `https://ethglobal.com/showcase`
- Event info and schedule: `https://ethglobal.com/events/<slug>`

## Presenting results

- Link project titles with their `url`: `[Title](url)`. Add `[GitHub](...)` and `[Live Demo](...)` when present.
- For a bounty the user will build against, give its `qualifications` in full. Requirements are pass/fail, and summaries drop the line that disqualifies.
- If the user names a recurring event without a year ("ETHGlobal New York"), ask which year.
- Prize amounts, dates and rules change. For anything the user will act on, say whether it came from the API or ethglobal.com.

## Event names

Use these exact strings for `event`:

ETHGlobal Mumbai, ETHGlobal Tokyo 2026, ETHOnline 2026, ETHGlobal Lisbon 2026, ETHGlobal New York 2026, Open Agents, ETHGlobal Cannes 2026, HackMoney 2026, ETHGlobal Buenos Aires, ETHOnline 2025, ETHGlobal New Delhi, ETHGlobal New York 2025, Unite Defi, ETHGlobal Cannes, ETHGlobal Prague, ETHGlobal Taipei, ETHGlobal Trifecta, Agentic Ethereum, ETHGlobal Bangkok, ETHGlobal San Francisco, ETHGlobal Singapore, ETHOnline 2024, Superhack 2024, ETHGlobal Brussels, StarkHack, HackFS 2024, ETHGlobal Sydney, Scaling Ethereum 2024, Frameworks, ETHGlobal London, Circuit Breaker, LFGHO, ETHIndia 2023, ETHGlobal Istanbul, ETHOnline 2023, ETHGlobal New York, Superhack, ETHGlobal Paris, ETHGlobal Waterloo, HackFS 2023, Autonomous Worlds, ETHGlobal Lisbon, ETHGlobal Tokyo, Scaling Ethereum 2023, FVM Space Warp, ETHIndia 2022, Hack FEVM, ETHSanFrancisco 2022, ETHBogotá, ETHOnline 2022, ETHMexico, Metabolism, HackFS 2022, ETHNewYork 2022, HackMoney 2022, ETHAmsterdam, DAOHacks, LFGrow, BuildQuest, Road to Web3, NFTHack 2022, Web3Jam, UniCode, ETHOnline 2021, HackFS 2021, HackMoney 2021, Web3 Weekend, Scaling Ethereum, NFTHack, MarketMake, ETHOnline, HackFS, HackMoney, ETHLondonUK, ETHWaterloo 2019, ETHBoston, ETHNewYork, ETHCapeTown, ETHParis, ETHSingapore, ETHSanFrancisco, ETHWaterloo

If a new event is missing from this list, try its name as shown on ethglobal.com.

## Credit

Adapted from `ethglobal-skills/repo` (MIT). Changes: payment flow and version-update prompt removed, the remote `ethskills.com` instruction file dropped, and a fallback to ethglobal.com added. `HACKATHON_FAQ.md` is copied unchanged. `SPONSOR_RESOURCES.md` is copied with one added line: suggest installs, don't run them.
