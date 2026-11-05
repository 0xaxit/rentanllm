# rentanllm-mcp

An MCP server that lets an agent in Claude Desktop, Claude Code, Cursor or any other MCP client buy inference on the RentAnLLM market, one request at a time. Every payment is capped, and every payment waits for the person at the Mac to approve it with Touch ID.

## Tools

| Tool | Moves money | What it does |
| --- | --- | --- |
| `list_models` | no | Models for sale, sellers online, cheapest prices |
| `quote_inference` | no | What one request would cost and who would be paid |
| `buy_inference` | yes | Pays the seller and returns the answer with its payment receipt |
| `spending` | no | Spend in the last 24 hours, the caps, the latest payments with explorer links |

`buy_inference` runs in this order, and a refusal at any step costs nothing:

1. Get the price from the gateway (its 402 answer).
2. Check the caller's `max_price_usdc`, the per-request cap and the rolling 24-hour cap.
3. Show the Touch ID prompt, which names the amount, the recipient and the network.
4. Only then read the key, sign that one payment and send the request.
5. Record the payment in `spend.jsonl`. A payment counts even when the seller then fails to answer.

## Autonomous agent

`rentanllm-mcp agent "<prompt>"` buys one answer with no person in the loop:

1. Finds a model on the market (`GET /v1/models`); without `--model` it takes the one with the cheapest online seller.
2. Gets the price from the gateway's 402.
3. Checks the per-request and 24-hour caps, plus `--max-price` if given.
4. Signs that one payment with its own key, sends the request, and prints the answer with the Hedera transaction and its HashScan link.

The caps are the only limit, so it needs approval off and a key file:

```sh
RENTANLLM_GATEWAY_URL=https://gw.31-97-230-118.sslip.io \
RENTANLLM_MCP_ACCOUNT=0.0.11331175 \
RENTANLLM_MCP_APPROVAL=none \
RENTANLLM_MCP_KEY_FILE=~/.config/rentanllm/wallets/buyer.json \
bun src/main.ts agent --max-tokens 64 "Say hi in five words"
```

Payments go into the same `spend.jsonl` as the MCP server's, so both count against one 24-hour cap.

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
| `RENTANLLM_MCP_APPROVAL` | `touchid` | `none` pays without a person, inside the caps (the `agent` command needs it). Also needs `RENTANLLM_MCP_PRIVATE_KEY` or `RENTANLLM_MCP_KEY_FILE` |
| `RENTANLLM_MCP_KEY_FILE` |  | With approval `none`: a file holding the payer key, raw or as JSON with `privateKeyHex` |

## Development

```sh
bun run test        # caps, the purchase order of steps, the spend log, config
bun run typecheck
```
