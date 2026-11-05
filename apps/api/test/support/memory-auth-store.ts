import type { User } from "@rentanllm/api-contract";
import { Effect, Layer } from "effect";

import { AuthStore } from "../../src/auth/auth-store";

interface NonceRow {
  address: string;
  expiresAt: Date;
  usedAt: Date | null;
}

export interface MemoryAuthState {
  readonly nonces: Map<string, NonceRow>;
  readonly sessions: Map<string, { expiresAt: Date; userId: string }>;
  readonly users: Map<string, User>;
}

export const makeMemoryAuthState = (): MemoryAuthState => ({
  nonces: new Map(),
  sessions: new Map(),
  users: new Map(),
});

/** In-memory AuthStore with the same semantics as AuthStorePg. */
export const memoryAuthStore = (state: MemoryAuthState) =>
  Layer.succeed(AuthStore)(
    AuthStore.of({
      consumeNonce: ({ address, nonce, now }) =>
        Effect.sync(() => {
          const row = state.nonces.get(nonce);
          if (
            row === undefined ||
            row.address !== address ||
            row.usedAt !== null ||
            row.expiresAt <= now
          ) {
            return false;
          }
          row.usedAt = now;
          return true;
        }),
      createNonce: ({ address, expiresAt, nonce }) =>
        Effect.sync(() => {
          state.nonces.set(nonce, { address, expiresAt, usedAt: null });
        }),
      createSession: ({ expiresAt, tokenHash, userId }) =>
        Effect.sync(() => {
          state.sessions.set(tokenHash, { expiresAt, userId });
        }),
      deleteSession: (tokenHash) =>
        Effect.sync(() => {
          state.sessions.delete(tokenHash);
        }),
      findSessionUser: (tokenHash, now) =>
        Effect.sync(() => {
          const session = state.sessions.get(tokenHash);
          return session === undefined || session.expiresAt <= now
            ? undefined
            : state.users.get(session.userId);
        }),
      upsertWalletUser: (address) =>
        Effect.sync(() => {
          const existing = [...state.users.values()].find(
            (user) => user.walletAddress === address
          );
          if (existing !== undefined) {
            return existing;
          }
          const user: User = {
            createdAt: new Date(),
            id: crypto.randomUUID(),
            isOwner: false,
            isRenter: true,
            walletAddress: address,
          };
          state.users.set(user.id, user);
          return user;
        }),
    })
  );
