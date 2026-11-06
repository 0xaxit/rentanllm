/** World IdP client: device start, poll outcomes, and ID-token validation. */
import { beforeAll, describe, expect, it } from "vitest";

import { makeWorldIdp } from "../src/world/idp";
import {
  CLIENT_ID,
  CLIENT_SECRET,
  ISSUER,
  makeFakeWorld,
  SUBJECT,
} from "./support/fake-world";
import type { FakeWorld } from "./support/fake-world";

const MINUTE_MS = 60_000;
const SECOND_MS = 1000;

const context = () => ({
  attemptStartedAt: new Date(Date.now() - SECOND_MS),
  expectedSubject: null,
  now: new Date(),
});

describe("World IdP client", () => {
  let world: FakeWorld;

  beforeAll(async () => {
    world = await makeFakeWorld();
  });

  it("starts a device authorization with the client credentials", async () => {
    const started = await world.idp.startDeviceAuthorization({
      expectedSubject: null,
    });
    expect(started.deviceCode).toMatch(/^device-/u);
    expect(started.verificationUriComplete).toContain(started.userCode);
    const form = world.deviceForms.at(-1);
    expect(form?.get("scope")).toBe("openid");
    expect(form?.get("claims")).toBeNull();
  });

  it("asks World for the linked person when the payer has one", async () => {
    await world.idp.startDeviceAuthorization({ expectedSubject: SUBJECT });
    const claims = JSON.parse(world.deviceForms.at(-1)?.get("claims") ?? "{}");
    expect(claims.id_token.sub.value).toBe(SUBJECT);
  });

  it("reports World refusing the client as unavailable, not as a decision", async () => {
    const wrong = makeWorldIdp({
      acceptedAcr: [],
      clientId: CLIENT_ID,
      clientSecret: "wrong",
      fetch: world.fetch,
      issuer: ISSUER,
      jwks: world.jwks,
    });
    await expect(
      wrong.startDeviceAuthorization({ expectedSubject: null })
    ).rejects.toThrow("invalid_client");
  });

  it.each([
    ["authorization_pending", "pending"],
    ["slow_down", "slow_down"],
    ["access_denied", "denied"],
    ["expired_token", "expired"],
    ["invalid_grant", "failed"],
  ])("maps World's %s to %s", async (code, kind) => {
    world.script([{ error: code }]);
    const { deviceCode } = await world.idp.startDeviceAuthorization({
      expectedSubject: null,
    });
    const result = await world.idp.poll(deviceCode, context());
    expect(result.kind).toBe(kind);
  });

  it("treats a World 5xx as the end of the attempt, never an approval", async () => {
    world.script([{ status: 503 }]);
    const { deviceCode } = await world.idp.startDeviceAuthorization({
      expectedSubject: null,
    });
    expect(await world.idp.poll(deviceCode, context())).toEqual({
      kind: "failed",
      reason: "World ID answered HTTP 503",
    });
  });

  it("accepts a fresh, signed proof of human for this client", async () => {
    world.script([{ claims: {} }]);
    const { deviceCode } = await world.idp.startDeviceAuthorization({
      expectedSubject: null,
    });
    const result = await world.idp.poll(deviceCode, context());
    expect(result.kind).toBe("approved");
    if (result.kind === "approved") {
      expect(result.identity.subject).toBe(SUBJECT);
      expect(result.identity.amr).toEqual(["pop"]);
    }
  });

  const rejects = async (token: string, extra: object = {}) => {
    const result = await world.idp.validateIdToken(token, {
      ...context(),
      ...extra,
    });
    expect(typeof result).toBe("string");
    return result as string;
  };

  it("rejects a token signed with any other key", async () => {
    expect(await rejects(await world.idToken({}, true))).toContain("signature");
  });

  it("rejects a token for another client or issuer", async () => {
    expect(
      await rejects(await world.idToken({ aud: "someone-else" }, false))
    ).toContain("aud");
    expect(
      await rejects(await world.idToken({ iss: "https://evil.example" }, false))
    ).toContain("iss");
  });

  it("rejects an expired token", async () => {
    const past = Math.floor((Date.now() - 10 * MINUTE_MS) / SECOND_MS);
    expect(
      await rejects(await world.idToken({ exp: past, iat: past - 60 }, false))
    ).toContain("expired");
  });

  it("rejects an authentication from before this approval was requested", async () => {
    const old = Math.floor((Date.now() - 10 * MINUTE_MS) / SECOND_MS);
    expect(
      await rejects(await world.idToken({ auth_time: old }, false))
    ).toContain("before this approval");
  });

  it("rejects a login that is not a proof of human", async () => {
    expect(
      await rejects(await world.idToken({ amr: ["pwd"] }, false))
    ).toContain("unique human");
  });

  it("rejects a different person than the one linked to the payer", async () => {
    expect(
      await rejects(await world.idToken({}, false), {
        expectedSubject: "subject-bob",
      })
    ).toContain("different person");
  });

  it("enforces the accepted assurance classes when configured", async () => {
    const strict = makeWorldIdp({
      acceptedAcr: ["https://world.org/oidc/acr/orb-face"],
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      fetch: world.fetch,
      issuer: ISSUER,
      jwks: world.jwks,
    });
    const result = await strict.validateIdToken(
      await world.idToken({}, false),
      context()
    );
    expect(result).toContain("assurance");
  });
});
