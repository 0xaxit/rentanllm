import { Context, Effect, Layer, Redacted } from "effect";

import { ApiConfig } from "../config";
import { makeWorldIdp } from "./idp";
import type { WorldIdp } from "./idp";

/** The World IdP client, or null when WORLD_ID_CLIENT_ID / _SECRET are not set. */
export class WorldIdpService extends Context.Service<
  WorldIdpService,
  WorldIdp | null
>()("@rentanllm/api/WorldIdp") {}

export const WorldIdpLive = Layer.effect(WorldIdpService)(
  Effect.gen(function* makeWorldIdpLive() {
    const { world } = yield* ApiConfig;
    if (world === undefined) {
      return null;
    }
    return makeWorldIdp({
      acceptedAcr: world.acceptedAcr,
      clientId: world.clientId,
      clientSecret: Redacted.value(world.clientSecret),
      issuer: world.issuer,
    });
  })
);
