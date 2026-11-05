import { RentAnLlmApi } from "@rentanllm/api-contract";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

export const SystemHandlers = HttpApiBuilder.group(
  RentAnLlmApi,
  "system",
  (handlers) =>
    handlers.handle("health", () => Effect.succeed({ status: "ok" as const }))
);
