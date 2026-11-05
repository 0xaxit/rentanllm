"use client";

import { ConnectKitButton } from "connectkit";

import { cx } from "@/lib/cx";

import { useSiweState } from "./use-siwe-state";

const variants = {
  dark: "bg-carbon text-enamel hover:bg-black",
  light: "bg-enamel text-carbon hover:bg-aluminum",
  wide: "w-full justify-center bg-enamel text-carbon hover:bg-aluminum h-12",
} as const;

/**
 * Connect a wallet, then Sign-In With Ethereum. One button walks through the
 * states: CONNECT WALLET -> SIGN IN -> 0x7a3…c19 (opens the account modal,
 * which has sign out and disconnect).
 */
export const SignInButton = ({
  variant = "dark",
  className,
  onBeforeModal,
  onSignInStart,
}: {
  variant?: keyof typeof variants;
  className?: string;
  /**
   * Called before ConnectKit's modal opens. A native modal <dialog> sits in
   * the top layer and makes the page inert, so sheets close themselves here.
   */
  onBeforeModal?: () => void;
  /** Called when a signed-out person presses the button to connect or sign in. */
  onSignInStart?: () => void;
}) => {
  const siwe = useSiweState();
  return (
    <ConnectKitButton.Custom>
      {({ isConnected, show, truncatedAddress, ensName }) => {
        let label = "CONNECT WALLET";
        if (isConnected && siwe.isSignedIn) {
          label = ensName ?? truncatedAddress ?? "SIGNED IN";
        } else if (isConnected) {
          label = siwe.isLoading ? "SIGNING IN…" : "SIGN IN";
        }
        const openModal = () => {
          onBeforeModal?.();
          show?.();
        };
        const onClick = () => {
          if (!siwe.isSignedIn) {
            onSignInStart?.();
          }
          if (isConnected && !siwe.isSignedIn) {
            siwe.signIn().catch(openModal);
            return;
          }
          openModal();
        };
        return (
          <button
            data-cuelume-tap=""
            className={cx(
              "spring text-body inline-flex min-h-9 items-center gap-2 px-3 py-1.5 leading-5.25 disabled:opacity-70",
              variants[variant],
              className
            )}
            disabled={siwe.isLoading}
            onClick={onClick}
            type="button"
          >
            {isConnected && (
              <span
                aria-hidden="true"
                className={cx(
                  "inline-block size-2",
                  siwe.isSignedIn ? "bg-amber" : "bg-clay"
                )}
              />
            )}
            {label}
          </button>
        );
      }}
    </ConnectKitButton.Custom>
  );
};
