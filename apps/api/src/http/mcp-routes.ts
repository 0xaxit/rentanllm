/**
 * Plain HTTP routes outside the typed API: the hosted MCP endpoint and the OAuth 2.1
 * endpoints an MCP client (Claude Desktop's custom connector) discovers and calls.
 *
 *   /.well-known/oauth-protected-resource[/mcp]   RFC 9728: where to get a token
 *   /.well-known/oauth-authorization-server       RFC 8414: the endpoints below
 *   POST /oauth/register                          RFC 7591 dynamic registration
 *   GET  /oauth/authorize                         -> the web app's consent page
 *   POST /oauth/token                             code (PKCE) and refresh grants
 *   POST /mcp                                     Streamable HTTP, bearer token
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Db } from "@rentanllm/db";
import { paidRequests } from "@rentanllm/db/schema";
import { desc, eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import type { Context } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { currentDate } from "../clock";
import { ApiConfig } from "../config";
import type { AgentWalletChain } from "../hedera/agent-wallets";
import { HederaMirror } from "../hedera/mirror";
import { buildMcpServer } from "../mcp/server";
import { agentWalletSigner } from "../services/agent-wallet";
import type { OAuthFailure } from "../services/oauth";
import {
  exchangeToken,
  registerClient,
  startAuthorization,
  userForAccessToken,
} from "../services/oauth";

const RECENT_PAYMENTS = 10;
const BEARER = /^Bearer\s+(?<token>\S+)$/iu;
const NO_STORE = { "cache-control": "no-store" };

type Services = ApiConfig | Db | HederaMirror | AgentWalletChain;

const jsonResponse = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
) =>
  HttpServerResponse.jsonUnsafe(body, {
    headers: { ...NO_STORE, ...headers },
    status,
  });

const oauthError = (failure: OAuthFailure) =>
  jsonResponse(
    { error: failure.error, error_description: failure.description },
    failure.status
  );

const metadataRoutes = Effect.gen(function* metadataRoutesGen() {
  const config = yield* ApiConfig;
  const issuer = config.publicUrl;
  const resource = {
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
    resource: `${issuer}/mcp`,
    resource_name: "RentAnLLM",
    scopes_supported: ["market"],
  };
  const server = {
    authorization_endpoint: `${issuer}/oauth/authorize`,
    code_challenge_methods_supported: ["S256"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    issuer,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ["code"],
    scopes_supported: ["market"],
    token_endpoint: `${issuer}/oauth/token`,
    token_endpoint_auth_methods_supported: ["none"],
  };
  return [
    HttpRouter.route(
      "GET",
      "/.well-known/oauth-protected-resource",
      Effect.succeed(jsonResponse(resource))
    ),
    HttpRouter.route(
      "GET",
      "/.well-known/oauth-protected-resource/mcp",
      Effect.succeed(jsonResponse(resource))
    ),
    HttpRouter.route(
      "GET",
      "/.well-known/oauth-authorization-server",
      Effect.succeed(jsonResponse(server))
    ),
  ];
});

const register = Effect.gen(function* registerGen() {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const body = yield* request.json.pipe(Effect.orElseSucceed(() => null));
  return yield* registerClient(body).pipe(
    Effect.map((client) => jsonResponse(client, 201)),
    Effect.catch((error: OAuthFailure) => Effect.succeed(oauthError(error)))
  );
});

const authorize = Effect.gen(function* authorizeGen() {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const config = yield* ApiConfig;
  const params = new URL(request.url, config.publicUrl).searchParams;
  const result = yield* startAuthorization(params, yield* currentDate).pipe(
    Effect.catch((error: OAuthFailure) => Effect.succeed({ failure: error }))
  );
  if ("failure" in result) {
    return HttpServerResponse.text(
      `This connection request is invalid: ${result.failure.description}`,
      { status: 400 }
    );
  }
  if ("redirect" in result) {
    return HttpServerResponse.redirect(result.redirect, { status: 302 });
  }
  const web = config.webOrigins[0] ?? config.publicUrl;
  return HttpServerResponse.redirect(
    `${web}/connect?grant=${encodeURIComponent(result.grantId)}`,
    { status: 302 }
  );
});

const token = Effect.gen(function* tokenGen() {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const raw = yield* request.text.pipe(Effect.orElseSucceed(() => ""));
  const form = new URLSearchParams(raw);
  return yield* exchangeToken(form, yield* currentDate).pipe(
    Effect.map((tokens) => jsonResponse(tokens)),
    Effect.catch((error: OAuthFailure) => Effect.succeed(oauthError(error)))
  );
});

/** Runs an Effect with the services captured when the route was built. */
const runner =
  (services: Context.Context<Services>) =>
  <A>(effect: Effect.Effect<A, never, Services>): Promise<A> =>
    Effect.runPromise(Effect.provideContext(effect, services));

const mcp = Effect.gen(function* mcpGen() {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const config = yield* ApiConfig;
  const challenge = {
    "www-authenticate": `Bearer resource_metadata="${config.publicUrl}/.well-known/oauth-protected-resource/mcp"`,
  };
  const bearer = BEARER.exec(request.headers.authorization ?? "")?.groups
    ?.token;
  const userId =
    bearer === undefined
      ? null
      : yield* userForAccessToken(bearer, yield* currentDate);
  if (userId === null) {
    return jsonResponse(
      { error: "invalid_token", error_description: "Sign in to RentAnLLM" },
      401,
      challenge
    );
  }
  const run = runner(yield* Effect.context<Services>());
  const server = buildMcpServer({
    balance: (accountId) =>
      run(
        Effect.flatMap(Effect.service(HederaMirror), (m) =>
          m.usdcBalance(accountId)
        )
      ),
    gatewayUrl: config.gatewayUrl,
    recent: (accountId) =>
      run(
        Effect.gen(function* recentGen() {
          const db = yield* Db;
          const rows = yield* db
            .select()
            .from(paidRequests)
            .where(eq(paidRequests.payer, accountId))
            .orderBy(desc(paidRequests.createdAt))
            .limit(RECENT_PAYMENTS);
          return rows.map((row) => ({
            createdAt: row.createdAt,
            model: row.model,
            paidMicros: row.paidUsdcMicros,
            payTo: row.payTo,
            tx: row.paymentTx,
          }));
        }).pipe(Effect.orDie)
      ),
    signer: () => run(agentWalletSigner(userId)),
    walletPage: `${config.webOrigins[0] ?? config.publicUrl}/market?use=mcp`,
  });
  // Stateless: no session id option at all, every POST stands alone.
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  yield* Effect.promise(() => server.connect(transport));
  const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);
  const response = yield* Effect.promise(() => transport.handleRequest(web));
  return HttpServerResponse.fromWeb(response);
});

/** All of the above as router routes. */
export const McpRoutes = Layer.unwrap(
  Effect.gen(function* mcpRoutesGen() {
    const metadata = yield* metadataRoutes;
    // Captured once, so each route needs only the request from the router.
    const services = yield* Effect.context<Services>();
    const withServices = <A, E>(
      effect: Effect.Effect<
        A,
        E,
        Services | HttpServerRequest.HttpServerRequest
      >
    ) => Effect.provide(effect, services);
    return HttpRouter.addAll([
      ...metadata,
      HttpRouter.route("POST", "/oauth/register", withServices(register)),
      HttpRouter.route("GET", "/oauth/authorize", withServices(authorize)),
      HttpRouter.route("POST", "/oauth/token", withServices(token)),
      HttpRouter.route("POST", "/mcp", withServices(mcp)),
      HttpRouter.route(
        "GET",
        "/mcp",
        Effect.succeed(
          HttpServerResponse.text("Use POST (Streamable HTTP, stateless)", {
            status: 405,
          })
        )
      ),
    ]);
  })
);
