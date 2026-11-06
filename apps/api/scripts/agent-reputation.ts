#!/usr/bin/env bun
/**
 * Reads a seller's ERC-8004 identity and reputation straight from Hedera testnet (chain
 * 296) over Hashio. No account and no key needed:
 *
 *   bun apps/api/scripts/agent-reputation.ts 146
 *   MONITOR=0x... bun apps/api/scripts/agent-reputation.ts 146
 *
 * Prints the agent's owner and agentURI from the Identity Registry, then, for each metric
 * the RentAnLLM monitor posts, `getSummary(agentId, [monitor], tag, "24h")` from the
 * Reputation Registry: how many reports there are and their average.
 */
import { createPublicClient, formatUnits, http } from "viem";
import type { Address } from "viem";
import { hederaTestnet } from "viem/chains";

import {
  IDENTITY_REGISTRY,
  identityAbi,
  REPUTATION_REGISTRY,
  reputationAbi,
} from "../src/reputation/erc8004";

const DEFAULT_MONITOR: Address = "0x08aa252633e4c7c5438ef454902678b480b72eab";
const TAGS = [
  { tag: "uptime", unit: "%" },
  { tag: "ttfbMs", unit: " ms" },
  { tag: "successRate", unit: "%" },
] as const;

const [arg] = process.argv.slice(2);
if (arg === undefined || !/^\d+$/u.test(arg)) {
  console.error("usage: bun apps/api/scripts/agent-reputation.ts <agentId>");
  process.exit(1);
}
const agentId = BigInt(arg);
const monitor = (process.env.MONITOR ?? DEFAULT_MONITOR) as Address;
const client = createPublicClient({
  chain: hederaTestnet,
  transport: http(
    process.env.HEDERA_RPC_URL ?? "https://testnet.hashio.io/api"
  ),
});

const [owner, uri] = await Promise.all([
  client.readContract({
    abi: identityAbi,
    address: IDENTITY_REGISTRY,
    args: [agentId],
    functionName: "ownerOf",
  }),
  client.readContract({
    abi: identityAbi,
    address: IDENTITY_REGISTRY,
    args: [agentId],
    functionName: "tokenURI",
  }),
]);
console.log(`agent #${agentId}`);
console.log(`  owner     ${owner}`);
console.log(`  agentURI  ${uri}`);
console.log(`reputation from monitor ${monitor} (last 24h windows)`);
const summaries = await Promise.all(
  TAGS.map(({ tag }) =>
    client.readContract({
      abi: reputationAbi,
      address: REPUTATION_REGISTRY,
      args: [agentId, [monitor], tag, "24h"],
      functionName: "getSummary",
    })
  )
);
for (const [i, { tag, unit }] of TAGS.entries()) {
  const [count, value, decimals] = summaries[i] ?? [0n, 0n, 0];
  const shown =
    count === 0n ? "no reports" : `${formatUnits(value, decimals)}${unit}`;
  console.log(`  ${tag.padEnd(12)} ${shown} (${count} reports)`);
}
