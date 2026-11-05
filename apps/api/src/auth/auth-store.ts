import type { User } from "@rentanllm/api-contract";
import { Db } from "@rentanllm/db";
import { authNonces, sessions, users } from "@rentanllm/db/schema";
import { and, eq, gt, isNull } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { toUser } from "../services/mappers";

export interface AuthStoreShape {
  readonly consumeNonce: (input: {
    readonly address: string;
    readonly nonce: string;
    readonly now: Date;
  }) => Effect.Effect<boolean>;
  readonly createNonce: (input: {
    readonly address: string;
    readonly expiresAt: Date;
    readonly nonce: string;
  }) => Effect.Effect<void>;
  readonly createSession: (input: {
    readonly expiresAt: Date;
    readonly tokenHash: string;
    readonly userId: string;
  }) => Effect.Effect<void>;
  readonly deleteSession: (tokenHash: string) => Effect.Effect<void>;
  readonly findSessionUser: (
    tokenHash: string,
    now: Date
  ) => Effect.Effect<User | undefined>;
  /** Returns the user with this wallet, creating it on first sign-in. */
  readonly upsertWalletUser: (address: string) => Effect.Effect<User>;
}

/** Nonces, users and sessions for wallet sign-in. Infrastructure failures are defects (500). */
export class AuthStore extends Context.Service<AuthStore, AuthStoreShape>()(
  "@rentanllm/api/AuthStore"
) {}

export const AuthStorePg = Layer.effect(AuthStore)(
  Effect.gen(function* makeAuthStorePg() {
    const db = yield* Db;
    return AuthStore.of({
      consumeNonce: ({ address, nonce, now }) =>
        db
          .update(authNonces)
          .set({ usedAt: now })
          .where(
            and(
              eq(authNonces.nonce, nonce),
              eq(authNonces.address, address),
              isNull(authNonces.usedAt),
              gt(authNonces.expiresAt, now)
            )
          )
          .returning({ nonce: authNonces.nonce })
          .pipe(
            Effect.map((rows) => rows.length === 1),
            Effect.orDie
          ),
      createNonce: (input) =>
        db.insert(authNonces).values(input).pipe(Effect.asVoid, Effect.orDie),
      createSession: (input) =>
        db.insert(sessions).values(input).pipe(Effect.asVoid, Effect.orDie),
      deleteSession: (tokenHash) =>
        db
          .delete(sessions)
          .where(eq(sessions.tokenHash, tokenHash))
          .pipe(Effect.asVoid, Effect.orDie),
      findSessionUser: (tokenHash, now) =>
        db
          .select({ user: users })
          .from(sessions)
          .innerJoin(users, eq(users.id, sessions.userId))
          .where(
            and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now))
          )
          .limit(1)
          .pipe(
            Effect.map(([row]) =>
              row === undefined ? undefined : toUser(row.user)
            ),
            Effect.orDie
          ),
      upsertWalletUser: (address) =>
        db
          .insert(users)
          .values({ walletAddress: address })
          .onConflictDoUpdate({
            set: { walletAddress: address },
            target: users.walletAddress,
          })
          .returning()
          .pipe(
            Effect.flatMap(([row]) =>
              row === undefined
                ? Effect.die(new Error("user upsert returned no row"))
                : Effect.succeed(toUser(row))
            ),
            Effect.orDie
          ),
    });
  })
);
