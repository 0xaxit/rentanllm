"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";

/** Static stand-in shown during SSR, before hydration and with JS disabled. */
const WalletButtonPlaceholder = () => (
  <span
    aria-hidden="true"
    className="bg-carbon text-body text-enamel inline-flex min-h-9 items-center px-3 py-1.5 leading-5.25"
  >
    CONNECT WALLET
  </span>
);

const WalletIsland = dynamic(() => import("./wallet-island"), {
  loading: WalletButtonPlaceholder,
  ssr: false,
});

const DESKTOP_QUERY = "(min-width: 768px)";

const subscribe = (onChange: () => void) => {
  const media = window.matchMedia(DESKTOP_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};
const isDesktop = () => window.matchMedia(DESKTOP_QUERY).matches;
const serverSnapshot = () => null;

/**
 * The landing page's wallet button. It appears in the nav on desktop and in
 * the hero on phones; only the copy for the current viewport mounts the
 * wallet providers, so there is never a second wagmi/SIWE instance.
 */
export const ConnectWallet = ({ on }: { on: "desktop" | "mobile" }) => {
  const desktop = useSyncExternalStore<boolean | null>(
    subscribe,
    isDesktop,
    serverSnapshot
  );
  if (desktop === null) {
    return <WalletButtonPlaceholder />;
  }
  return desktop === (on === "desktop") ? <WalletIsland /> : null;
};
