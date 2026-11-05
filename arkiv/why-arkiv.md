# Why Arkiv

## What users would lose with Postgres

- **An order book anyone can read without us:**
  - Agents and other front-ends can find sellers and prices by querying Arkiv directly.
  - With Postgres, our API would be the only door, and we could hide or reorder sellers without anyone being able to tell.
- **A price that can't be quietly changed after the fact:** every offer and receipt is written on chain by one known writer, and a receipt points at the payment transaction it claims.
- **Offers that clean themselves up:** a 15-minute TTL means a crashed gateway can't leave stale prices behind. In Postgres we would need our own expiry job, and readers would have to trust it.

## What we kept off Arkiv, and why

- **Account data:** sign-in sessions, node tokens and listing drafts are private and change constantly, so they stay in Postgres.
- **The full request log with latencies:** it is operational detail, so it stays in Postgres. Arkiv gets the public receipt, which is what buyers and sellers need.
- **Prompts and answers:** never stored anywhere.
- **Payments:** they settle on Hedera via x402. Arkiv records them and links to them; it does not move money.
