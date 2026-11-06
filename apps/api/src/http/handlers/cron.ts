import { RentAnLlmApi } from "@rentanllm/api-contract";
import type { Db } from "@rentanllm/db";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { currentDate } from "../../clock";
import type { ApiConfig } from "../../config";
import type { Erc8004 } from "../../reputation/erc8004";
import { reportReputation } from "../../services/agents";
import { runTick } from "../../services/scheduler";
import { captureServices } from "../app-services";

export const CronHandlers = HttpApiBuilder.group(
  RentAnLlmApi,
  "cron",
  Effect.fn(function* cronHandlers(handlers) {
    const provide = yield* captureServices<ApiConfig | Db | Erc8004>();
    return handlers
      .handle("tick", () => provide(currentDate.pipe(Effect.flatMap(runTick))))
      .handle("reputation", () =>
        provide(currentDate.pipe(Effect.flatMap(reportReputation)))
      );
  })
);
