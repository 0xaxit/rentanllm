import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

import { NotFound } from "../errors/not-found";
import { Authentication } from "../middleware/authentication";
import { OAuthGrantSchema, OAuthRedirectSchema } from "../schemas";

const GrantIdSchema = Schema.String.check(Schema.isMinLength(16));

/**
 * The consent step of the MCP connector's OAuth flow. /oauth/authorize (a plain route)
 * sends the browser to the web app's consent page with a grant id; the signed-in user
 * approves or denies it here, and is sent back to the client with a code or an error.
 */
export class OAuthGroup extends HttpApiGroup.make("oauth")
  .add(
    HttpApiEndpoint.get("grant", "/:grantId", {
      error: NotFound,
      params: { grantId: GrantIdSchema },
      success: OAuthGrantSchema,
    }),
    HttpApiEndpoint.post("approve", "/:grantId/approve", {
      error: NotFound,
      params: { grantId: GrantIdSchema },
      success: OAuthRedirectSchema,
    }),
    HttpApiEndpoint.post("deny", "/:grantId/deny", {
      error: NotFound,
      params: { grantId: GrantIdSchema },
      success: OAuthRedirectSchema,
    })
  )
  .middleware(Authentication)
  .prefix("/oauth/grants") {}
