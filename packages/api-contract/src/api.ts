import { HttpApi, OpenApi } from "effect/http-api";

import { AgentsGroup } from "./groups/agents";
import { ApprovalsGroup } from "./groups/approvals";
import { AuthGroup } from "./groups/auth";
import { BuyerGroup } from "./groups/buyer";
import { CronGroup } from "./groups/cron";
import { MarketGroup } from "./groups/market";
import { OAuthGroup } from "./groups/oauth";
import { OwnerGroup } from "./groups/owner";
import { PricingGroup } from "./groups/pricing";
import { SystemGroup } from "./groups/system";

/** The RentAnLLM control-plane API. Serve it with HttpApiBuilder; derive clients with HttpApiClient. */
export class RentAnLlmApi extends HttpApi.make("rentanllm")
  .add(SystemGroup)
  .add(AuthGroup)
  .add(PricingGroup)
  .add(MarketGroup)
  .add(OwnerGroup)
  .add(BuyerGroup)
  .add(AgentsGroup)
  .add(OAuthGroup)
  .add(CronGroup)
  .add(ApprovalsGroup)
  .annotateMerge(OpenApi.annotations({ title: "RentAnLLM API" })) {}
