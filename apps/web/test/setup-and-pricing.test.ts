import { describe, expect, it } from "vitest";

import type { ApiNode, Listing, ProviderAccount } from "../lib/api/types";
import { priceSanity } from "../lib/pricing";
import {
  hrefAfter,
  nextStep,
  nodeSetupSteps,
  setupSteps,
} from "../lib/setup-steps";

const api = { inputPerMtok: 2_000_000n, outputPerMtok: 10_000_000n };

describe("priceSanity", () => {
  it("accepts the fair price and the API price", () => {
    expect(
      priceSanity({ inputPerMtok: 800_000n, outputPerMtok: 4_000_000n }, api)
    ).toBeNull();
    expect(priceSanity(api, api)).toBeNull();
  });

  it("flags more than double the API price on either field", () => {
    expect(
      priceSanity({ inputPerMtok: 4_000_001n, outputPerMtok: 4_000_000n }, api)
    ).toBe("too_high");
  });

  it("flags under 5% of the API price", () => {
    expect(
      priceSanity({ inputPerMtok: 99_999n, outputPerMtok: 4_000_000n }, api)
    ).toBe("too_low");
  });

  it("has nothing to say without an API reference", () => {
    expect(
      priceSanity(
        { inputPerMtok: 1n, outputPerMtok: 1n },
        { inputPerMtok: 0n, outputPerMtok: 0n }
      )
    ).toBeNull();
  });
});

const node = (connectedAt: Date | null) =>
  ({ connectedAt, id: "n1" }) as ApiNode;
const listing = (windows: number) =>
  ({
    id: "l1",
    providerAccountId: "a1",
    windows: Array.from({ length: windows }),
  }) as unknown as Listing;
const account = { id: "a1", nodeId: "n1" } as ProviderAccount;

describe("setupSteps", () => {
  it("counts a registered node as done only once its agent has connected", () => {
    const waiting = setupSteps({
      accounts: [],
      listings: [],
      nodes: [node(null)],
    });
    expect(nextStep(waiting)?.id).toBe("node");
    expect(waiting[0]?.detail).toContain("waiting for the agent");

    const connected = setupSteps({
      accounts: [],
      listings: [],
      nodes: [node(new Date())],
    });
    expect(connected[0]?.done).toBe(true);
    expect(nextStep(connected)?.id).toBe("plan");
    expect(hrefAfter(connected, "node")).toBe("/console/node/n1?next=plan");
  });

  it("walks open models → listing, then back to the dashboard", () => {
    const enabled = setupSteps({
      accounts: [account],
      listings: [],
      nodes: [node(new Date())],
    });
    expect(nextStep(enabled)?.id).toBe("listing");
    expect(hrefAfter(enabled, "plan")).toBe(
      "/console/node/n1?account=a1&next=listing"
    );
    const ready = setupSteps({
      accounts: [account],
      listings: [listing(0)],
      nodes: [node(new Date())],
    });
    expect(nextStep(ready)).toBeNull();
    expect(hrefAfter(ready, "listing")).toBe("/console");
  });
});

describe("nodeSetupSteps", () => {
  const second = {
    connectedAt: new Date(),
    id: "node-2",
  } as ApiNode;
  const plan = { id: "acct-2", nodeId: "node-2" } as ProviderAccount;
  const otherListing = {
    providerAccountId: "acct-1",
    windows: [{}],
  } as unknown as Listing;

  it("gives a later node its own steps after the first node is fully set up", () => {
    const fresh = nodeSetupSteps({
      accounts: [],
      listings: [otherListing],
      node: { ...second, connectedAt: null },
    });
    expect(fresh.find((s) => !s.done)?.id).toBe("node");

    const needsPrice = nodeSetupSteps({
      accounts: [plan],
      listings: [otherListing],
      node: second,
    });
    const next = needsPrice.find((s) => !s.done);
    expect(next?.id).toBe("listing");
    expect(next?.href).toBe("/console/node/node-2?account=acct-2&next=listing");
  });

  it("is done once this node has its own listing", () => {
    const steps = nodeSetupSteps({
      accounts: [plan],
      listings: [
        otherListing,
        { id: "l-2", providerAccountId: "acct-2" } as unknown as Listing,
      ],
      node: second,
    });
    expect(steps.every((s) => s.done)).toBe(true);
  });
});
