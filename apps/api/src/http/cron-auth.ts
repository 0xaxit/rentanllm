import { CronAuth, Unauthorized } from "@rentanllm/api-contract";
import { Effect, Layer, Redacted } from "effect";

import { ApiConfig } from "../config";
import { safeEqual } from "../crypto";

/** Accepts `Authorization: Bearer $CRON_SECRET` (what Vercel Cron Jobs send). */
export const CronAuthLive = Layer.effect(CronAuth)(
  Effect.gen(function* makeCronAuth() {
    const config = yield* ApiConfig;
    const expected = Redacted.value(config.cronSecret);
    return CronAuth.of({
      bearer: (httpEffect, { credential }) =>
        safeEqual(Redacted.value(credential), expected)
          ? httpEffect
          : Effect.fail(new Unauthorized({ message: "Bad cron secret" })),
    });
  })
);
