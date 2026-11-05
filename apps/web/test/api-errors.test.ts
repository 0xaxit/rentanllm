import { describe, expect, it } from "vitest";

import { toApiError } from "@/lib/api/errors";

const failure = (status: number) => ({
  _tag: "HttpClientError",
  reason: { _tag: "StatusCodeError", response: { status } },
});

describe("toApiError", () => {
  it("keeps the contract's tagged errors and their messages", () => {
    expect(
      toApiError({ _tag: "Conflict", message: "Overlaps another booking" })
    ).toEqual({ kind: "Conflict", message: "Overlaps another booking" });
    expect(toApiError({ _tag: "Unauthorized", message: "" }).kind).toBe(
      "Unauthorized"
    );
  });

  it("maps HTTP status failures", () => {
    expect(toApiError(failure(401)).kind).toBe("Unauthorized");
    expect(toApiError(failure(404)).kind).toBe("NotFound");
    expect(toApiError(failure(409)).kind).toBe("Conflict");
    expect(toApiError(failure(422)).kind).toBe("InvalidRequest");
    expect(toApiError(failure(500)).kind).toBe("Unknown");
  });

  it("treats transport failures as network errors and bad bodies as bad responses", () => {
    expect(
      toApiError({
        _tag: "HttpClientError",
        reason: { _tag: "TransportError" },
      }).kind
    ).toBe("Network");
    expect(
      toApiError({
        _tag: "HttpClientError",
        reason: { _tag: "DecodeError", response: { status: 200 } },
      }).kind
    ).toBe("BadResponse");
    expect(toApiError({ _tag: "SchemaError" }).kind).toBe("BadResponse");
  });

  it("never throws on junk", () => {
    expect(toApiError(null).kind).toBe("Unknown");
    expect(toApiError("boom").kind).toBe("Unknown");
  });
});
