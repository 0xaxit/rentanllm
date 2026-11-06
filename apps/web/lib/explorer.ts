/** Block-explorer links for market payments, keyed by the x402 (CAIP-2) network. */

const TX_URL: Readonly<Record<string, (tx: string) => string>> = {
  "hedera:mainnet": (tx) => `https://hashscan.io/mainnet/transaction/${tx}`,
  "hedera:testnet": (tx) => `https://hashscan.io/testnet/transaction/${tx}`,
};

const NETWORK_LABEL: Readonly<Record<string, string>> = {
  "hedera:mainnet": "Hedera",
  "hedera:testnet": "Hedera testnet",
};

/** The explorer page for a settled payment, or null for a network we don't know. */
export const paymentTxUrl = (network: string, tx: string): string | null =>
  TX_URL[network]?.(encodeURIComponent(tx)) ?? null;

export const networkLabel = (network: string): string =>
  NETWORK_LABEL[network] ?? network;

/** "0x1234…abcd" or "0.0.48…1234.5678" */
export const shortTx = (tx: string): string =>
  tx.length <= 14 ? tx : `${tx.slice(0, 7)}…${tx.slice(-6)}`;

/** The spend audit topic on HashScan. */
export const auditTopicUrl = (topicId: string): string =>
  `https://hashscan.io/testnet/topic/${topicId}`;

/** One audit message as the mirror node serves it: JSON with its consensus time and running hash. */
export const auditMessageUrl = (topicId: string, sequence: number): string =>
  `https://testnet.mirrornode.hedera.com/api/v1/topics/${topicId}/messages/${sequence}`;

/** An EVM transaction (e.g. ERC-8004 feedback) on HashScan testnet. */
export const evmTxUrl = (hash: string): string =>
  `https://hashscan.io/testnet/transaction/${hash}`;

/** A contract or account by EVM address on HashScan testnet. */
export const evmAddressUrl = (address: string): string =>
  `https://hashscan.io/testnet/contract/${address}`;
