/**
 * Client-side instrumentation (runs before the app is interactive). Starts
 * Grafana Faro when NEXT_PUBLIC_FARO_URL is set; otherwise does nothing and
 * the Faro SDK is never downloaded.
 */
import type { Faro } from "@grafana/faro-web-sdk";

const FARO_URL = process.env.NEXT_PUBLIC_FARO_URL?.trim();

let faro: Faro | undefined;

const start = async (url: string): Promise<void> => {
  const { startFaro } = await import("./lib/faro");
  faro = startFaro({
    appKey: process.env.NEXT_PUBLIC_FARO_APP_KEY?.trim() || undefined,
    environment: process.env.NEXT_PUBLIC_FARO_ENV?.trim() || "production",
    url,
    version: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
  });
  faro.api.setView({ name: window.location.pathname });
};

if (FARO_URL) {
  // Telemetry must never break the app.
  start(FARO_URL).catch(() => {
    faro = undefined;
  });
}

/** Each App Router navigation becomes a Faro view. */
export const onRouterTransitionStart = (url: string): void => {
  faro?.api.setView({ name: new URL(url, window.location.origin).pathname });
};
