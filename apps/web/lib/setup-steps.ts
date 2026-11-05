/**
 * The owner's path to a live listing, worked out from what exists. Each step's
 * `href` lands on the page for it with `?next=` set, which opens that step's
 * sheet; finishing a step sends the owner to the next one. Everything but
 * registering a node happens on that node's own page.
 */
import type { ApiNode, Listing, ProviderAccount } from "./api/types";

export type SetupStepId = "node" | "plan" | "listing";

export interface SetupStep {
  readonly id: SetupStepId;
  readonly label: string;
  readonly detail: string;
  readonly done: boolean;
  readonly href: string;
}

/** Registering a node opens from the dashboard. */
export const REGISTER_HREF = "/console?next=node";

/** A node's own page, optionally opening one of its setup sheets. */
export const nodeHref = (
  nodeId: string,
  query: Readonly<Record<string, string>> = {}
): string => {
  const search = new URLSearchParams(query).toString();
  return `/console/node/${nodeId}${search ? `?${search}` : ""}`;
};

const listingHref = (account: ProviderAccount): string =>
  nodeHref(account.nodeId, { account: account.id, next: "listing" });

export const setupSteps = (input: {
  readonly nodes: readonly ApiNode[];
  readonly accounts: readonly ProviderAccount[];
  readonly listings: readonly Listing[];
}): readonly SetupStep[] => {
  const registered = input.nodes.length > 0;
  const connected = input.nodes.some((n) => n.connectedAt !== null);
  let nodeDetail = "register it, then run the agent next to Ollama";
  if (connected) {
    nodeDetail = "the agent reached the gateway";
  } else if (registered) {
    nodeDetail = "registered · waiting for the agent to connect";
  }
  const waiting = input.nodes.find((n) => n.connectedAt === null);
  const planless = input.nodes.find(
    (n) => !input.accounts.some((a) => a.nodeId === n.id)
  );
  const unlisted = input.accounts.find(
    (a) => !input.listings.some((l) => l.providerAccountId === a.id)
  );
  return [
    {
      detail: nodeDetail,
      done: connected,
      href: waiting ? nodeHref(waiting.id) : REGISTER_HREF,
      id: "node",
      label: "Connect your node",
    },
    {
      detail: "the node reports the Ollama it sells from",
      done: input.accounts.length > 0,
      href: planless ? nodeHref(planless.id, { next: "plan" }) : "/console",
      id: "plan",
      label: "Turn on open models",
    },
    {
      detail: "which models, and the price per million tokens",
      done: input.listings.length > 0,
      href: unlisted ? listingHref(unlisted) : "/console",
      id: "listing",
      label: "List a model",
    },
  ];
};

/** The first step not done yet, or null when the owner is fully set up. */
export const nextStep = (steps: readonly SetupStep[]): SetupStep | null =>
  steps.find((step) => !step.done) ?? null;

/** Where to send the owner after finishing `done` (the dashboard when nothing is left). */
export const hrefAfter = (
  steps: readonly SetupStep[],
  done: SetupStepId
): string => {
  const rest = steps.find((step) => step.id !== done && !step.done);
  return rest?.href ?? "/console";
};

/** One node's own path to a live listing, so a second node gets its next steps too. */
export interface NodeStep {
  readonly id: SetupStepId;
  readonly label: string;
  readonly detail: string;
  readonly done: boolean;
  /** Where the step happens; null for steps done with a button on the node page. */
  readonly href: string | null;
}

export const nodeSetupSteps = (input: {
  readonly node: ApiNode;
  /** The node's own plans. */
  readonly accounts: readonly ProviderAccount[];
  readonly listings: readonly Listing[];
}): readonly NodeStep[] => {
  const accountIds = new Set(input.accounts.map((a) => a.id));
  const nodeListings = input.listings.filter((l) =>
    accountIds.has(l.providerAccountId)
  );
  const unlisted = input.accounts.find(
    (a) => !nodeListings.some((l) => l.providerAccountId === a.id)
  );
  const connected = input.node.connectedAt !== null;
  const base = input.node.id;
  return [
    {
      detail: connected
        ? "the agent reached the gateway"
        : "run the connect command on the machine running Ollama",
      done: connected,
      href: null,
      id: "node",
      label: "Connect the agent",
    },
    {
      detail: "the node reports the Ollama it sells from",
      done: input.accounts.length > 0,
      href: null,
      id: "plan",
      label: "Turn on open models",
    },
    {
      detail: "which models, and the price per million tokens",
      done: nodeListings.length > 0,
      href: nodeHref(
        base,
        unlisted
          ? { account: unlisted.id, next: "listing" }
          : { next: "listing" }
      ),
      id: "listing",
      label: "List a model",
    },
  ];
};
