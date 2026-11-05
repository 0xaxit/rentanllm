/**
 * Server Component side of the API client: calls the API directly
 * (API_URL / API_ORIGIN) and forwards the browser's session cookie
 * (`rentanllm_session`). The browser gets that cookie from the API through the
 * same-origin `/api` rewrite, so it is host-only on the web app's host and
 * arrives here with every page request; the API needs no COOKIE_DOMAIN.
 */
import { SESSION_COOKIE } from "@rentanllm/api-contract";
import type { Effect } from "effect";
import { cookies } from "next/headers";

import { SERVER_API_URL } from "../env";
import { callApi } from "./client";
import type { ApiClient } from "./client";
import { apiError } from "./errors";
import type { ApiResult } from "./errors";

/** The incoming session cookie as a `Cookie` header value, if present. */
export const sessionCookieHeader = async (): Promise<string | undefined> => {
  const jar = await cookies();
  const session = jar.get(SESSION_COOKIE);
  return session ? `${SESSION_COOKIE}=${session.value}` : undefined;
};

/** Calls the API as the signed-in user; Unauthorized without a session cookie. */
export const serverApi = async <A, E, R>(
  run: (api: ApiClient) => Effect.Effect<A, E, R>
): Promise<ApiResult<A>> => {
  const cookie = await sessionCookieHeader();
  if (cookie === undefined) {
    return { error: apiError("Unauthorized"), ok: false };
  }
  return await callApi(run, { baseUrl: SERVER_API_URL, cookie });
};

/** Calls a public endpoint (no cookie). */
export const publicApi = async <A, E, R>(
  run: (api: ApiClient) => Effect.Effect<A, E, R>
): Promise<ApiResult<A>> => await callApi(run, { baseUrl: SERVER_API_URL });
