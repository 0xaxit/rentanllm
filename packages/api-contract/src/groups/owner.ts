import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";

import { InvalidRequest } from "../errors/invalid-request";
import { NotFound } from "../errors/not-found";
import { Authentication } from "../middleware/authentication";
import {
  AddProviderAccountRequestSchema,
  CreateListingRequestSchema,
  ListingSchema,
  NodeSchema,
  NodeUptimeSchema,
  OwnerDashboardSchema,
  OwnerSalesSchema,
  ProviderAccountSchema,
  RegisterNodeRequestSchema,
  RegisterNodeResponseSchema,
  UpdateListingRequestSchema,
  UuidSchema,
} from "../schemas";

const created = HttpApiSchema.status(201);

/** Owner endpoints. All require a session; resources are scoped to the signed-in owner. */
export class OwnerGroup extends HttpApiGroup.make("owner")
  .add(
    HttpApiEndpoint.post("registerNode", "/nodes", {
      payload: RegisterNodeRequestSchema,
      success: created(RegisterNodeResponseSchema),
    }),
    /**
     * Issues a new node token (shown once) and invalidates the old one, so an owner who
     * lost the token can get a working connect command again. A running agent keeps its
     * tunnel until it reconnects; then it needs the new token.
     */
    HttpApiEndpoint.post("rotateNodeToken", "/nodes/:nodeId/token", {
      error: NotFound,
      params: { nodeId: UuidSchema },
      success: RegisterNodeResponseSchema,
    }),
    HttpApiEndpoint.get("listNodes", "/nodes", {
      success: Schema.Array(NodeSchema),
    }),
    HttpApiEndpoint.get("nodeUptime", "/nodes/:nodeId/uptime", {
      error: NotFound,
      params: { nodeId: UuidSchema },
      success: NodeUptimeSchema,
    }),
    HttpApiEndpoint.post("addProviderAccount", "/nodes/:nodeId/accounts", {
      error: [NotFound, InvalidRequest],
      params: { nodeId: UuidSchema },
      payload: AddProviderAccountRequestSchema,
      success: created(ProviderAccountSchema),
    }),
    HttpApiEndpoint.get("listListings", "/listings", {
      success: Schema.Array(ListingSchema),
    }),
    HttpApiEndpoint.post("createListing", "/listings", {
      error: [NotFound, InvalidRequest],
      payload: CreateListingRequestSchema,
      success: created(ListingSchema),
    }),
    HttpApiEndpoint.patch("updateListing", "/listings/:listingId", {
      error: [NotFound, InvalidRequest],
      params: { listingId: UuidSchema },
      payload: UpdateListingRequestSchema,
      success: ListingSchema,
    }),
    HttpApiEndpoint.post("pauseListing", "/listings/:listingId/pause", {
      error: NotFound,
      params: { listingId: UuidSchema },
      success: ListingSchema,
    }),
    HttpApiEndpoint.get("dashboard", "/dashboard", {
      success: OwnerDashboardSchema,
    }),
    /** What the owner's listings have sold on the pay-per-request market. */
    HttpApiEndpoint.get("sales", "/sales", {
      success: OwnerSalesSchema,
    })
  )
  .middleware(Authentication)
  .prefix("/owner") {}
