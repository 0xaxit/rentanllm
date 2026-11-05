# ral (rentanllm-node)

The owner's node agent for RentAnLLM. It runs on your own machine and dials **out** to the RentAnLLM gateway over a WebSocket. The gateway sends it renters' requests; the agent serves them from your **subscription** through [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) running on the same machine, and streams the response back. Your subscription login stays inside CLIProxyAPI, there is no provider API key involved, and no inbound port is opened.

## Install

Build a single self-contained executable (needs [Bun](https://bun.sh) 1.3+ to build, not to run):

```sh
bun install                      # from the repo root
cd apps/node-agent
bun run build                    # -> dist/ral
install -m 755 dist/ral ~/.local/bin/
```

For development: `bun run dev -- start ...` runs from source with reload.

## Run

```sh
# 1. CLIProxyAPI, signed in to your Claude subscription
brew install cliproxyapi
cliproxyapi --claude-login          # once; opens the browser
brew services start cliproxyapi

# 2. Start the agent with the node id and token from your dashboard. Registering a
#    node (POST /owner/nodes) shows both; the token (rn_node_...) is shown only once.
export RENTANLLM_NODE_ID=...        # the node's id (a uuid)
export RENTANLLM_NODE_TOKEN=rn_node_...
ral start --gateway wss://gw.<ip-dashed>.sslip.io/tunnel

# 3. In another terminal
ral status
```

The gateway checks that the token belongs to that node id and closes the tunnel (code 4003) otherwise. A bare gateway host (`wss://gw.<ip-dashed>.sslip.io` or `wss://gw.<ip-dashed>.sslip.io/`) gets the tunnel path `/tunnel` appended; any other path is used as given.

`--node-token` works too, but anything on the command line is visible to other users via `ps`, so prefer the env var or the config file.

### Selling open models with Ollama

```sh
ollama pull llama3.1:8b
ral start --gateway wss://gw.example/tunnel --ollama-model llama3.1:8b
```

The agent forwards market requests to Ollama's OpenAI-compatible `/v1/chat/completions` (asking for usage on streamed answers) and treats any answer to `/api/show` for that model as a healthy, unmetered upstream; when Ollama stops answering, the node stops taking requests. With `--ollama-model` set, CLIProxyAPI becomes optional. List the model in the dashboard under an **Open models** plan, using the exact name from `ollama list`.

On start the agent reads CLIProxyAPI's port and access key from `~/.cli-proxy-api/config.yaml` (its first `api-keys` entry), checks that CLIProxyAPI is up and has a Claude login, and exits with a clear message if not.

The agent starts **closed**. It only serves requests after the gateway sends it your availability window (open + cut-offs), and it closes again when the gateway says so. Stop it with Ctrl-C.

## Configuration

Precedence: flags, then env vars, then `config.json` in the config dir.

| Flag | Env var | `config.json` key | Default |
| --- | --- | --- | --- |
| `--gateway` | `RENTANLLM_GATEWAY_URL` | `gatewayUrl` | required; `wss://` (`ws://` only for localhost); `/tunnel` added to a bare host |
| `--node-token` | `RENTANLLM_NODE_TOKEN` | `nodeToken` | required |
| `--node-id` | `RENTANLLM_NODE_ID` | `nodeId` | required; the id the dashboard showed when you registered the node |
| `--cliproxyapi-config` | `RENTANLLM_CLIPROXYAPI_CONFIG` | `cliProxyApiConfig` | `~/.cli-proxy-api/config.yaml`; read for `port` and the first of `api-keys` |
| `--cliproxyapi-url` | `RENTANLLM_CLIPROXYAPI_URL` | `cliProxyApiUrl` | `http://127.0.0.1:<port from its config, else 8317>` (`http://` only for localhost) |
| `--cliproxyapi-probe-model` | `RENTANLLM_CLIPROXYAPI_PROBE_MODEL` | `cliProxyApiProbeModel` | the first `claude-*` model CLIProxyAPI serves |
| `--ollama-model` | `RENTANLLM_OLLAMA_MODEL` | `ollamaModel` | unset; set it (e.g. `llama3.1:8b`, already pulled) to serve open models through Ollama |
| `--ollama-url` | `RENTANLLM_OLLAMA_URL` | `ollamaUrl` | `http://127.0.0.1:11434` (`http://` only for localhost) |
| `--[no-]keep-awake` | `RENTANLLM_KEEP_AWAKE` | `keepAwake` | on |
| `--[no-]meter-probe` | `RENTANLLM_METER_PROBE` | `meterProbe` | on |
|  | `RENTANLLM_RATE_LIMIT_COOLOFF_MS` | `rateLimitCooloffMs` | 60000 |
|  | `RENTANLLM_CONFIG_DIR` |  | `$XDG_CONFIG_HOME/rentanllm` or `~/.config/rentanllm` |

The only credential the agent uses is CLIProxyAPI's access key, read from its config.yaml and never copied anywhere else.

The agent writes one file to the config dir: `status.json` (a snapshot for `ral status`, with no secrets in it). Older versions generated their own node id in `<config dir>/node-id`; that file is now ignored (the gateway only accepts the registered id) and can be deleted.

## What the agent does with a request

1. Refuses anything that is not `POST` to an allowlisted path (`/v1/messages`, `/v1/messages/count_tokens` for Anthropic).
2. Refuses new requests (fails closed) when the node is closed, when the provider recently returned 429 (cool-off), when usage meters are missing or older than 2 minutes, or when a meter is within 3 points of your cut-off. Requests already streaming are not cut off.
3. Calls your local CLIProxyAPI with its access key in the `x-api-key` header and `User-Agent: rentanllm-node/<version>`; CLIProxyAPI serves it from your subscription login. Of the renter's headers it forwards only `anthropic-version`, `anthropic-beta`, `content-type` and `accept`.
4. Streams the response back chunk by chunk and reports token usage from the provider's own `usage` fields. When the gateway cancels a request (the renter went away) or the stream fails, the final `ResponseError` carries the usage the provider had reported so far, so the renter is billed for what was actually used.

Usage meters come from the provider's rate-limit response headers. While the node is open and the reading is getting old, the agent refreshes it with a one-token message to the probe model (disable with `--no-meter-probe`). CLIProxyAPI only forwards those headers with `passthrough-headers: true` in its config. With no readable meters, the node refuses rentals.

While open, the agent keeps the machine from idle-sleeping (`caffeinate -i` on macOS, `systemd-inhibit` on Linux when installed). The lock is released when the node closes or the agent exits.

## What data leaves your machine

To the **gateway**:

- `NodeHello`: agent version, node id, protocol version, the providers you serve.
- Heartbeats every 15 s: a timestamp and your usage meter readings (percent used, reset times).
- For each rental: the response status, the `content-type`, `request-id` and `retry-after` response headers, the response body, and the token counts (also for a cancelled or failed request, up to where it stopped).
- Your node token, as `Authorization: Bearer` on the WebSocket handshake.

To **CLIProxyAPI** (on this machine), which forwards to the provider: the renter's request body and CLIProxyAPI's access key.

**Never sent to the gateway:** CLIProxyAPI's access key, your subscription login, and the provider's organization or rate-limit response headers.

## Development

```sh
bun run typecheck
bun run test        # vitest, run under Bun: fake gateway + fake CLIProxyAPI
bun run build
```
