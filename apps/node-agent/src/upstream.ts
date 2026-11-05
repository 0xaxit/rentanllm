import { Context, Effect, Layer, Stream } from "effect";
import type { Scope } from "effect";

import type { UpstreamRequest } from "./providers/adapter.ts";
import { UpstreamError } from "./upstream-error.ts";

export interface UpstreamResponse {
  readonly body: Stream.Stream<Uint8Array, UpstreamError>;
  readonly headers: Readonly<Record<string, string>>;
  readonly status: number;
}

export interface UpstreamHttpShape {
  /**
   * POSTs to the provider. The request is aborted when the surrounding scope closes, so
   * interrupting the request fiber (CancelRequest, tunnel drop) tears down the upstream call.
   */
  readonly post: (
    request: UpstreamRequest
  ) => Effect.Effect<UpstreamResponse, UpstreamError, Scope.Scope>;
}

export class UpstreamHttp extends Context.Service<
  UpstreamHttp,
  UpstreamHttpShape
>()("rentanllm/UpstreamHttp") {}

const headersToRecord = (headers: Headers): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of headers) {
    out[key] = value;
  }
  return out;
};

/**
 * Plain `fetch`, so exactly the headers we build leave the machine (no tracing or client
 * fingerprint headers are added).
 */
export const makeFetchUpstream = (
  fetchImpl: typeof globalThis.fetch = globalThis.fetch
): UpstreamHttpShape => ({
  post: (request) =>
    Effect.gen(function* post() {
      const controller = yield* Effect.acquireRelease(
        Effect.sync(() => new AbortController()),
        (c) => Effect.sync(() => c.abort())
      );
      const response = yield* Effect.tryPromise({
        catch: (cause) =>
          new UpstreamError({
            message: `upstream request failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          }),
        try: () =>
          fetchImpl(request.url, {
            body: request.body,
            headers: request.headers,
            method: "POST",
            redirect: "error",
            signal: controller.signal,
          }),
      });
      const { body } = response;
      return {
        body:
          body === null
            ? Stream.empty
            : Stream.fromReadableStream({
                evaluate: () => body,
                onError: (cause) =>
                  new UpstreamError({
                    message: `upstream stream failed: ${cause instanceof Error ? cause.message : String(cause)}`,
                  }),
              }),
        headers: headersToRecord(response.headers),
        status: response.status,
      };
    }),
});

export const UpstreamHttpFetch = Layer.succeed(
  UpstreamHttp,
  makeFetchUpstream()
);
