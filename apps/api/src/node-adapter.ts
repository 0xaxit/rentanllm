/**
 * Adapts a fetch-style handler `(Request) => Promise<Response>` to Node's
 * `(IncomingMessage, ServerResponse)`, the signature Vercel's Node.js runtime calls.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebStream } from "node:stream/web";

export type WebHandler = (request: Request) => Promise<Response>;

const BODYLESS_METHODS = new Set(["GET", "HEAD"]);

export const toWebRequest = (req: IncomingMessage): Request => {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol =
    typeof forwardedProto === "string" ? forwardedProto.split(",")[0] : "http";
  const host =
    req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `${protocol}://${String(host)}`);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  const method = req.method ?? "GET";
  const init: RequestInit & { duplex?: "half" } = { headers, method };
  if (!BODYLESS_METHODS.has(method)) {
    init.body = Readable.toWeb(req) as ReadableStream<Uint8Array>;
    init.duplex = "half";
  }
  return new Request(url, init);
};

export const writeWebResponse = async (
  response: Response,
  res: ServerResponse
): Promise<void> => {
  res.statusCode = response.status;
  for (const [name, value] of response.headers) {
    if (name !== "set-cookie") {
      res.setHeader(name, value);
    }
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) {
    res.setHeader("set-cookie", cookies);
  }
  if (response.body === null) {
    res.end();
    return;
  }
  const body = Readable.fromWeb(
    response.body as unknown as NodeWebStream<Uint8Array>
  );
  await pipeline(body, res);
};

/** `(req, res)` handler; runs `after` once the response is sent (e.g. telemetry flush). */
export const toNodeHandler =
  (handler: WebHandler, after?: () => Promise<void>) =>
  async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const response = await handler(toWebRequest(req));
    await writeWebResponse(response, res);
    if (after !== undefined) {
      await after();
    }
  };
