import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

import { CronAuth } from "../middleware/cron-auth";
import { CronTickResultSchema } from "../schemas";

/** Vercel Cron Jobs (GET, `Authorization: Bearer $CRON_SECRET`). Every step is idempotent. */
export class CronGroup extends HttpApiGroup.make("cron")
  .add(HttpApiEndpoint.get("tick", "/tick", { success: CronTickResultSchema }))
  .middleware(CronAuth)
  .prefix("/cron") {}
