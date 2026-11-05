/** HTTP flows end to end: real web handler, real Postgres (see support/database.ts). */
import { Db } from "@rentanllm/db";
import { nodeSessions, nodes, sessions, users } from "@rentanllm/db/schema";
import { eq } from "drizzle-orm";
import { Effect, Redacted } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sha256Hex } from "../src/crypto";
import { baseUrl, freshDatabase } from "./support/database";
import { makeTestApp } from "./support/test-app";
import type { TestApp } from "./support/test-app";
import { makeWallet } from "./support/wallet";

const HOUR_MS = 3_600_000;

describe.runIf(baseUrl !== undefined)("api integration", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = makeTestApp(await freshDatabase("http"));
  }, 60_000);

  afterAll(async () => {
    await app?.dispose();
  });

  /** An owner with a node selling open models and one live listing. */
  const setupOwner = async () => {
    const owner = await app.signIn();
    const node = await app.call("POST", "/owner/nodes", {
      body: {},
      cookie: owner.cookie,
    });
    const account = await app.call(
      "POST",
      `/owner/nodes/${node.json.node.id}/accounts`,
      {
        body: { provider: "ollama" },
        cookie: owner.cookie,
      }
    );
    const listing = await app.call("POST", "/owner/listings", {
      body: {
        models: ["llama3.1:8b"],
        priceInPerMtokUsdc: "1600000",
        priceOutPerMtokUsdc: "8000000",
        providerAccountId: account.json.id,
        status: "live",
      },
      cookie: owner.cookie,
    });
    return { account, listing, node, owner };
  };

  describe("sign-in", () => {
    it("creates the user on first sign-in and sets a secure session cookie", async () => {
      const wallet = makeWallet();
      const nonce = await app.call("POST", "/auth/nonce", {
        body: { address: wallet.address },
      });
      expect(nonce.status).toBe(200);
      const verified = await app.call("POST", "/auth/verify", {
        body: await wallet.signIn(nonce.json.nonce),
      });
      expect(verified.status).toBe(200);
      expect(verified.json.user.walletAddress).toBe(wallet.address);
      expect(verified.setCookie).toMatch(/HttpOnly/iu);
      expect(verified.setCookie).toMatch(/Secure/iu);
      expect(verified.setCookie).toMatch(/SameSite=Lax/iu);
      // Host-only (COOKIE_DOMAIN unset), for the whole site: works behind the /api rewrite.
      expect(verified.setCookie).not.toMatch(/Domain=/iu);
      expect(verified.setCookie).toMatch(/Path=\/(?:;|$)/iu);

      const me = await app.call("GET", "/auth/me", {
        cookie: verified.sessionCookie,
      });
      expect(me.status).toBe(200);
      expect(me.json.id).toBe(verified.json.user.id);

      const stored = await app.run(
        Effect.flatMap(Effect.service(Db), (db) =>
          db.select().from(sessions).where(eq(sessions.userId, me.json.id))
        )
      );
      expect(stored).toHaveLength(1);
      expect(stored[0]?.tokenHash).not.toBe(verified.sessionCookie);

      // Same wallet again: same user, no duplicate.
      const again = await app.call("POST", "/auth/nonce", {
        body: { address: wallet.address },
      });
      const second = await app.call("POST", "/auth/verify", {
        body: await wallet.signIn(again.json.nonce),
      });
      expect(second.json.user.id).toBe(verified.json.user.id);
    });

    it("rejects a replayed sign-in and ends the session on logout", async () => {
      const wallet = makeWallet();
      const nonce = await app.call("POST", "/auth/nonce", {
        body: { address: wallet.address },
      });
      const signed = await wallet.signIn(nonce.json.nonce);
      const first = await app.call("POST", "/auth/verify", { body: signed });
      expect(first.status).toBe(200);
      const replay = await app.call("POST", "/auth/verify", { body: signed });
      expect(replay.status).toBe(401);

      const logout = await app.call("POST", "/auth/logout", {
        cookie: first.sessionCookie,
      });
      expect(logout.status).toBe(204);
      const me = await app.call("GET", "/auth/me", {
        cookie: first.sessionCookie,
      });
      expect(me.status).toBe(401);
    });
  });

  describe("owner", () => {
    it("registers a node, returning its id and a token stored only as sha256", async () => {
      const owner = await app.signIn();
      const response = await app.call("POST", "/owner/nodes", {
        body: { mode: "owner_hosted" },
        cookie: owner.cookie,
      });
      expect(response.status).toBe(201);
      const { node, nodeToken } = response.json;
      expect(nodeToken).toMatch(/^rn_node_[A-Za-z0-9_-]{43}$/u);
      expect(node.status).toBe("offline");

      const [row] = await app.run(
        Effect.flatMap(Effect.service(Db), (db) =>
          db.select().from(nodes).where(eq(nodes.id, node.id))
        )
      );
      expect(row?.nodeTokenHash).toBe(sha256Hex(nodeToken));
      expect(JSON.stringify(row)).not.toContain(nodeToken);
      const [user] = await app.run(
        Effect.flatMap(Effect.service(Db), (db) =>
          db.select().from(users).where(eq(users.id, owner.user.id))
        )
      );
      expect(user?.isOwner).toBe(true);

      const list = await app.call("GET", "/owner/nodes", {
        cookie: owner.cookie,
      });
      expect(list.json.map((item: { id: string }) => item.id)).toEqual([
        node.id,
      ]);
    });

    it("rotates a lost node token: new one works, old hash is gone, others get 404", async () => {
      const owner = await app.signIn();
      const registered = await app.call("POST", "/owner/nodes", {
        body: {},
        cookie: owner.cookie,
      });
      const { node, nodeToken: oldToken } = registered.json;

      const rotated = await app.call("POST", `/owner/nodes/${node.id}/token`, {
        cookie: owner.cookie,
      });
      expect(rotated.status).toBe(200);
      expect(rotated.json.node.id).toBe(node.id);
      const newToken: string = rotated.json.nodeToken;
      expect(newToken).toMatch(/^rn_node_[A-Za-z0-9_-]{43}$/u);
      expect(newToken).not.toBe(oldToken);

      const [row] = await app.run(
        Effect.flatMap(Effect.service(Db), (db) =>
          db.select().from(nodes).where(eq(nodes.id, node.id))
        )
      );
      expect(row?.nodeTokenHash).toBe(sha256Hex(newToken));

      const stranger = await app.signIn();
      const denied = await app.call("POST", `/owner/nodes/${node.id}/token`, {
        cookie: stranger.cookie,
      });
      expect(denied.status).toBe(404);
    });

    it("takes a plan's tier from what the node reported, not from the owner", async () => {
      const owner = await app.signIn();
      const registered = await app.call("POST", "/owner/nodes", {
        body: {},
        cookie: owner.cookie,
      });
      const nodeId: string = registered.json.node.id;
      expect(registered.json.node.detectedPlans).toEqual({});

      await app.run(
        Effect.flatMap(Effect.service(Db), (db) =>
          db
            .update(nodes)
            .set({ detectedPlans: { ollama: "Open models · self-hosted" } })
            .where(eq(nodes.id, nodeId))
        )
      );
      const detected = await app.call(
        "POST",
        `/owner/nodes/${nodeId}/accounts`,
        {
          body: { planTier: "max_20x", provider: "ollama" },
          cookie: owner.cookie,
        }
      );
      expect(detected.status).toBe(201);
      expect(detected.json).toMatchObject({
        authKind: "api_key",
        planTier: "Open models · self-hosted",
      });

      // Subscription plans are not sold on the market.
      const plan = await app.call("POST", `/owner/nodes/${nodeId}/accounts`, {
        body: { provider: "anthropic" },
        cookie: owner.cookie,
      });
      expect(plan.status).toBe(422);
    });

    it("reports node uptime from tunnel sessions, only to the owner", async () => {
      const owner = await app.signIn();
      const registered = await app.call("POST", "/owner/nodes", {
        body: {},
        cookie: owner.cookie,
      });
      const nodeId: string = registered.json.node.id;

      const empty = await app.call("GET", `/owner/nodes/${nodeId}/uptime`, {
        cookie: owner.cookie,
      });
      expect(empty.status).toBe(200);
      expect(empty.json.trackedSince).toBeNull();
      expect(empty.json.last24h).toEqual({ onlineMs: 0, trackedMs: 0 });

      const now = Date.now();
      await app.run(
        Effect.flatMap(Effect.service(Db), (db) =>
          db.insert(nodeSessions).values({
            connectedAt: new Date(now - 4 * HOUR_MS),
            disconnectedAt: new Date(now - 3 * HOUR_MS),
            endReason: "closed",
            nodeId,
          })
        )
      );
      const uptime = await app.call("GET", `/owner/nodes/${nodeId}/uptime`, {
        cookie: owner.cookie,
      });
      expect(uptime.status).toBe(200);
      expect(uptime.json.last24h.onlineMs).toBe(HOUR_MS);
      expect(uptime.json.last24h.trackedMs).toBeGreaterThanOrEqual(4 * HOUR_MS);
      expect(uptime.json.timeline24h).toHaveLength(1);
      expect(uptime.json.currentSessionSince).toBeNull();

      const stranger = await app.signIn();
      const denied = await app.call("GET", `/owner/nodes/${nodeId}/uptime`, {
        cookie: stranger.cookie,
      });
      expect(denied.status).toBe(404);
    });

    it("creates, updates and pauses a listing with default cut-offs", async () => {
      const { listing, owner } = await setupOwner();
      expect(listing.status).toBe(201);
      expect(listing.json.sessionCutoffPct).toBe(90);
      expect(listing.json.weeklyCutoffPct).toBe(50);
      expect(listing.json.priceInPerMtokUsdc).toBe("1600000");

      const updated = await app.call(
        "PATCH",
        `/owner/listings/${listing.json.id}`,
        {
          body: { priceCacheReadPerMtokUsdc: "80000", weeklyCutoffPct: 40 },
          cookie: owner.cookie,
        }
      );
      expect(updated.status).toBe(200);
      expect(updated.json.weeklyCutoffPct).toBe(40);
      expect(updated.json.priceCacheReadPerMtokUsdc).toBe("80000");

      const paused = await app.call(
        "POST",
        `/owner/listings/${listing.json.id}/pause`,
        {
          cookie: owner.cookie,
        }
      );
      expect(paused.json.status).toBe("paused");
    });

    it("rejects other owners' listings", async () => {
      const { listing } = await setupOwner();
      const stranger = await app.signIn();
      const foreign = await app.call(
        "PATCH",
        `/owner/listings/${listing.json.id}`,
        {
          body: { status: "paused" },
          cookie: stranger.cookie,
        }
      );
      expect(foreign.status).toBe(404);
    });

    it("suggests prices from api_price_refs", async () => {
      const response = await app.call(
        "GET",
        "/pricing/suggestion?provider=anthropic&model=claude-opus-5-5&inputPerMtokUsdc=1600000&outputPerMtokUsdc=8000000"
      );
      expect(response.status).toBe(200);
      expect(response.json.suggested.inputPerMtokUsdc).toBe("1600000");
      expect(response.json.verdict).toBe("fair");
      const missing = await app.call(
        "GET",
        "/pricing/suggestion?provider=anthropic&model=nope"
      );
      expect(missing.status).toBe(404);
    });

    it("lists the models a listing can offer", async () => {
      const response = await app.call("GET", "/pricing/models");
      expect(response.status).toBe(200);
      expect(response.json).toEqual([
        { model: "claude-opus-5-5", provider: "anthropic" },
        { model: "claude-sonnet-5-5", provider: "anthropic" },
        { model: "gpt-6-sol", provider: "openai" },
      ]);
    });

    it("takes one model name per listing; another model is another listing", async () => {
      const { account, listing, owner } = await setupOwner();
      const listingFor = (models: readonly string[]) =>
        app.call("POST", "/owner/listings", {
          body: {
            models,
            priceInPerMtokUsdc: "800000",
            priceOutPerMtokUsdc: "4000000",
            providerAccountId: account.json.id,
          },
          cookie: owner.cookie,
        });

      const badName = await listingFor(["Not A Model!"]);
      expect(badName.status).toBe(422);
      const two = await listingFor(["qwen2.5:7b", "mistral:7b"]);
      expect(two.status).toBe(400);
      const qwen = await listingFor(["qwen2.5:7b"]);
      expect(qwen.status).toBe(201);
      expect(qwen.json.models).toEqual(["qwen2.5:7b"]);
      expect(qwen.json.id).not.toBe(listing.json.id);
    });
  });

  describe("cron", () => {
    it("requires the cron secret", async () => {
      const denied = await app.call("GET", "/cron/tick", { bearer: "nope" });
      expect(denied.status).toBe(401);
      const missing = await app.call("GET", "/cron/tick");
      expect(missing.status).toBe(401);
      const ok = await app.call("GET", "/cron/tick", {
        bearer: Redacted.value(app.config.cronSecret),
      });
      expect(ok.status).toBe(200);
      expect(ok.json).toHaveProperty("nodesMarkedOffline");
    });
  });
});
