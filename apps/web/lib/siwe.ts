/**
 * Sign-In With Ethereum against the control-plane API.
 *
 * The API binds each nonce to an address (POST /auth/nonce {address}), but
 * ConnectKit's SIWEProvider fetches its nonce before it knows the address. So
 * `getNonce` hands ConnectKit a placeholder and `createMessage`, which does get
 * the address, fetches the real nonce and builds the EIP-4361 message.
 */
import type { SIWEConfig } from "connectkit";
import type { Address } from "viem";
import { createSiweMessage } from "viem/siwe";

import { callApi } from "./api/client";
import type { User } from "./api/types";

const STATEMENT =
  "Sign in to RentAnLLM. This request will not trigger a blockchain transaction or cost any gas.";
const PLACEHOLDER_NONCE = "pending-address";

export interface SiweMessageInput {
  readonly address: Address;
  readonly chainId: number;
  readonly nonce: string;
  /** window.location.host: must equal the API's SIWE_DOMAIN. */
  readonly domain: string;
  /** window.location.origin. */
  readonly uri: string;
  readonly issuedAt?: Date;
}

export const buildSiweMessage = (input: SiweMessageInput): string =>
  createSiweMessage({
    address: input.address,
    chainId: input.chainId,
    domain: input.domain,
    issuedAt: input.issuedAt ?? new Date(),
    nonce: input.nonce,
    statement: STATEMENT,
    uri: input.uri,
    version: "1",
  });

export const fetchMe = async (): Promise<User | null> => {
  const result = await callApi((api) => api.auth.me());
  return result.ok ? result.data : null;
};

/** ConnectKit SIWE config wired to /auth/nonce, /auth/verify, /auth/me and /auth/logout. */
export const makeSiweConfig = (chainId: number): SIWEConfig => ({
  createMessage: async ({ address, chainId: walletChainId }) => {
    const nonce = await callApi((api) =>
      api.auth.nonce({ payload: { address } })
    );
    if (!nonce.ok) {
      throw new Error(nonce.error.message);
    }
    return buildSiweMessage({
      address,
      chainId: walletChainId,
      domain: window.location.host,
      nonce: nonce.data.nonce,
      uri: window.location.origin,
    });
  },
  getNonce: async () => await Promise.resolve(PLACEHOLDER_NONCE),
  getSession: async () => {
    const me = await fetchMe();
    if (me?.walletAddress === null || me === null) {
      return null;
    }
    return { address: me.walletAddress as Address, chainId };
  },
  signOut: async () => {
    const result = await callApi((api) => api.auth.logout());
    return result.ok;
  },
  verifyMessage: async ({ message, signature }) => {
    const result = await callApi((api) =>
      api.auth.verify({ payload: { message, signature } })
    );
    return result.ok;
  },
});
