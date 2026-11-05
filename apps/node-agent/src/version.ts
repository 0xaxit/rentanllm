/** Agent version. Sent in NodeHello and in the upstream User-Agent header. */
export const AGENT_VERSION = "0.0.2";

/** Honest User-Agent for upstream provider calls. Never impersonates another client. */
export const USER_AGENT = `rentanllm-node/${AGENT_VERSION}`;
