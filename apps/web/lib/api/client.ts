/**
 * The typed RentAnLLM API client, derived from the Effect HttpApi contract
 * (`@rentanllm/api-contract`). Effect stays inside this module: callers pass a
 * function that picks an endpoint and get back a plain `ApiResult`.
 *
 *   const result = await callApi((api) => api.owner.dashboard());
 *
 * Works in the browser, same-origin through the `/api` rewrite (the session
 * cookie rides along), and on the server, where `lib/api/server.ts` calls the
 * API directly and forwards the incoming request's cookie.
 */
import { RentAnLlmApi } from "@rentanllm/api-contract";
import { Cause, Effect, Exit } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { HttpApiClient } from "effect/http-api";

import { apiBaseUrl } from "../env";
import { toApiError } from "./errors";
import type { ApiResult } from "./errors";

export type ApiClient = HttpApiClient.ForApi<typeof RentAnLlmApi>;

export interface CallOptions {
  /** Defaults to `<origin>/api` in the browser and SERVER_API_URL on the server. */
  readonly baseUrl?: string;
  /** A `Cookie` header to send (server only; browsers attach cookies themselves). */
  readonly cookie?: string | undefined;
  readonly signal?: AbortSignal;
}

const withCookie =
  (cookie: string) =>
  (client: HttpClient.HttpClient): HttpClient.HttpClient =>
    HttpClient.mapRequest(
      client,
      HttpClientRequest.setHeader("cookie", cookie)
    );

export const callApi = async <A, E, R>(
  run: (api: ApiClient) => Effect.Effect<A, E, R>,
  options: CallOptions = {}
): Promise<ApiResult<A>> => {
  const { baseUrl = apiBaseUrl(), cookie, signal } = options;
  const program = Effect.gen(function* callApiProgram() {
    const api = yield* HttpApiClient.make(RentAnLlmApi, {
      baseUrl,
      transformClient: cookie ? withCookie(cookie) : undefined,
    });
    return yield* run(api);
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.RequestInit, {
      cache: "no-store",
      credentials: "include",
    }),
    // Keep requests plain: no b3/traceparent headers (the API's CORS allows
    // content-type and authorization only, for direct cross-origin callers).
    Effect.provideService(HttpClient.TracerPropagationEnabled, false)
  );
  // Endpoint services are all `never` for this contract; Effect.all over
  // several calls widens R, so pin it back here.
  const exit = await Effect.runPromiseExit(
    program as Effect.Effect<A, unknown>,
    signal ? { signal } : undefined
  );
  if (Exit.isSuccess(exit)) {
    return { data: exit.value, ok: true };
  }
  return { error: toApiError(Cause.squash(exit.cause)), ok: false };
};
