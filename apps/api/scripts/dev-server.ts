/**
 * Local server for development: `bun run dev` (reads .env via Bun).
 * Needs DATABASE_URL, SESSION_SECRET, CRON_SECRET, SIWE_DOMAIN; see README.
 */
import { createServer } from "node:http";

import { makeWebHandler } from "../src/app";
import { toNodeHandler } from "../src/node-adapter";

const DEFAULT_PORT = 8788;
const port = Number(process.env.PORT ?? DEFAULT_PORT);
const { dispose, handler } = makeWebHandler();
const server = createServer(toNodeHandler(handler));

server.listen(port, () => {
  process.stdout.write(`rentanllm api on http://localhost:${port}\n`);
});

process.once("SIGINT", () => {
  server.close();
  void dispose();
});
