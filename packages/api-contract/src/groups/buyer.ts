import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

import { InvalidRequest } from "../errors/invalid-request";
import { Authentication } from "../middleware/authentication";
import {
  AgentWalletSchema,
  BuyerOverviewSchema,
  BuyerPolicySchema,
  UpdateBuyerPolicyRequestSchema,
} from "../schemas";

/**
 * Buyer endpoints. A buyer signs in with the wallet behind their paying Hedera account;
 * the gateway enforces the saved limits on every payment from that account, whatever
 * client sends it.
 */
export class BuyerGroup extends HttpApiGroup.make("buyer")
  .add(
    /** The linked account, the limits, and what it paid in the last 24 hours. */
    HttpApiEndpoint.get("overview", "/overview", {
      success: BuyerOverviewSchema,
    }),
    /** Saves the limits. Fails when the sign-in wallet has no Hedera account yet. */
    HttpApiEndpoint.put("updatePolicy", "/policy", {
      error: InvalidRequest,
      payload: UpdateBuyerPolicyRequestSchema,
      success: BuyerPolicySchema,
    }),
    /** The agent wallet the remote MCP server pays from; null before it is created. */
    HttpApiEndpoint.get("agentWallet", "/agent-wallet", {
      success: Schema.NullOr(AgentWalletSchema),
    }),
    /** Creates the agent wallet (once; later calls return the same one). */
    HttpApiEndpoint.post("createAgentWallet", "/agent-wallet", {
      error: InvalidRequest,
      success: AgentWalletSchema,
    })
  )
  .middleware(Authentication)
  .prefix("/buyer") {}
