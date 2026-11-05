import { METER_MAX_AGE_MS } from "@rentanllm/protocol";
import type { Provider, UsageMeters } from "@rentanllm/protocol";
import { Context, Effect, Layer, Ref } from "effect";

import { metersAreFresh } from "./admission.ts";
import { NodeConfig } from "./config.ts";
import { CredentialStore } from "./credentials.ts";
import { Providers } from "./providers/registry.ts";
import { UpstreamHttp } from "./upstream.ts";

export interface MeterReaderShape {
  /** Records meters from a provider response's headers, if it carries any. */
  readonly observe: (
    provider: Provider,
    headers: Readonly<Record<string, string>>
  ) => Effect.Effect<void>;
  /** Latest reading, or null. Staleness is judged by the caller against METER_MAX_AGE_MS. */
  readonly read: (provider: Provider) => Effect.Effect<UsageMeters | null>;
  /** Refreshes a stale reading by probing the provider, when supported. Never fails. */
  readonly refreshIfStale: (provider: Provider) => Effect.Effect<void>;
  /**
   * Probes once per run while there is no reading yet, even with the node closed, so the
   * gateway learns what the credential is (the plan label) before anything is listed.
   */
  readonly detect: (provider: Provider) => Effect.Effect<void>;
}

export class MeterReader extends Context.Service<
  MeterReader,
  MeterReaderShape
>()("rentanllm/MeterReader") {}

/** Fallback: no meters, ever. The node then fails closed with `meters_unreadable`. */
export const MeterReaderNull = Layer.succeed(MeterReader, {
  detect: () => Effect.void,
  observe: () => Effect.void,
  read: () => Effect.succeed(null),
  refreshIfStale: () => Effect.void,
});

/** Reads meters from provider rate-limit response headers, with an optional probe request. */
export const MeterReaderHeaders = Layer.effect(
  MeterReader,
  Effect.gen(function* MeterReaderHeaders() {
    const config = yield* NodeConfig;
    const providers = yield* Providers;
    const credentials = yield* CredentialStore;
    const upstream = yield* UpstreamHttp;
    const latest = yield* Ref.make<ReadonlyMap<Provider, UsageMeters>>(
      new Map()
    );
    const detectTried = yield* Ref.make<ReadonlySet<Provider>>(new Set());

    const observe = (
      provider: Provider,
      headers: Readonly<Record<string, string>>
    ): Effect.Effect<void> => {
      const adapter = providers.adapters.get(provider);
      const meters = adapter?.readMeters(headers, new Date()) ?? null;
      if (meters === null) {
        return Effect.void;
      }
      return Ref.update(latest, (current) =>
        new Map(current).set(provider, meters)
      );
    };

    const read = (provider: Provider) =>
      Effect.map(Ref.get(latest), (m) => m.get(provider) ?? null);

    const probe = (provider: Provider) =>
      Effect.gen(function* probeProgram() {
        const adapter = providers.adapters.get(provider);
        if (adapter === undefined) {
          return;
        }
        const credential = yield* credentials.get(provider);
        const request = adapter.meterProbe(credential);
        if (request === null) {
          return;
        }
        const response = yield* upstream.post(request);
        yield* observe(provider, response.headers);
        if (adapter.readMeters(response.headers, new Date()) === null) {
          const hint = adapter.missingMetersHint
            ? `; ${adapter.missingMetersHint}`
            : "";
          yield* Effect.logWarning(
            `meter probe for ${provider} returned no usage meters (HTTP ${response.status})${hint}`
          );
        }
      }).pipe(
        Effect.scoped,
        Effect.tapError((failure) =>
          Effect.logWarning(`meter probe failed: ${failure.message}`)
        ),
        Effect.ignore
      );

    const refreshIfStale = (provider: Provider) =>
      Effect.gen(function* refreshProgram() {
        if (!config.meterProbe) {
          return;
        }
        const current = yield* read(provider);
        // Refresh at half the max age so an idle-but-open node never lapses into stale meters.
        if (!metersAreFresh(current, Date.now() + METER_MAX_AGE_MS / 2)) {
          yield* probe(provider);
        }
      });

    const detect = (provider: Provider) =>
      Effect.gen(function* detectProgram() {
        const tried = yield* Ref.get(detectTried);
        if (!config.meterProbe || tried.has(provider)) {
          return;
        }
        yield* Ref.set(detectTried, new Set(tried).add(provider));
        if ((yield* read(provider)) === null) {
          yield* probe(provider);
        }
      });

    return { detect, observe, read, refreshIfStale };
  })
);
