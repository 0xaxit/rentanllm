import { OpenApi } from "effect/http-api";
import { describe, expect, it } from "vitest";

import { RentAnLlmApi } from "../src/index";

describe("RentAnLlmApi", () => {
  const spec = OpenApi.fromApi(RentAnLlmApi);

  it("documents every route", () => {
    expect(Object.keys(spec.paths).toSorted()).toEqual([
      "/auth/logout",
      "/auth/me",
      "/auth/nonce",
      "/auth/verify",
      "/cron/tick",
      "/health",
      "/market/offers",
      "/market/requests",
      "/owner/dashboard",
      "/owner/listings",
      "/owner/listings/{listingId}",
      "/owner/listings/{listingId}/pause",
      "/owner/nodes",
      "/owner/nodes/{nodeId}/accounts",
      "/owner/nodes/{nodeId}/token",
      "/owner/nodes/{nodeId}/uptime",
      "/owner/sales",
      "/pricing/models",
      "/pricing/suggestion",
    ]);
  });

  it("lists no absolute server URL, so it works behind the /api rewrite", () => {
    expect(spec.servers ?? []).toEqual([]);
  });

  it("declares the session cookie and the cron bearer scheme", () => {
    expect(
      Object.keys(spec.components.securitySchemes ?? {}).toSorted()
    ).toEqual(["bearer", "session"]);
  });
});
