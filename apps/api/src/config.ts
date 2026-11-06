import { Config, Context, Effect, Layer, Option, Redacted } from "effect";

export interface ApiConfigShape {
  /** Domain attribute for the session cookie, e.g. ".rentanllm.xyz". Unset: host-only (the web app proxies /api, so it needs none). */
  readonly cookieDomain: string | undefined;
  readonly cronSecret: Redacted.Redacted;
  /** The gateway's public origin, the endpoint agents' registration files point buyers to. */
  readonly gatewayUrl: string;
  /** A node whose last heartbeat is older than this is marked offline. */
  readonly nodeStaleMs: number;
  readonly nonceTtlMs: number;
  /** This API's public origin; agents' ERC-8004 agentURIs are served under it. */
  readonly publicUrl: string;
  /** Key for HMAC-SHA256 of session tokens before they are stored. */
  readonly sessionSecret: Redacted.Redacted;
  readonly sessionTtlMs: number;
  /** EIP-4361 `domain` the SIWE message must carry, e.g. "rentanllm.xyz". */
  readonly siweDomain: string;
  /** Browser origins allowed to call the API with credentials (CORS). */
  readonly webOrigins: readonly string[];
}

export class ApiConfig extends Context.Service<ApiConfig, ApiConfigShape>()(
  "@rentanllm/api/ApiConfig"
) {}

const MS_PER_SECOND = 1000;
const MS_PER_HOUR = 3_600_000;
const DEFAULT_SESSION_TTL_HOURS = 168;
const DEFAULT_NONCE_TTL_SECONDS = 600;
const DEFAULT_NODE_STALE_SECONDS = 90;
const MIN_SECRET_LENGTH = 32;
const DEFAULT_PUBLIC_URL = "https://api.rentanllm.xyz";
const DEFAULT_GATEWAY_URL = "https://gw.rentanllm.xyz";

const publicOrigin = (name: string, fallback: string) =>
  Config.String(name).pipe(
    Config.withDefault(fallback),
    Config.map((value) => value.replace(/\/+$/u, ""))
  );

const secret = (name: string) =>
  Config.Redacted(name).pipe(
    Config.mapEffect((value) =>
      Redacted.value(value).length >= MIN_SECRET_LENGTH
        ? Effect.succeed(value)
        : Effect.die(
            new Error(
              `${name} must be at least ${MIN_SECRET_LENGTH} characters`
            )
          )
    )
  );

const seconds = (name: string, fallback: number) =>
  Config.Int(name).pipe(
    Config.withDefault(fallback),
    Config.map((value) => value * MS_PER_SECOND)
  );

export const apiConfigFromEnv = Config.all({
  cookieDomain: Config.option(Config.String("COOKIE_DOMAIN")).pipe(
    Config.map(Option.getOrUndefined)
  ),
  cronSecret: secret("CRON_SECRET"),
  gatewayUrl: publicOrigin("GATEWAY_PUBLIC_URL", DEFAULT_GATEWAY_URL),
  nodeStaleMs: seconds("NODE_STALE_SECONDS", DEFAULT_NODE_STALE_SECONDS),
  nonceTtlMs: seconds("SIWE_NONCE_TTL_SECONDS", DEFAULT_NONCE_TTL_SECONDS),
  publicUrl: publicOrigin("API_PUBLIC_URL", DEFAULT_PUBLIC_URL),
  sessionSecret: secret("SESSION_SECRET"),
  sessionTtlMs: Config.Int("SESSION_TTL_HOURS").pipe(
    Config.withDefault(DEFAULT_SESSION_TTL_HOURS),
    Config.map((hours) => hours * MS_PER_HOUR)
  ),
  siweDomain: Config.String("SIWE_DOMAIN"),
  webOrigins: Config.String("WEB_ORIGINS").pipe(
    Config.withDefault(""),
    Config.map((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0)
    )
  ),
});

export const ApiConfigLive = Layer.effect(ApiConfig)(
  Effect.gen(function* loadApiConfig() {
    return yield* apiConfigFromEnv;
  })
);

/** Config for tests. Secrets here are throwaway placeholders. */
export const makeTestConfig = (
  overrides: Partial<ApiConfigShape> = {}
): ApiConfigShape => ({
  cookieDomain: undefined,
  cronSecret: Redacted.make("test-cron-secret-0123456789abcdef0123"),
  gatewayUrl: "http://gateway.test",
  nodeStaleMs: DEFAULT_NODE_STALE_SECONDS * MS_PER_SECOND,
  nonceTtlMs: DEFAULT_NONCE_TTL_SECONDS * MS_PER_SECOND,
  publicUrl: "http://api.test",
  sessionSecret: Redacted.make("test-session-secret-0123456789abcdef"),
  sessionTtlMs: DEFAULT_SESSION_TTL_HOURS * MS_PER_HOUR,
  siweDomain: "localhost:3000",
  webOrigins: ["http://localhost:3000"],
  ...overrides,
});
