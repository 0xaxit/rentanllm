/**
 * ERC-8004 ("Trustless Agents") registries on Hedera testnet (chain 296), read and written
 * over Hashio's JSON-RPC relay:
 * - the Identity Registry, an ERC-721 whose token id is the agentId and whose tokenURI is
 *   the agent's registration file;
 * - the Reputation Registry, where a client (here the platform's monitor wallet) posts
 *   `giveFeedback(agentId, value, decimals, tag1, tag2, ...)`. The owner of an agent may not
 *   give itself feedback, so a seller cannot rate its own node.
 */
import {
  Config,
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Redacted,
} from "effect";
import {
  createPublicClient,
  createWalletClient,
  http,
  isHex,
  zeroHash,
} from "viem";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hederaTestnet } from "viem/chains";

export const ERC8004_CHAIN_ID = 296;
export const IDENTITY_REGISTRY: Address =
  "0x8004A818BFB912233c491871b3d84c89A494BD9e";
export const REPUTATION_REGISTRY: Address =
  "0x8004B663056A597Dffe9eCcC1965A193B7388713";
/** CAIP-10 style id of the Identity Registry, as registration files name it. */
export const IDENTITY_REGISTRY_ID = `eip155:${ERC8004_CHAIN_ID}:${IDENTITY_REGISTRY}`;

const DEFAULT_RPC_URL = "https://testnet.hashio.io/api";
const READ_TIMEOUT = Duration.seconds(10);
const WRITE_TIMEOUT = Duration.seconds(60);

export const identityAbi = [
  {
    inputs: [{ name: "tokenId", type: "uint256" }],
    name: "ownerOf",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "tokenId", type: "uint256" }],
    name: "tokenURI",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "agentURI", type: "string" }],
    name: "register",
    outputs: [{ name: "agentId", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "agentId", type: "uint256" },
      { indexed: false, name: "agentURI", type: "string" },
      { indexed: true, name: "owner", type: "address" },
    ],
    name: "Registered",
    type: "event",
  },
] as const;

export const reputationAbi = [
  {
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "value", type: "int128" },
      { name: "valueDecimals", type: "uint8" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
      { name: "endpoint", type: "string" },
      { name: "feedbackURI", type: "string" },
      { name: "feedbackHash", type: "bytes32" },
    ],
    name: "giveFeedback",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "clientAddresses", type: "address[]" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
    ],
    name: "getSummary",
    outputs: [
      { name: "count", type: "uint64" },
      { name: "summaryValue", type: "int128" },
      { name: "summaryValueDecimals", type: "uint8" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

/** One measured value, posted as `value / 10^decimals` under `tag1`. */
export interface Feedback {
  readonly decimals: number;
  readonly endpoint: string;
  readonly tag1: string;
  readonly tag2: string;
  readonly value: bigint;
}

export class Erc8004 extends Context.Service<
  Erc8004,
  {
    /** The agent's owner and agentURI; null when the agent does not exist or the chain cannot say. */
    readonly agent: (
      agentId: bigint
    ) => Effect.Effect<{ readonly owner: string; readonly uri: string } | null>;
    /** Posts one feedback from the monitor wallet and waits for it; the transaction hash. */
    readonly giveFeedback: (
      agentId: bigint,
      feedback: Feedback
    ) => Effect.Effect<string, Error>;
    /** The monitor wallet, or null when no key is configured (then nothing is posted). */
    readonly monitor: string | null;
  }
>()("@rentanllm/api/Erc8004") {}

const monitorKey = Config.option(Config.Redacted("REPUTATION_MONITOR_KEY"));

const toHexKey = (raw: string): Hex => {
  const key = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!isHex(key) || key.length !== 66) {
    throw new Error("REPUTATION_MONITOR_KEY must be a 32-byte hex ECDSA key");
  }
  return key;
};

export const Erc8004Live = Layer.effect(Erc8004)(
  Effect.gen(function* makeErc8004() {
    const rpcUrl = yield* Config.String("HEDERA_RPC_URL").pipe(
      Config.withDefault(DEFAULT_RPC_URL)
    );
    const key = (yield* monitorKey).pipe(
      Option.map((k) => privateKeyToAccount(toHexKey(Redacted.value(k))))
    );
    const transport = http(rpcUrl);
    const reader = createPublicClient({ chain: hederaTestnet, transport });

    const agent = (agentId: bigint) =>
      Effect.tryPromise(async () => {
        const [owner, uri] = await Promise.all([
          reader.readContract({
            abi: identityAbi,
            address: IDENTITY_REGISTRY,
            args: [agentId],
            functionName: "ownerOf",
          }),
          reader.readContract({
            abi: identityAbi,
            address: IDENTITY_REGISTRY,
            args: [agentId],
            functionName: "tokenURI",
          }),
        ]);
        return { owner, uri };
      }).pipe(
        Effect.timeout(READ_TIMEOUT),
        Effect.tapError((cause) =>
          Effect.logWarning("ERC-8004 agent lookup failed", cause)
        ),
        Effect.orElseSucceed(() => null)
      );

    if (Option.isNone(key)) {
      return Erc8004.of({
        agent,
        giveFeedback: () =>
          Effect.fail(new Error("REPUTATION_MONITOR_KEY is not set")),
        monitor: null,
      });
    }
    const account = key.value;
    const writer = createWalletClient({
      account,
      chain: hederaTestnet,
      transport,
    });
    return Erc8004.of({
      agent,
      giveFeedback: (agentId, feedback) =>
        Effect.tryPromise({
          catch: (cause) =>
            cause instanceof Error ? cause : new Error(String(cause)),
          try: async () => {
            const hash = await writer.writeContract({
              abi: reputationAbi,
              address: REPUTATION_REGISTRY,
              args: [
                agentId,
                feedback.value,
                feedback.decimals,
                feedback.tag1,
                feedback.tag2,
                feedback.endpoint,
                "",
                zeroHash,
              ],
              functionName: "giveFeedback",
            });
            const receipt = await reader.waitForTransactionReceipt({ hash });
            if (receipt.status !== "success") {
              throw new Error(`giveFeedback reverted: ${hash}`);
            }
            return hash;
          },
        }).pipe(Effect.timeout(WRITE_TIMEOUT)),
      monitor: account.address,
    });
  })
);

/** For tests: agents from a map; feedback is recorded and gets a fake hash. */
export const erc8004Stub = (
  agents: ReadonlyMap<bigint, { readonly owner: string; readonly uri: string }>,
  posted: { agentId: bigint; feedback: Feedback }[] = []
) =>
  Layer.succeed(Erc8004)(
    Erc8004.of({
      agent: (agentId) => Effect.succeed(agents.get(agentId) ?? null),
      giveFeedback: (agentId, feedback) =>
        Effect.sync(() => {
          posted.push({ agentId, feedback });
          return `0x${posted.length.toString(16).padStart(64, "0")}`;
        }),
      monitor: "0x000000000000000000000000000000000000beef",
    })
  );
