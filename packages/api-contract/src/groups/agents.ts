import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

import { NotFound } from "../errors/not-found";
import { AgentRegistrationFileSchema, UuidSchema } from "../schemas";

/**
 * Public agent files. A seller node's ERC-8004 `agentURI` points here, so anyone resolving
 * the agent on chain reads what it sells, where to call it and its HCS-14 UAID.
 */
export class AgentsGroup extends HttpApiGroup.make("agents")
  .add(
    HttpApiEndpoint.get("registration", "/:nodeId/registration.json", {
      error: NotFound,
      params: { nodeId: UuidSchema },
      success: AgentRegistrationFileSchema,
    })
  )
  .prefix("/agents") {}
