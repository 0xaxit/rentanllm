import { RentAnLlmApi } from "@rentanllm/api-contract";
import type { Db } from "@rentanllm/db";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { currentDate } from "../../clock";
import type { ApiConfig } from "../../config";
import { runTick } from "../../services/scheduler";
import { captureServices } from "../app-services";

export const CronHandlers = HttpApiBuilder.group(
  RentAnLlmApi,
  "cron",
  Effect.fn(function* cronHandlers(handlers) {
    const provide = yield* captureServices<ApiConfig | Db>();
    return handlers.handle("tick", () =>
      provide(currentDate.pipe(Effect.flatMap(runTick)))
    );
  })
);
