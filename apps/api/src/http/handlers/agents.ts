import { RentAnLlmApi } from "@rentanllm/api-contract";
import type { Db } from "@rentanllm/db";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import type { ApiConfig } from "../../config";
import { registrationFile } from "../../services/agents";
import { captureServices } from "../app-services";

export const AgentsHandlers = HttpApiBuilder.group(
  RentAnLlmApi,
  "agents",
  Effect.fn(function* agentsHandlers(handlers) {
    const provide = yield* captureServices<ApiConfig | Db>();
    return handlers.handle("registration", ({ params }) =>
      provide(registrationFile(params.nodeId))
    );
  })
);
