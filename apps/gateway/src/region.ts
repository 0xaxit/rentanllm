/**
 * Where a node really is, from the address its tunnel connects from, so the
 * owner can't claim a region they're not in. Best effort: a VPN shows the
 * VPN's location, and a failed lookup leaves the region unset.
 *
 * The client address is the right-most public entry of X-Forwarded-For (the
 * hop our own proxies appended; entries further left are client-supplied and
 * can be forged), else the socket's peer address.
 */
import { Effect, Option } from "effect";

const LOOKUP_URL = "https://ipwho.is";
const LOOKUP_TIMEOUT = "4 seconds";
const LOCAL_REGION = "local network";

const PRIVATE_V4 = [
  /^10\./u,
  /^127\./u,
  /^169\.254\./u,
  /^172\.(?:1[6-9]|2\d|3[01])\./u,
  /^192\.168\./u,
  /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./u,
] as const;
const PRIVATE_V6 = /^(?:::1$|fc|fd|fe80:)/iu;
const MAPPED_V4 = /^::ffff:/iu;

const normalise = (address: string): string =>
  address.trim().replace(MAPPED_V4, "");

export const isPrivateAddress = (address: string): boolean => {
  const ip = normalise(address);
  return (
    ip === "" ||
    PRIVATE_V6.test(ip) ||
    PRIVATE_V4.some((range) => range.test(ip))
  );
};

/** The connecting client's address, as described above. */
export const clientAddress = (
  forwardedFor: string | undefined,
  peer: Option.Option<string>
): string | null => {
  const hops = (forwardedFor ?? "")
    .split(",")
    .map(normalise)
    .filter((hop) => hop.length > 0);
  const lastPublic = hops.findLast((hop) => !isPrivateAddress(hop));
  if (lastPublic !== undefined) {
    return lastPublic;
  }
  return Option.match(peer, {
    onNone: () => null,
    onSome: normalise,
  });
};

interface LookupBody {
  readonly city?: string;
  readonly country_code?: string;
  readonly success?: boolean;
}

/** "IN · Mumbai" for a public address, "local network" for a private one. */
export const lookupRegion = (address: string | null) =>
  Effect.gen(function* lookupNodeRegion() {
    if (address === null || isPrivateAddress(address)) {
      return LOCAL_REGION;
    }
    const body = yield* Effect.tryPromise(async () => {
      const response = await fetch(
        `${LOOKUP_URL}/${encodeURIComponent(address)}?fields=success,country_code,city`
      );
      return (await response.json()) as LookupBody;
    }).pipe(Effect.timeout(LOOKUP_TIMEOUT));
    if (body.success !== true || body.country_code === undefined) {
      return null;
    }
    return body.city
      ? `${body.country_code} · ${body.city}`
      : body.country_code;
  }).pipe(Effect.orElseSucceed(() => null));
