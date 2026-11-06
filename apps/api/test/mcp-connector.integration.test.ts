/** The Claude Desktop connector: OAuth (DCR, PKCE, consent, refresh) and the hosted MCP. */
import { createHash, randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hederaMirrorStub } from "../src/hedera/mirror";
import { baseUrl, freshDatabase } from "./support/database";
import { makeTestApp } from "./support/test-app";
import type { TestApp } from "./support/test-app";

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const MCP_HEADERS = {
  accept: "application/json, text/event-stream",
  "mcp-protocol-version": "2025-06-18",
};

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { challenge, verifier };
};

describe.runIf(baseUrl !== undefined)("MCP connector", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = makeTestApp(
      await freshDatabase("mcp"),
      {},
      hederaMirrorStub({ usdcBalance: 2_500_000n })
    );
  }, 90_000);

  afterAll(async () => {
    await app?.dispose();
  });

  /** Registers a client and walks a signed-in user through consent; returns tokens. */
  const connect = async (cookie: string) => {
    const client = await app.call("POST", "/oauth/register", {
      body: { client_name: "Claude", redirect_uris: [REDIRECT] },
    });
    expect(client.status).toBe(201);
    const { challenge, verifier } = pkce();
    const query = new URLSearchParams({
      client_id: client.json.client_id,
      code_challenge: challenge,
      code_challenge_method: "S256",
      redirect_uri: REDIRECT,
      resource: "http://api.test/mcp",
      response_type: "code",
      state: "xyz",
    });
    const authorize = await app.call("GET", `/oauth/authorize?${query}`);
    expect(authorize.status).toBe(302);
    const consent = new URL(authorize.headers.get("location") ?? "");
    expect(`${consent.origin}${consent.pathname}`).toBe(
      "http://localhost:3000/connect"
    );
    const grant = consent.searchParams.get("grant") ?? "";

    const info = await app.call("GET", `/oauth/grants/${grant}`, { cookie });
    expect(info.json).toMatchObject({
      clientName: "Claude",
      redirectHost: "claude.ai",
    });
    const approved = await app.call("POST", `/oauth/grants/${grant}/approve`, {
      cookie,
    });
    const back = new URL(approved.json.redirectUrl);
    expect(back.searchParams.get("state")).toBe("xyz");
    const code = back.searchParams.get("code") ?? "";

    const form = {
      client_id: client.json.client_id,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT,
    };
    const tokens = await app.call("POST", "/oauth/token", { form });
    expect(tokens.status).toBe(200);
    expect(tokens.json.token_type).toBe("Bearer");
    const reused = await app.call("POST", "/oauth/token", { form });
    expect(reused.json.error).toBe("invalid_grant");
    return { clientId: client.json.client_id as string, tokens: tokens.json };
  };

  const mcp = (token: string, body: unknown) =>
    app.call("POST", "/mcp", { bearer: token, body, headers: MCP_HEADERS });

  it("advertises OAuth and refuses the MCP endpoint without a token", async () => {
    const resource = await app.call(
      "GET",
      "/.well-known/oauth-protected-resource/mcp"
    );
    expect(resource.json).toMatchObject({
      authorization_servers: ["http://api.test"],
      resource: "http://api.test/mcp",
    });
    const server = await app.call(
      "GET",
      "/.well-known/oauth-authorization-server"
    );
    expect(server.json.code_challenge_methods_supported).toEqual(["S256"]);
    const refused = await mcp("nope", {
      id: 1,
      jsonrpc: "2.0",
      method: "tools/list",
    });
    expect(refused.status).toBe(401);
    expect(refused.headers.get("www-authenticate")).toContain(
      "resource_metadata="
    );
  });

  it("rejects a wrong PKCE verifier and needs a sign-in to approve", async () => {
    const client = await app.call("POST", "/oauth/register", {
      body: { redirect_uris: ["http://evil.test/cb"] },
    });
    expect(client.json.error).toBe("invalid_redirect_uri");
    const ok = await app.call("POST", "/oauth/register", {
      body: { redirect_uris: [REDIRECT] },
    });
    const anonymous = await app.call("GET", "/oauth/grants/abcdefabcdefabcdef");
    expect(anonymous.status).toBe(401);
    const noPkce = await app.call(
      "GET",
      `/oauth/authorize?${new URLSearchParams({
        client_id: ok.json.client_id,
        redirect_uri: REDIRECT,
        response_type: "code",
      })}`
    );
    expect(
      new URL(noPkce.headers.get("location") ?? "").searchParams.get("error")
    ).toBe("invalid_request");
  });

  it("serves the market tools for the signed-in user's agent wallet", async () => {
    const user = await app.signIn();
    const before = await app.call("GET", "/buyer/agent-wallet", {
      cookie: user.cookie,
    });
    expect(before.json).toBeNull();
    const wallet = await app.call("POST", "/buyer/agent-wallet", {
      cookie: user.cookie,
    });
    expect(wallet.status).toBe(200);
    expect(wallet.json.accountId).toMatch(/^0\.0\.\d+$/u);
    expect(wallet.json.usdcBalance).toBe("2500000");
    const again = await app.call("POST", "/buyer/agent-wallet", {
      cookie: user.cookie,
    });
    expect(again.json.accountId).toBe(wallet.json.accountId);

    const { clientId, tokens } = await connect(user.cookie);
    const init = await mcp(tokens.access_token, {
      id: 1,
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
        protocolVersion: "2025-06-18",
      },
    });
    expect(init.status).toBe(200);
    expect(init.json.result.serverInfo.name).toBe("rentanllm");

    const list = await mcp(tokens.access_token, {
      id: 2,
      jsonrpc: "2.0",
      method: "tools/list",
    });
    const names = list.json.result.tools.map((t: { name: string }) => t.name);
    expect(names.toSorted()).toEqual([
      "agent_wallet",
      "buy_inference",
      "generate_image",
      "list_models",
      "quote_inference",
    ]);

    const walletTool = await mcp(tokens.access_token, {
      id: 3,
      jsonrpc: "2.0",
      method: "tools/call",
      params: { arguments: {}, name: "agent_wallet" },
    });
    const walletText = walletTool.json.result.content[0].text as string;
    expect(walletText).toContain(wallet.json.accountId);
    expect(walletText).toContain("2.5 USDC");

    const refreshed = await app.call("POST", "/oauth/token", {
      form: {
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
      },
    });
    expect(refreshed.status).toBe(200);
    const replay = await app.call("POST", "/oauth/token", {
      form: {
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
      },
    });
    expect(replay.json.error).toBe("invalid_grant");
  });
});
