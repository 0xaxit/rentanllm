"use client";

import { AppProviders } from "./app-providers";
import { SignInButton } from "./sign-in-button";

/**
 * Wallet providers + sign-in button for the marketing pages, loaded only in
 * the browser (see connect-wallet.tsx) so wagmi and ConnectKit stay out of the
 * landing page's server render and first bundle. App routes mount
 * <AppProviders> in their layouts instead.
 */
const WalletIsland = () => (
  <AppProviders>
    <SignInButton />
  </AppProviders>
);

export default WalletIsland;
