# rentanllm-mcp

An MCP server that lets an agent in Claude Desktop, Claude Code, Cursor or any other MCP client buy inference on the RentAnLLM market, one request at a time. Every payment is capped. Who approves it is up to you: Touch ID for every payment, the person only above a set amount, or nobody inside the caps.

## Tools

| Tool | Moves money | What it does |
| --- | --- | --- |
| `list_models` | no | Models for sale, sellers online, cheapest prices |
| `quote_inference` | no | What one request would cost and who would be paid |
| `buy_inference` | yes | Pays the seller and returns the answer with its payment receipt |
| `approve_payment` | yes | Pays a request that `buy_inference` held for the person's approval |
| `spending` | no | Spend in the last 24 hours, the caps, the latest payments with explorer links |

`buy_inference` runs in this order, and a refusal at any step costs nothing:

1. Get the price from the gateway (its 402 answer).
2. Check the caller's `max_price_usdc`, the per-request cap and the rolling 24-hour cap.
3. Show the Touch ID prompt, which names the amount, the recipient and the network.
4. Only then read the key, sign that one payment and send the request.
5. Record the payment in `spend.jsonl`. A payment counts even when the seller then fails to answer.

## Approval above a threshold

With `RENTANLLM_MCP_APPROVAL=threshold`, small payments go through on their own and larger ones wait for the person:

| Price of the request | What happens |
| --- | --- |
| Up to `RENTANLLM_MCP_AUTO_APPROVE_USDC` (default `0.001`) | Paid at once, inside the caps |
| Above it, and the client supports MCP elicitation (Claude Code) | The client shows "Pay 0.0123 USDC to 0.0.x on Hedera testnet …?". Nothing is paid unless the person confirms |
| Above it, and the client cannot show that dialog | `buy_inference` holds the payment and returns a `payment_id`. The agent then calls `approve_payment` with that id, the amount and the recipient, and the client shows its own approval dialog with those arguments |

The per-request and 24-hour caps apply on top in every case.

`approve_payment` pays only when the id, amount and recipient match the held payment exactly. A hold expires after 5 minutes and can be used once. The price is fetched again before paying and may not have gone up.

In Claude Desktop, allow `buy_inference` and leave `approve_payment` on **Always ask**. That way the agent buys small answers on its own, and every larger payment stops at a Confirm/Deny dialog. Keep the key in a file only you can read:

```json
{
  "mcpServers": {
    "rentanllm": {
      "command": "bun",
      "args": ["/path/to/rentanllm/apps/mcp/src/main.ts"],
      "env": {
        "RENTANLLM_GATEWAY_URL": "https://gw.rentanllm.xyz",
        "RENTANLLM_MCP_ACCOUNT": "0.0.12345",
        "RENTANLLM_MCP_APPROVAL": "threshold",
        "RENTANLLM_MCP_AUTO_APPROVE_USDC": "0.001",
        "RENTANLLM_MCP_KEY_FILE": "~/.config/rentanllm/wallets/buyer.json",
        "RENTANLLM_MCP_MAX_PER_REQUEST_USDC": "0.05",
        "RENTANLLM_MCP_MAX_PER_DAY_USDC": "1"
      }
    }
  }
}
```

## Approval with World ID Agent Pass

`RENTANLLM_MCP_APPROVAL=world` works like `threshold`, but the person approves larger payments with World ID instead of in the client:

1. `buy_inference` holds a payment above `RENTANLLM_MCP_AUTO_APPROVE_USDC` and returns World ID's link and code for the agent to show the person. Nothing is signed.
2. The person approves or denies on World ID's page.
3. `approve_payment` waits up to 45 seconds for their answer. The RentAnLLM API (`RENTANLLM_API_URL`) validates World's ID token and then uses the approval once, for exactly the held amount and payee. Only then is the payment signed.
4. If the approval is denied, expires (10 minutes) or fails validation, or `cancel_payment` is called, nothing is paid.

The first person to approve is pinned in `<state dir>/world-subject`; later approvals must come from the same person. Delete that file to link a different person. See [`world/`](../../world/) for the whole flow.

```json
"env": {
  "RENTANLLM_API_URL": "https://api.rentanllm.xyz",
  "RENTANLLM_GATEWAY_URL": "https://gw.rentanllm.xyz",
  "RENTANLLM_MCP_ACCOUNT": "0.0.12345",
  "RENTANLLM_MCP_APPROVAL": "world",
  "RENTANLLM_MCP_AUTO_APPROVE_USDC": "0.001",
  "RENTANLLM_MCP_KEY_FILE": "~/.config/rentanllm/wallets/buyer.json"
}
```

## Autonomous agent

`rentanllm-mcp agent "<prompt>"` buys one answer with no person in the loop:

1. Finds a model on the market (`GET /v1/models`); without `--model` it takes the one with the cheapest online seller.
2. Gets the price from the gateway's 402.
3. Checks the per-request and 24-hour caps, plus `--max-price` if given.
4. Signs that one payment with its own key, sends the request, and prints the answer with the Hedera transaction and its HashScan link.

The caps are the only limit, so it needs approval off and a key file:

```sh
RENTANLLM_GATEWAY_URL=https://gw.rentanllm.xyz \
RENTANLLM_MCP_ACCOUNT=0.0.11331175 \
RENTANLLM_MCP_APPROVAL=none \
RENTANLLM_MCP_KEY_FILE=~/.config/rentanllm/wallets/buyer.json \
bun src/main.ts agent --max-tokens 64 "Say hi in five words"
```

Payments go into the same `spend.jsonl` as the MCP server's, so both count against one 24-hour cap.

## Testing the gateway with curl

`sign-payment` signs one 402 by hand, so the whole x402 exchange can be done with curl:

```sh
# 1. Ask without paying: the 402 carries a payment-required header
curl -i https://gw.rentanllm.xyz/v1/chat/completions \
  -H "content-type: application/json" \
  -d '{"model":"llama3.1:8b","max_tokens":256,"messages":[{"role":"user","content":"Hello"}]}'

# 2. Sign it (paste the header value; the whole "payment-required: ..." line works too)
RENTANLLM_MCP_ACCOUNT=0.0.12345 RENTANLLM_MCP_APPROVAL=none \
RENTANLLM_MCP_KEY_FILE=~/.config/rentanllm/wallets/buyer.json \
bun src/main.ts sign-payment 'eyJhY2NlcHRz...'

# 3. Send the same request again with the signature
curl -i https://gw.rentanllm.xyz/v1/chat/completions \
  -H "content-type: application/json" \
  -H "payment-signature: <output of step 2>" \
  -d '{"model":"llama3.1:8b","max_tokens":256,"messages":[{"role":"user","content":"Hello"}]}'
```

The answer comes back with a `payment-response` header: base64 JSON with the Hedera transaction id. `sign-payment` refuses anything above the per-request cap. With approval `touchid` it asks for Touch ID before signing.

## How the key is protected

`signer/main.swift` builds `rentanllm-signer`, a small macOS helper:

- **Where the key lives:** your login keychain, as an item the helper created. macOS lets the helper read it silently. Any other program, including an agent running `security find-generic-password`, has to get past a macOS password prompt first.
- **When it hands the key over:** only after `LocalAuthentication` approves this payment. That means Touch ID, or your login password on a Mac without it.
- **Limit:** the prompt shows what the MCP server says it is about to pay. A process that can run the helper itself still needs your fingerprint, but it could word the prompt however it likes. Only approve payments you just asked for.

## Set up

```sh
bun install                  # from the repo root
cd apps/mcp
bun run build:signer         # -> dist/rentanllm-signer (needs Xcode command line tools)

# Store the payer key once (the Hedera account's ECDSA private key).
export RENTANLLM_MCP_ACCOUNT=0.0.12345
pbpaste | bun src/main.ts store-key     # reads stdin; nothing is echoed
bun src/main.ts key-status
```

The paying Hedera account needs testnet USDC (`0.0.429274`, from https://faucet.circle.com) and must be associated with that token. It needs no HBAR for payments, because the facilitator pays the network fee.

### Claude Desktop / Claude Code

```json
{
  "mcpServers": {
    "rentanllm": {
      "command": "bun",
      "args": ["/path/to/rentanllm/apps/mcp/src/main.ts"],
      "env": {
        "RENTANLLM_GATEWAY_URL": "https://gw.rentanllm.xyz",
        "RENTANLLM_MCP_NETWORK": "hedera:testnet",
        "RENTANLLM_MCP_ACCOUNT": "0.0.12345",
        "RENTANLLM_MCP_MAX_PER_REQUEST_USDC": "0.05",
        "RENTANLLM_MCP_MAX_PER_DAY_USDC": "1"
      }
    }
  }
}
```

ChatGPT can only connect to MCP servers hosted on the internet, and a hosted server cannot raise Touch ID on your Mac, so this server is for local MCP clients.

## Configuration

| Env var | Default | Meaning |
| --- | --- | --- |
| `RENTANLLM_GATEWAY_URL` | `http://localhost:8787` | Gateway base URL (`/v1` is stripped) |
| `RENTANLLM_MCP_NETWORK` | `hedera:testnet` | Only `hedera:testnet` is accepted; the market pays on Hedera testnet |
| `RENTANLLM_MCP_ACCOUNT` |  | The paying Hedera account (`0.0.x`); required on Hedera |
| `RENTANLLM_MCP_MAX_PER_REQUEST_USDC` | `0.05` | Largest single payment |
| `RENTANLLM_MCP_MAX_PER_DAY_USDC` | `1` | Most paid in any 24 hours |
| `RENTANLLM_MCP_STATE_DIR` | `~/.config/rentanllm/mcp` | Where `spend.jsonl` is kept |
| `RENTANLLM_MCP_SIGNER` | `dist/rentanllm-signer` | The approval helper |
| `RENTANLLM_MCP_APPROVAL` | `touchid` | `touchid`: Touch ID for every payment. `threshold`: the person approves only above `RENTANLLM_MCP_AUTO_APPROVE_USDC`. `world`: the same, with World ID Agent Pass (needs `RENTANLLM_API_URL`). `none`: no person, the caps are the only limit (the `agent` command needs it). `threshold`, `world` and `none` also need `RENTANLLM_MCP_PRIVATE_KEY` or `RENTANLLM_MCP_KEY_FILE` |
| `RENTANLLM_API_URL` |  | With approval `world`: the RentAnLLM API that validates World ID approvals |
| `RENTANLLM_MCP_AUTO_APPROVE_USDC` | `0.001` | With approval `threshold`: the largest payment made without asking |
| `RENTANLLM_MCP_KEY_FILE` |  | With approval `threshold` or `none`: a file holding the payer key, raw or as JSON with `privateKeyHex` |

## Development

```sh
bun run test        # caps, the purchase order of steps, approval threshold, held payments, config
bun run typecheck
```
