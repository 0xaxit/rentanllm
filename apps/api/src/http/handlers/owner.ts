import { CurrentUser, RentAnLlmApi } from "@rentanllm/api-contract";
import type { Db } from "@rentanllm/db";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import type { SqlClient } from "effect/sql/SqlClient";

import { currentDate } from "../../clock";
import { ApiConfig } from "../../config";
import { ownerSales } from "../../services/market";
import {
  addProviderAccount,
  createListing,
  listListings,
  listNodes,
  nodeUptime,
  ownerDashboard,
  pauseListing,
  registerNode,
  rotateNodeToken,
  updateListing,
} from "../../services/owner";
import { captureServices } from "../app-services";

export const OwnerHandlers = HttpApiBuilder.group(
  RentAnLlmApi,
  "owner",
  Effect.fn(function* ownerHandlers(handlers) {
    const config = yield* ApiConfig;
    const provide = yield* captureServices<Db | SqlClient>();
    /** Runs `f` with the signed-in owner's id and the app services. */
    const asOwner = <A, E, R>(
      f: (ownerId: string, now: Date) => Effect.Effect<A, E, R>
    ) =>
      provide(
        Effect.gen(function* asOwnerGen() {
          const user = yield* Effect.service(CurrentUser);
          return yield* f(user.id, yield* currentDate);
        })
      );
    return handlers
      .handle("registerNode", ({ payload }) =>
        asOwner((ownerId) => registerNode(ownerId, payload))
      )
      .handle("rotateNodeToken", ({ params }) =>
        asOwner((ownerId) => rotateNodeToken(ownerId, params.nodeId))
      )
      .handle("listNodes", () => asOwner(listNodes))
      .handle("nodeUptime", ({ params }) =>
        asOwner((ownerId, now) =>
          nodeUptime(ownerId, params.nodeId, now, config.nodeStaleMs)
        )
      )
      .handle("addProviderAccount", ({ params, payload }) =>
        asOwner((ownerId) =>
          addProviderAccount(ownerId, params.nodeId, payload)
        )
      )
      .handle("listListings", () => asOwner(listListings))
      .handle("createListing", ({ payload }) =>
        asOwner((ownerId) => createListing(ownerId, payload))
      )
      .handle("updateListing", ({ params, payload }) =>
        asOwner((ownerId) => updateListing(ownerId, params.listingId, payload))
      )
      .handle("pauseListing", ({ params }) =>
        asOwner((ownerId) => pauseListing(ownerId, params.listingId))
      )
      .handle("dashboard", () => asOwner((ownerId) => ownerDashboard(ownerId)))
      .handle("sales", () =>
        asOwner((ownerId, now) => ownerSales(ownerId, now))
      );
  })
);
