"use client";

import { useSIWE } from "connectkit";

interface SiweState {
  readonly isSignedIn: boolean;
  readonly isLoading: boolean;
  readonly signIn: () => Promise<boolean>;
}

/** useSIWE is typed `any` upstream; narrow the bits we use. */
export const useSiweState = (): SiweState => {
  const siwe: unknown = useSIWE();
  const value = (siwe ?? {}) as Partial<SiweState>;
  return {
    isLoading: value.isLoading === true,
    isSignedIn: value.isSignedIn === true,
    signIn: value.signIn ?? (async () => await Promise.resolve(false)),
  };
};
