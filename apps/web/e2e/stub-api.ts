/**
 * A stand-in for apps/api during the e2e run: Server Components fetch from it
 * (the Playwright config passes it as API_ORIGIN). Browser calls to /api/* are
 * intercepted per test with page.route and never get here.
 *
 *   bun e2e/stub-api.ts            # listens on E2E_API_PORT (default 8799)
 */
import { createServer } from "node:http";
import type { ServerResponse } from "node:http";

import { marketOffers, paidRequests } from "./fixtures";

const DEFAULT_PORT = 8799;
const port = Number(process.env.E2E_API_PORT ?? DEFAULT_PORT);

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const PUBLIC: Readonly<Record<string, () => unknown>> = {
  "/health": () => ({ status: "ok" }),
  "/market/offers": marketOffers,
  "/market/requests": paidRequests,
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://stub");
  const body = PUBLIC[url.pathname];
  if (body) {
    send(res, 200, body());
    return;
  }
  const signedIn = (req.headers.cookie ?? "").includes("rentanllm_session=");
  if (!signedIn) {
    send(res, 401, { _tag: "Unauthorized", message: "Sign in first." });
    return;
  }
  send(res, 404, { _tag: "NotFound", message: "Not in the e2e stub." });
});

server.listen(port, "127.0.0.1");
