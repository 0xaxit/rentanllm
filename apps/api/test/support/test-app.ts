/** The real web handler over a real database, with test config. */
import { layer as dbLayer } from "@rentanllm/db";
import { Layer, ManagedRuntime, Redacted } from "effect";
import type { Effect } from "effect";
import { HttpRouter, HttpServer } from "effect/http";

import { RoutesLayer } from "../../src/app";
import { AuthStorePg } from "../../src/auth/auth-store";
import { SignatureVerifierEoa } from "../../src/auth/signature-verifier";
import { ApiConfig, makeTestConfig } from "../../src/config";
import type { ApiConfigShape } from "../../src/config";
import { hederaMirrorStub } from "../../src/hedera/mirror";
import type { HederaMirror } from "../../src/hedera/mirror";
import { makeWallet } from "./wallet";

const SESSION_COOKIE_PATTERN = /rentanllm_session=(?<token>[^;]*)/u;

export interface CallOptions {
  readonly bearer?: string | undefined;
  readonly body?: unknown;
  readonly cookie?: string | undefined;
}

export const makeTestApp = (
  url: string,
  configOverrides: Partial<ApiConfigShape> = {},
  /** The Hedera mirror node; by default every wallet has an account that takes USDC. */
  mirror: Layer.Layer<HederaMirror> = hederaMirrorStub()
) => {
  const config = makeTestConfig(configOverrides);
  const services = Layer.mergeAll(
    AuthStorePg,
    SignatureVerifierEoa,
    mirror
  ).pipe(
    Layer.provideMerge(dbLayer({ maxConnections: 4, url: Redacted.make(url) })),
    Layer.provideMerge(Layer.succeed(ApiConfig)(config)),
    Layer.orDie
  );
  const runtime = ManagedRuntime.make(services);
  const web = HttpRouter.toWebHandler(
    RoutesLayer.pipe(
      Layer.provideMerge(services),
      Layer.provide(HttpServer.layerServices)
    ),
    { disableLogger: true, memoMap: runtime.memoMap }
  );

  const call = async (
    method: string,
    path: string,
    options: CallOptions = {}
  ) => {
    const headers = new Headers();
    if (options.body !== undefined) {
      headers.set("content-type", "application/json");
    }
    if (options.cookie !== undefined) {
      headers.set("cookie", `rentanllm_session=${options.cookie}`);
    }
    if (options.bearer !== undefined) {
      headers.set("authorization", `Bearer ${options.bearer}`);
    }
    const response = await web.handler(
      new Request(`http://localhost${path}`, {
        body: options.body === undefined ? null : JSON.stringify(options.body),
        headers,
        method,
      })
    );
    const text = await response.text();
    const setCookie = response.headers.get("set-cookie") ?? "";
    return {
      // oxlint-disable-next-line typescript/no-explicit-any -- test responses are loosely typed JSON
      json: (text.length > 0 ? JSON.parse(text) : null) as any,
      sessionCookie: SESSION_COOKIE_PATTERN.exec(setCookie)?.groups?.token,
      setCookie,
      status: response.status,
    };
  };

  /** Signs in a fresh wallet; returns its address, session cookie and user. */
  const signIn = async () => {
    const wallet = makeWallet();
    const nonce = await call("POST", "/auth/nonce", {
      body: { address: wallet.address },
    });
    const signed = await wallet.signIn(nonce.json.nonce);
    const verified = await call("POST", "/auth/verify", { body: signed });
    if (verified.status !== 200 || verified.sessionCookie === undefined) {
      throw new Error(`sign-in failed: ${verified.status}`);
    }
    return {
      address: wallet.address,
      cookie: verified.sessionCookie,
      // oxlint-disable-next-line typescript/no-explicit-any -- loosely typed JSON
      user: verified.json.user as any,
    };
  };

  const run = <A, E>(
    effect: Effect.Effect<A, E, Layer.Success<typeof services>>
  ) => runtime.runPromise(effect);

  const dispose = async () => {
    await web.dispose();
    await runtime.dispose();
  };

  return { call, config, dispose, run, runtime, signIn };
};

export type TestApp = ReturnType<typeof makeTestApp>;
