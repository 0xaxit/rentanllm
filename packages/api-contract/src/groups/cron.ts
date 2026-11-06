import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

import { CronAuth } from "../middleware/cron-auth";
import { CronTickResultSchema, ReputationReportSchema } from "../schemas";

/** Vercel Cron Jobs (GET, `Authorization: Bearer $CRON_SECRET`). Every step is idempotent. */
export class CronGroup extends HttpApiGroup.make("cron")
  .add(HttpApiEndpoint.get("tick", "/tick", { success: CronTickResultSchema }))
  /** Posts each registered agent's measured service to the ERC-8004 Reputation Registry, at most every few hours. */
  .add(
    HttpApiEndpoint.get("reputation", "/reputation", {
      success: ReputationReportSchema,
    })
  )
  .middleware(CronAuth)
  .prefix("/cron") {}
