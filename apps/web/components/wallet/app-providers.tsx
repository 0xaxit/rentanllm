"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectKitProvider, SIWEProvider } from "connectkit";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ReactNode } from "react";
import { WagmiProvider } from "wagmi";

import { makeSiweConfig } from "@/lib/siwe";
import { palette } from "@/lib/tokens";

import { ToastProvider } from "../app-shell/toast";
import { appChain, wagmiConfig } from "./wagmi-config";

/** ConnectKit modal themed to the departures-board palette. */
const connectKitTheme = {
  "--ck-accent-color": palette.amber,
  "--ck-accent-text-color": palette.carbon,
  "--ck-body-background": palette.carbon,
  "--ck-body-background-secondary": palette.soot,
  "--ck-body-background-secondary-hover-background": palette.dark,
  "--ck-body-background-tertiary": palette.black,
  "--ck-body-color": palette.enamel,
  "--ck-body-color-danger": palette.pumpkin,
  "--ck-body-color-muted": palette.mud,
  "--ck-body-color-muted-hover": palette.cement,
  "--ck-body-color-valid": palette.flux,
  "--ck-border-radius": "0px",
  "--ck-font-family": "var(--font-departure), ui-monospace, monospace",
  "--ck-modal-box-shadow": `0 0 0 1px ${palette.dark}`,
  "--ck-overlay-background":
    "color-mix(in srgb, var(--color-black) 72%, transparent)",
  "--ck-primary-button-background": palette.soot,
  "--ck-primary-button-border-radius": "0px",
  "--ck-primary-button-color": palette.enamel,
  "--ck-primary-button-hover-background": palette.dark,
  "--ck-secondary-button-background": palette.soot,
  "--ck-secondary-button-border-radius": "0px",
  "--ck-secondary-button-color": palette.enamel,
  "--ck-tooltip-background": palette.black,
  "--ck-tooltip-color": palette.enamel,
} as const;

const siweConfig = makeSiweConfig(appChain.id);

/**
 * Wallet + session providers: wagmi, react-query, ConnectKit with Sign-In With
 * Ethereum against the API, and toasts. Signing in or out refreshes the
 * current route so Server Components re-render with (or without) the session.
 */
export const AppProviders = ({ children }: { children: ReactNode }) => {
  const [queryClient] = useState(() => new QueryClient());
  const router = useRouter();
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <SIWEProvider
          {...siweConfig}
          onSignIn={() => router.refresh()}
          onSignOut={() => router.refresh()}
          signOutOnNetworkChange={false}
        >
          <ConnectKitProvider
            customTheme={connectKitTheme}
            mode="dark"
            options={{
              enforceSupportedChains: true,
              initialChainId: appChain.id,
            }}
            theme="minimal"
          >
            <ToastProvider>{children}</ToastProvider>
          </ConnectKitProvider>
        </SIWEProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
};
