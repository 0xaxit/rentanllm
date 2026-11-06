import {
  InvalidRequest,
  NotFound,
  UNDETECTED_PLAN_TIER,
} from "@rentanllm/api-contract";
import type { Listing } from "@rentanllm/api-contract";
import { Db } from "@rentanllm/db";
import {
  listings,
  nodeSessions,
  nodes,
  providerAccounts,
  users,
} from "@rentanllm/db/schema";
import { and, asc, desc, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";
import { Effect } from "effect";

import { newNodeToken } from "../crypto";
import { dieOnDbError } from "../db-errors";
import { HederaMirror, USDC_TOKEN_ID } from "../hedera/mirror";
import { toListing, toNode, toProviderAccount } from "./mappers";
import { requireKnownModels } from "./pricing";
import { computeUptime, WEEK_MS } from "./uptime";

type ListingRow = typeof listings.$inferSelect;
type Provider = Listing["provider"];

export const registerNode = Effect.fn("owner.registerNode")(
  function* registerNodeGen(
    ownerId: string,
    input: {
      readonly mode?: "owner_hosted" | "platform_hosted";
    }
  ) {
    const db = yield* Db;
    const token = newNodeToken();
    const [node] = yield* db
      .insert(nodes)
      .values({
        mode: input.mode ?? "owner_hosted",
        nodeTokenHash: token.hash,
        ownerId,
        // Set by the gateway from where the agent connects, never by the owner.
        region: null,
      })
      .returning();
    if (node === undefined) {
      return yield* Effect.die(new Error("node insert returned no row"));
    }
    yield* db.update(users).set({ isOwner: true }).where(eq(users.id, ownerId));
    yield* Effect.annotateCurrentSpan({ "node.id": node.id });
    return { node: toNode(node), nodeToken: token.secret };
  },
  dieOnDbError
);

export const rotateNodeToken = Effect.fn("owner.rotateNodeToken")(
  function* rotateNodeTokenGen(ownerId: string, nodeId: string) {
    const db = yield* Db;
    const token = newNodeToken();
    const [node] = yield* db
      .update(nodes)
      .set({ nodeTokenHash: token.hash })
      .where(and(eq(nodes.id, nodeId), eq(nodes.ownerId, ownerId)))
      .returning();
    if (node === undefined) {
      return yield* new NotFound({ message: "Node not found" });
    }
    yield* Effect.annotateCurrentSpan({ "node.id": node.id });
    return { node: toNode(node), nodeToken: token.secret };
  },
  dieOnDbError
);

export const listNodes = Effect.fn("owner.listNodes")(function* listNodesGen(
  ownerId: string
) {
  const db = yield* Db;
  const rows = yield* db
    .select()
    .from(nodes)
    .where(eq(nodes.ownerId, ownerId))
    .orderBy(desc(nodes.createdAt), asc(nodes.id));
  return rows.map(toNode);
}, dieOnDbError);

/** A node's uptime from its tunnel sessions (the last 7 days and its first session). */
export const uptimeOf = Effect.fn("owner.uptimeOf")(function* uptimeOfGen(
  node: typeof nodes.$inferSelect,
  now: Date,
  staleMs: number
) {
  const db = yield* Db;
  const nodeId = node.id;
  const weekAgo = new Date(now.getTime() - WEEK_MS);
  const sessions = yield* db
    .select({
      connectedAt: nodeSessions.connectedAt,
      disconnectedAt: nodeSessions.disconnectedAt,
    })
    .from(nodeSessions)
    .where(
      and(
        eq(nodeSessions.nodeId, nodeId),
        lt(nodeSessions.connectedAt, now),
        or(
          isNull(nodeSessions.disconnectedAt),
          gt(nodeSessions.disconnectedAt, weekAgo)
        )
      )
    );
  const [first] = yield* db
    .select({ connectedAt: nodeSessions.connectedAt })
    .from(nodeSessions)
    .where(eq(nodeSessions.nodeId, nodeId))
    .orderBy(asc(nodeSessions.connectedAt))
    .limit(1);
  return computeUptime({
    firstConnectedAt: first?.connectedAt ?? null,
    node,
    now,
    sessions,
    staleMs,
  });
}, dieOnDbError);

export const nodeUptime = Effect.fn("owner.nodeUptime")(function* nodeUptimeGen(
  ownerId: string,
  nodeId: string,
  now: Date,
  staleMs: number
) {
  const db = yield* Db;
  const [node] = yield* db
    .select()
    .from(nodes)
    .where(and(eq(nodes.id, nodeId), eq(nodes.ownerId, ownerId)));
  if (node === undefined) {
    return yield* new NotFound({ message: "Node not found" });
  }
  return yield* uptimeOf(node, now, staleMs);
}, dieOnDbError);

export const addProviderAccount = Effect.fn("owner.addProviderAccount")(
  function* addProviderAccountGen(
    ownerId: string,
    nodeId: string,
    input: {
      readonly credentialRef?: string;
      readonly provider: Provider;
    }
  ) {
    if (input.provider !== "ollama") {
      return yield* new InvalidRequest({
        message: "Only open models (ollama) can be sold on the market.",
      });
    }
    const db = yield* Db;
    const [node] = yield* db
      .select({ detectedPlans: nodes.detectedPlans, id: nodes.id })
      .from(nodes)
      .where(and(eq(nodes.id, nodeId), eq(nodes.ownerId, ownerId)));
    if (node === undefined) {
      return yield* new NotFound({ message: "Node not found" });
    }
    const [account] = yield* db
      .insert(providerAccounts)
      .values({
        // The node agent signs in with an API key; the gateway corrects this from the
        // node's own readings if it reports a subscription.
        authKind: "api_key",
        credentialRef: input.credentialRef ?? null,
        nodeId,
        planTier: node.detectedPlans[input.provider] ?? UNDETECTED_PLAN_TIER,
        provider: input.provider,
      })
      .returning();
    if (account === undefined) {
      return yield* Effect.die(
        new Error("provider account insert returned no row")
      );
    }
    return toProviderAccount(account);
  },
  dieOnDbError
);

/** Listings of `ownerId` (optionally one), with their provider. */
const loadListings = Effect.fn("owner.loadListings")(function* loadListingsGen(
  ownerId: string,
  listingId?: string
) {
  const db = yield* Db;
  const rows = yield* db
    .select({ listing: listings, provider: providerAccounts.provider })
    .from(listings)
    .innerJoin(
      providerAccounts,
      eq(providerAccounts.id, listings.providerAccountId)
    )
    .innerJoin(nodes, eq(nodes.id, providerAccounts.nodeId))
    .where(
      listingId === undefined
        ? eq(nodes.ownerId, ownerId)
        : and(eq(nodes.ownerId, ownerId), eq(listings.id, listingId))
    )
    .orderBy(asc(listings.id));
  return rows.map((row) => toListing(row.listing, row.provider));
});

const loadListing = Effect.fn("owner.loadListing")(function* loadListingGen(
  ownerId: string,
  listingId: string
) {
  const [listing] = yield* loadListings(ownerId, listingId);
  if (listing === undefined) {
    return yield* new NotFound({ message: "Listing not found" });
  }
  return listing;
});

export const listListings = Effect.fn("owner.listListings")(
  function* listListingsGen(ownerId: string) {
    return yield* loadListings(ownerId);
  },
  dieOnDbError
);

export interface ListingInput {
  readonly maxConcurrency?: number;
  readonly models?: readonly string[];
  readonly priceCacheReadPerMtokUsdc?: bigint | null;
  readonly priceCacheWritePerMtokUsdc?: bigint | null;
  readonly priceInPerMtokUsdc?: bigint;
  readonly priceOutPerMtokUsdc?: bigint;
  readonly sessionCutoffPct?: number;
  readonly status?: "draft" | "live" | "paused";
  readonly weeklyCutoffPct?: number;
}

/** Only the fields present in `input`, as a Drizzle update / insert patch. */
const listingPatch = (input: ListingInput): Partial<ListingRow> => {
  const patch: Partial<ListingRow> = {};
  if (input.maxConcurrency !== undefined) {
    patch.maxConcurrency = input.maxConcurrency;
  }
  if (input.models !== undefined) {
    patch.models = [...input.models];
  }
  if (input.priceCacheReadPerMtokUsdc !== undefined) {
    patch.priceCacheReadPerMtokUsdc = input.priceCacheReadPerMtokUsdc;
  }
  if (input.priceCacheWritePerMtokUsdc !== undefined) {
    patch.priceCacheWritePerMtokUsdc = input.priceCacheWritePerMtokUsdc;
  }
  if (input.priceInPerMtokUsdc !== undefined) {
    patch.priceInPerMtokUsdc = input.priceInPerMtokUsdc;
  }
  if (input.priceOutPerMtokUsdc !== undefined) {
    patch.priceOutPerMtokUsdc = input.priceOutPerMtokUsdc;
  }
  if (input.sessionCutoffPct !== undefined) {
    patch.sessionCutoffPct = input.sessionCutoffPct;
  }
  if (input.status !== undefined) {
    patch.status = input.status;
  }
  if (input.weeklyCutoffPct !== undefined) {
    patch.weeklyCutoffPct = input.weeklyCutoffPct;
  }
  return patch;
};

/**
 * Going live needs a Hedera account behind the seller's wallet that can receive USDC;
 * otherwise every buyer's payment to it would fail at settlement. A mirror node that
 * cannot say whether the account can receive USDC does not block.
 */
const requireSellerCanReceiveUsdc = Effect.fn(
  "owner.requireSellerCanReceiveUsdc"
)(function* requireSellerCanReceiveUsdcGen(ownerId: string) {
  const db = yield* Db;
  const mirror = yield* HederaMirror;
  const [owner] = yield* db
    .select({ wallet: users.walletAddress })
    .from(users)
    .where(eq(users.id, ownerId));
  const account =
    owner?.wallet === null || owner?.wallet === undefined
      ? null
      : yield* mirror.accountFor(owner.wallet);
  if (account === null) {
    return yield* new InvalidRequest({
      message:
        "Your sign-in wallet has no Hedera account yet, so buyers cannot pay you. Fund it once on Hedera testnet, then go live.",
    });
  }
  if ((yield* mirror.canReceiveUsdc(account)) === false) {
    return yield* new InvalidRequest({
      message: `Your Hedera account ${account} cannot receive USDC yet. Associate it with token ${USDC_TOKEN_ID} once (a one-time Hedera transaction), then go live.`,
    });
  }
}, dieOnDbError);

export const createListing = Effect.fn("owner.createListing")(
  function* createListingGen(
    ownerId: string,
    input: ListingInput & {
      readonly models: readonly string[];
      readonly priceInPerMtokUsdc: bigint;
      readonly priceOutPerMtokUsdc: bigint;
      readonly providerAccountId: string;
    }
  ) {
    const db = yield* Db;
    const [account] = yield* db
      .select({ id: providerAccounts.id, provider: providerAccounts.provider })
      .from(providerAccounts)
      .innerJoin(nodes, eq(nodes.id, providerAccounts.nodeId))
      .where(
        and(
          eq(providerAccounts.id, input.providerAccountId),
          eq(nodes.ownerId, ownerId)
        )
      );
    if (account === undefined) {
      return yield* new NotFound({ message: "Provider account not found" });
    }
    yield* requireKnownModels(account.provider, input.models);
    if (input.status === "live") {
      yield* requireSellerCanReceiveUsdc(ownerId);
    }
    const [row] = yield* db
      .insert(listings)
      .values({
        ...listingPatch(input),
        models: [...input.models],
        priceInPerMtokUsdc: input.priceInPerMtokUsdc,
        priceOutPerMtokUsdc: input.priceOutPerMtokUsdc,
        providerAccountId: input.providerAccountId,
      })
      .returning({ id: listings.id });
    if (row === undefined) {
      return yield* Effect.die(new Error("listing insert returned no row"));
    }
    return yield* loadListing(ownerId, row.id);
  },
  dieOnDbError
);

export const updateListing = Effect.fn("owner.updateListing")(
  function* updateListingGen(
    ownerId: string,
    listingId: string,
    input: ListingInput
  ) {
    const db = yield* Db;
    const listing = yield* loadListing(ownerId, listingId);
    if (input.models !== undefined) {
      yield* requireKnownModels(listing.provider, input.models);
    }
    if (input.status === "live" && listing.status !== "live") {
      yield* requireSellerCanReceiveUsdc(ownerId);
    }
    const patch = listingPatch(input);
    if (Object.keys(patch).length > 0) {
      yield* db.update(listings).set(patch).where(eq(listings.id, listingId));
    }
    return yield* loadListing(ownerId, listingId);
  },
  dieOnDbError
);

export const pauseListing = (ownerId: string, listingId: string) =>
  updateListing(ownerId, listingId, { status: "paused" }).pipe(
    // Only a models change or going live is validated, and pausing is neither.
    Effect.catchTag("InvalidRequest", Effect.die)
  );

export const ownerDashboard = Effect.fn("owner.dashboard")(
  function* ownerDashboardGen(ownerId: string) {
    const db = yield* Db;
    const ownerNodes = yield* db
      .select()
      .from(nodes)
      .where(eq(nodes.ownerId, ownerId))
      .orderBy(asc(nodes.id));
    const nodeIds = ownerNodes.map((node) => node.id);
    const accounts =
      nodeIds.length === 0
        ? []
        : yield* db
            .select()
            .from(providerAccounts)
            .where(inArray(providerAccounts.nodeId, nodeIds))
            .orderBy(asc(providerAccounts.id));
    return {
      nodes: ownerNodes.map(toNode),
      providerAccounts: accounts.map(toProviderAccount),
    };
  },
  dieOnDbError
);
