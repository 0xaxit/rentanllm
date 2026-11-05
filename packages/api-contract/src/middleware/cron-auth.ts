import { HttpApiMiddleware, HttpApiSecurity } from "effect/http-api";

import { Unauthorized } from "../errors/unauthorized";

/** `Authorization: Bearer <CRON_SECRET>`, as sent by Vercel Cron Jobs. */
export class CronAuth extends HttpApiMiddleware.Service<CronAuth>()(
  "@rentanllm/api-contract/CronAuth",
  {
    error: Unauthorized,
    security: { bearer: HttpApiSecurity.bearer },
  }
) {}
