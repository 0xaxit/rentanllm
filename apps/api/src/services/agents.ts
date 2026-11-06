/**
 * Seller nodes as ERC-8004 agents on Hedera testnet.
 *
 * 1. The seller registers the node from their own wallet: `register(agentURI)` on the
 *    Identity Registry, with this API's registration file for the node as the agentURI.
 * 2. The seller links the agentId here. The API checks on chain that their wallet owns it
 *    and that it points at this node's file, then stores it with the node's HCS-14 UAID.
 * 3. A cron posts what the platform measured (24h uptime, median time to first byte,
 *    success rate) to the Reputation Registry from the monitor wallet, a few times a day.
 *    Anyone can read it back with `getSummary(agentId, [monitor], tag1, "24h")`.
 */
import { InvalidRequest, NotFound } from "@rentanllm/api-contract";
import type { AgentIdentity, NodeIdentity } from "@rentanllm/api-contract";
import { Db } from "@rentanllm/db";
import {
  agentIdentities,
  listings,
  nodes,
  providerAccounts,
  users,
} from "@rentanllm/db/schema";
import { and, asc, eq, isNull, lt, or } from "drizzle-orm";
import { Effect } from "effect";

import { ApiConfig } from "../config";
import { dieOnDbError } from "../db-errors";
import {
  Erc8004,
  IDENTITY_REGISTRY,
  IDENTITY_REGISTRY_ID,
  REPUTATION_REGISTRY,
} from "../reputation/erc8004";
import type { Feedback } from "../reputation/erc8004";
import { nodeReputation } from "../reputation/metrics";
import { hcs14Uaid } from "../reputation/uaid";

const REGISTRATION_TYPE =
  "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";
/** HCS-14 skill 0: text generation. */
const TEXT_GENERATION_SKILL = 0;
const REPORT_EVERY_MS = 6 * 3_600_000;
/** At most this many agents per cron run: each one is up to three transactions. */
const AGENTS_PER_RUN = 5;
const AGENT_ID = /^\d{1,30}$/u;
const SHORT_ID = 8;
/** Feedback values carry two decimals: 9987 with decimals 2 is 99.87. */
const PCT_DECIMALS = 2;
const PCT_SCALE = 100;
const WINDOW_TAG = "24h";

type IdentityRow = typeof agentIdentities.$inferSelect;

export const toAgentIdentity = (row: IdentityRow): AgentIdentity => ({
  agentId: row.agentId.toString(),
  lastFeedbackTx: row.lastFeedbackTx,
  lastReportedAt: row.lastReportedAt,
  ownerWallet: row.ownerWallet,
  registry: row.registry,
  uaid: row.uaid,
});

const registrationPath = (nodeId: string) =>
  `/agents/${nodeId}/registration.json`;

const agentName = (nodeId: string) =>
  `RentAnLLM seller ${nodeId.slice(0, SHORT_ID)}`;

/** The node's HCS-14 UAID: its name and protocol hashed, the agentId and owner as routing. */
export const nodeUaid = (
  nodeId: string,
  ownerWallet: string,
  agentId: bigint
) =>
  hcs14Uaid({
    name: agentName(nodeId),
    nativeId: `eip155:296:${ownerWallet.toLowerCase()}`,
    protocol: "x402",
    registry: "erc-8004",
    skills: [TEXT_GENERATION_SKILL],
    uid: agentId.toString(),
    version: "1",
  });

/** The models the node's live open-model listings sell. */
const liveModels = Effect.fn("agents.liveModels")(function* liveModelsGen(
  nodeId: string
) {
  const db = yield* Db;
  const rows = yield* db
    .select({ models: listings.models })
    .from(listings)
    .innerJoin(
      providerAccounts,
      eq(providerAccounts.id, listings.providerAccountId)
    )
    .where(
      and(eq(providerAccounts.nodeId, nodeId), eq(listings.status, "live"))
    )
    .orderBy(asc(listings.id));
  return [...new Set(rows.flatMap((row) => row.models))];
});

/** The node's public ERC-8004 registration file (its agentURI). */
export const registrationFile = Effect.fn("agents.registrationFile")(
  function* registrationFileGen(nodeId: string) {
    const db = yield* Db;
    const config = yield* ApiConfig;
    const [node] = yield* db.select().from(nodes).where(eq(nodes.id, nodeId));
    if (node === undefined) {
      return yield* new NotFound({ message: "Agent not found" });
    }
    const [identity] = yield* db
      .select()
      .from(agentIdentities)
      .where(eq(agentIdentities.nodeId, nodeId));
    const models = yield* liveModels(nodeId);
    const sells =
      models.length > 0 ? models.join(", ") : "open models (none listed now)";
    return {
      active: node.status !== "disabled" && models.length > 0,
      description: `Open-model inference from a RentAnLLM seller's own machine: ${sells}. OpenAI-compatible chat completions, paid per request in USDC over x402 on Hedera testnet, straight to the seller's account.`,
      image: "",
      name: agentName(nodeId),
      registrations:
        identity === undefined
          ? []
          : [
              {
                agentId: Number(identity.agentId),
                agentRegistry: identity.registry,
              },
            ],
      services: [
        {
          endpoint: `${config.gatewayUrl}/v1/chat/completions`,
          name: "x402",
          version: "2",
        },
        { endpoint: `${config.gatewayUrl}/v1/models`, name: "web" },
      ],
      supportedTrust: ["reputation"],
      type: REGISTRATION_TYPE,
      ...(identity === undefined ? {} : { uaid: identity.uaid }),
      x402Support: true,
    };
  },
  dieOnDbError
);

const ownedNode = Effect.fn("agents.ownedNode")(function* ownedNodeGen(
  ownerId: string,
  nodeId: string
) {
  const db = yield* Db;
  const [row] = yield* db
    .select({ node: nodes, wallet: users.walletAddress })
    .from(nodes)
    .innerJoin(users, eq(users.id, nodes.ownerId))
    .where(and(eq(nodes.id, nodeId), eq(nodes.ownerId, ownerId)));
  if (row === undefined) {
    return yield* new NotFound({ message: "Node not found" });
  }
  return row;
});

const identityOf = Effect.fn("agents.identityOf")(function* identityOfGen(
  nodeId: string
) {
  const db = yield* Db;
  const config = yield* ApiConfig;
  const erc8004 = yield* Erc8004;
  const [row] = yield* db
    .select()
    .from(agentIdentities)
    .where(eq(agentIdentities.nodeId, nodeId));
  return {
    agent: row === undefined ? null : toAgentIdentity(row),
    identityRegistry: IDENTITY_REGISTRY,
    monitorAddress: erc8004.monitor,
    registrationUrl: `${config.publicUrl}${registrationPath(nodeId)}`,
    reputationRegistry: REPUTATION_REGISTRY,
  } satisfies NodeIdentity;
});

export const nodeIdentity = Effect.fn("agents.nodeIdentity")(
  function* nodeIdentityGen(ownerId: string, nodeId: string) {
    yield* ownedNode(ownerId, nodeId);
    return yield* identityOf(nodeId);
  },
  dieOnDbError
);

/** Links an agent the owner registered on chain, after checking it on chain. */
export const linkNodeIdentity = Effect.fn("agents.linkNodeIdentity")(
  function* linkNodeIdentityGen(
    ownerId: string,
    nodeId: string,
    input: { readonly agentId: string }
  ) {
    const { wallet } = yield* ownedNode(ownerId, nodeId);
    if (!AGENT_ID.test(input.agentId)) {
      return yield* new InvalidRequest({
        message: "agentId must be a whole number",
      });
    }
    if (wallet === null) {
      return yield* new InvalidRequest({
        message: "Sign in with a wallet to register an agent",
      });
    }
    const agentId = BigInt(input.agentId);
    const erc8004 = yield* Erc8004;
    const onChain = yield* erc8004.agent(agentId);
    if (onChain === null) {
      return yield* new InvalidRequest({
        message: `Agent #${agentId} was not found on the Identity Registry`,
      });
    }
    if (onChain.owner.toLowerCase() !== wallet.toLowerCase()) {
      return yield* new InvalidRequest({
        message: `Agent #${agentId} is owned by ${onChain.owner}, not your wallet`,
      });
    }
    if (!onChain.uri.endsWith(registrationPath(nodeId))) {
      return yield* new InvalidRequest({
        message: `Agent #${agentId} points at ${onChain.uri}, not this node's registration file`,
      });
    }
    const db = yield* Db;
    const values = {
      agentId,
      nodeId,
      ownerWallet: wallet.toLowerCase(),
      registry: IDENTITY_REGISTRY_ID,
      uaid: nodeUaid(nodeId, wallet, agentId),
    };
    const [taken] = yield* db
      .select({ nodeId: agentIdentities.nodeId })
      .from(agentIdentities)
      .where(eq(agentIdentities.agentId, agentId));
    if (taken !== undefined && taken.nodeId !== nodeId) {
      return yield* new InvalidRequest({
        message: `Agent #${agentId} is already linked to another node`,
      });
    }
    yield* db
      .insert(agentIdentities)
      .values(values)
      .onConflictDoUpdate({
        set: {
          agentId: values.agentId,
          lastFeedbackTx: null,
          lastReportedAt: null,
          ownerWallet: values.ownerWallet,
          uaid: values.uaid,
        },
        target: agentIdentities.nodeId,
      });
    yield* Effect.annotateCurrentSpan({
      "agent.id": input.agentId,
      "node.id": nodeId,
    });
    return yield* identityOf(nodeId);
  },
  dieOnDbError
);

const scaled = (pct: number) => BigInt(Math.round(pct * PCT_SCALE));

/** The feedback to post for a node's last 24 hours; nothing for what was not measured. */
export const feedbackFor = (
  reputation: {
    readonly successPct: number | null;
    readonly ttfbMs: number | null;
    readonly uptimePct: number | null;
  },
  endpoint: string
): Feedback[] => {
  const feedback: Feedback[] = [];
  const add = (tag1: string, value: bigint, decimals: number) =>
    feedback.push({ decimals, endpoint, tag1, tag2: WINDOW_TAG, value });
  if (reputation.uptimePct !== null) {
    add("uptime", scaled(reputation.uptimePct), PCT_DECIMALS);
  }
  if (reputation.ttfbMs !== null) {
    add("ttfbMs", BigInt(reputation.ttfbMs), 0);
  }
  if (reputation.successPct !== null) {
    add("successRate", scaled(reputation.successPct), PCT_DECIMALS);
  }
  return feedback;
};

/** One cron run: posts reputation for agents not reported in the last few hours. */
export const reportReputation = Effect.fn("agents.reportReputation")(
  function* reportReputationGen(now: Date) {
    const erc8004 = yield* Erc8004;
    if (erc8004.monitor === null) {
      return { reported: [], skipped: "REPUTATION_MONITOR_KEY is not set" };
    }
    const db = yield* Db;
    const config = yield* ApiConfig;
    const due = yield* db
      .select()
      .from(agentIdentities)
      .where(
        or(
          isNull(agentIdentities.lastReportedAt),
          lt(
            agentIdentities.lastReportedAt,
            new Date(now.getTime() - REPORT_EVERY_MS)
          )
        )
      )
      .orderBy(asc(agentIdentities.lastReportedAt))
      .limit(AGENTS_PER_RUN);
    const reputation = yield* nodeReputation(
      due.map((row) => row.nodeId),
      now,
      config.nodeStaleMs
    );
    const endpoint = `${config.gatewayUrl}/v1/chat/completions`;
    const reported: { agentId: string; transactions: string[] }[] = [];
    for (const row of due) {
      const measured = reputation.get(row.nodeId);
      const feedback =
        measured === undefined ? [] : feedbackFor(measured, endpoint);
      // Sequential on purpose: one monitor wallet, so one nonce at a time.
      // oxlint-disable-next-line unicorn/no-array-method-this-argument -- Effect.forEach, not Array#forEach
      const transactions = yield* Effect.forEach(feedback, (f) =>
        erc8004.giveFeedback(row.agentId, f)
      ).pipe(
        Effect.tapError((cause) =>
          Effect.logWarning("posting reputation failed", {
            agentId: row.agentId.toString(),
            cause,
          })
        ),
        Effect.orElseSucceed((): string[] => [])
      );
      if (transactions.length === 0 && feedback.length > 0) {
        continue;
      }
      yield* db
        .update(agentIdentities)
        .set({
          lastFeedbackTx: transactions.at(-1) ?? row.lastFeedbackTx,
          lastReportedAt: now,
        })
        .where(eq(agentIdentities.nodeId, row.nodeId));
      reported.push({ agentId: row.agentId.toString(), transactions });
    }
    yield* Effect.annotateCurrentSpan({ "agents.reported": reported.length });
    return { reported, skipped: null };
  },
  dieOnDbError
);
