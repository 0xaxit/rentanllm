/** The node agent's tunnel endpoint and start command for a gateway URL. */

const HTTP_SCHEME = /^http(?<secure>s?):\/\//u;

/** https://gw.example -> wss://gw.example/tunnel (http -> ws for local dev). */
export const tunnelUrl = (gatewayUrl: string): string => {
  const base = gatewayUrl.replace(/\/+$/u, "");
  const ws = base.replace(HTTP_SCHEME, (_match, secure: string) =>
    secure === "s" ? "wss://" : "ws://"
  );
  return `${ws}/tunnel`;
};

/** The model the start command serves until the owner edits it. */
export const DEFAULT_OLLAMA_MODEL = "llama3.1:8b";

/** The exact command the owner pastes into a terminal, next to a running Ollama. */
export const nodeStartCommand = (input: {
  readonly gatewayUrl: string;
  readonly nodeId: string;
  readonly nodeToken: string;
}): string =>
  `ral start --gateway ${tunnelUrl(input.gatewayUrl)} --node-id ${input.nodeId} --node-token ${input.nodeToken} --ollama-model ${DEFAULT_OLLAMA_MODEL}`;

/**
 * Same, with the token in the environment: anything on the command line is
 * visible to other users of the machine via `ps`.
 */
export const nodeStartCommandWithEnv = (input: {
  readonly gatewayUrl: string;
  readonly nodeId: string;
  readonly nodeToken: string;
}): string =>
  `export RENTANLLM_NODE_TOKEN=${input.nodeToken}\nral start --gateway ${tunnelUrl(input.gatewayUrl)} --node-id ${input.nodeId} --ollama-model ${DEFAULT_OLLAMA_MODEL}`;
