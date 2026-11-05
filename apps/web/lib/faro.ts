/**
 * Grafana Faro browser telemetry: errors, web vitals, sessions and page views,
 * sent to the Alloy `faro.receiver` behind https://otel.<host>/collect.
 * Loaded (dynamically, so the SDK is not in the main bundle) by
 * `instrumentation-client.ts` only when NEXT_PUBLIC_FARO_URL is set.
 *
 * Browsers cannot keep a secret, so there is no bearer token: the receiver
 * checks the app key (NEXT_PUBLIC_FARO_APP_KEY, public by design) and Caddy
 * only forwards requests whose Origin is the web app's.
 */
import { getWebInstrumentations, initializeFaro } from "@grafana/faro-web-sdk";
import type { Faro } from "@grafana/faro-web-sdk";

export interface FaroSettings {
  readonly url: string;
  readonly appKey: string | undefined;
  readonly environment: string;
  readonly version: string | undefined;
}

export const startFaro = (settings: FaroSettings): Faro =>
  initializeFaro({
    app: {
      environment: settings.environment,
      name: "rentanllm-web",
      ...(settings.version ? { version: settings.version } : {}),
    },
    ...(settings.appKey ? { apiKey: settings.appKey } : {}),
    instrumentations: getWebInstrumentations({ captureConsole: false }),
    sessionTracking: { enabled: true },
    url: settings.url,
  });
