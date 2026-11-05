/**
 * Plain, serialisable API errors for components. The Effect client fails with
 * the contract's tagged errors (Unauthorized, NotFound, Conflict, ...),
 * HttpClientError for transport problems and SchemaError for bad payloads;
 * `toApiError` folds all of them into one shape.
 */

export type ApiErrorKind =
  | "Unauthorized"
  | "Forbidden"
  | "NotFound"
  | "Conflict"
  | "InvalidRequest"
  | "Network"
  | "BadResponse"
  | "Unknown";

export interface ApiError {
  readonly kind: ApiErrorKind;
  readonly message: string;
}

export type ApiResult<A> =
  | { readonly ok: true; readonly data: A }
  | { readonly ok: false; readonly error: ApiError };

const CONTRACT_TAGS = new Set<string>([
  "Unauthorized",
  "Forbidden",
  "NotFound",
  "Conflict",
  "InvalidRequest",
]);

const FALLBACK_MESSAGES: Record<ApiErrorKind, string> = {
  BadResponse: "The API sent a response this app could not read.",
  Conflict: "That conflicts with something that already exists.",
  Forbidden: "You can't do that.",
  InvalidRequest: "Some of those values aren't accepted.",
  Network: "Couldn't reach the RentAnLLM API. Check your connection.",
  NotFound: "Not found.",
  Unauthorized: "Sign in with your wallet to continue.",
  Unknown: "Something went wrong.",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const stringField = (
  value: Record<string, unknown>,
  key: string
): string | undefined => {
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : undefined;
};

const statusKind = (status: number): ApiErrorKind => {
  if (status === 401) {
    return "Unauthorized";
  }
  if (status === 403) {
    return "Forbidden";
  }
  if (status === 404) {
    return "NotFound";
  }
  if (status === 409) {
    return "Conflict";
  }
  if (status === 400 || status === 422) {
    return "InvalidRequest";
  }
  return "Unknown";
};

/** Status of a failed response carried by an HttpClientError, if any. */
const responseStatus = (
  reason: Record<string, unknown>
): number | undefined => {
  const { response } = reason;
  if (isRecord(response) && typeof response.status === "number") {
    return response.status;
  }
  return undefined;
};

export const apiError = (kind: ApiErrorKind, message?: string): ApiError => ({
  kind,
  message: message ?? FALLBACK_MESSAGES[kind],
});

/** Folds whatever the Effect client failed with into an `ApiError`. */
export const toApiError = (failure: unknown): ApiError => {
  if (!isRecord(failure)) {
    return apiError("Unknown");
  }
  const tag = stringField(failure, "_tag");
  if (tag !== undefined && CONTRACT_TAGS.has(tag)) {
    return apiError(tag as ApiErrorKind, stringField(failure, "message"));
  }
  if (tag === "HttpClientError" && isRecord(failure.reason)) {
    const { reason } = failure;
    const reasonTag = stringField(reason, "_tag");
    const status = responseStatus(reason);
    if (reasonTag === "StatusCodeError" && status !== undefined) {
      return apiError(statusKind(status));
    }
    if (reasonTag === "TransportError" || reasonTag === "InvalidUrlError") {
      return apiError("Network");
    }
    return apiError("BadResponse");
  }
  if (tag === "SchemaError") {
    return apiError("BadResponse");
  }
  return apiError("Unknown", stringField(failure, "message"));
};

export const isUnauthorized = <A>(result: ApiResult<A>): boolean =>
  !result.ok && result.error.kind === "Unauthorized";
