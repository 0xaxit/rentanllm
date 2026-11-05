"use client";

import { useModal } from "connectkit";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";

import { BottomSheet } from "../app-shell/bottom-sheet";
import { IllustrationDither } from "../shaders/shader-slots";
import { takeRoleChoiceRequest } from "./role-choice-request";
import { useSiweState } from "./use-siwe-state";

type Role = "owner" | "renter" | "later";

const ROLES = [
  {
    body: "List the hours your Claude, ChatGPT or Gemini plan sits idle. You set the price and the cut-offs; renters pay you in USDC per token.",
    cta: "SET UP MY NODE →",
    href: "/console",
    illustration: "/illustrations/role-owner.svg",
    kicker: "OWNER",
    role: "owner",
    steps: "register node · add plan · list hours",
    title: "Rent out my plan",
  },
  {
    body: "Book tonight's capacity on someone's plan and get an Anthropic-compatible API key. Prepay in USDC, pay only for the tokens you use.",
    cta: "BROWSE TONIGHT →",
    href: "/browse",
    illustration: "/illustrations/role-renter.svg",
    kicker: "RENTER",
    role: "renter",
    steps: "pick a slot · top up · get your key",
    title: "Rent capacity",
  },
] as const;

const LANDING = "/";
/** The chooser itself, without the sign-in wiring (also used by the e2e test page). */
export const RoleChooserSheet = ({
  open,
  onChoose,
}: {
  open: boolean;
  onChoose: (role: Role) => void;
}) => (
  <BottomSheet
    kicker="SIGNED IN · WHERE TO?"
    kickerTone="amber"
    onClose={() => onChoose("later")}
    open={open}
    title="What brings you aboard?"
    wide
  >
    <div className="flex flex-col gap-3 md:grid md:grid-cols-2">
      {ROLES.map((option) => (
        <button
          data-cuelume-navigate=""
          className="spring border-dark bg-carbon hover:border-amber group flex flex-col gap-2 overflow-hidden border text-left"
          key={option.role}
          onClick={() => onChoose(option.role)}
          type="button"
        >
          <span className="border-dark bg-carbon relative block h-16 w-full border-b md:h-24">
            <IllustrationDither src={option.illustration} />
          </span>
          <span className="flex grow flex-col gap-2 px-4 pb-4">
            <span className="text-label tracking-label text-mud pt-2">
              {option.kicker}
            </span>
            <span className="text-title text-enamel leading-6.5">
              {option.title}
            </span>
            <span className="text-body text-cement hidden leading-5.25 md:block">
              {option.body}
            </span>
            <span className="text-label tracking-label text-mud">
              {option.steps}
            </span>
            <span className="text-body text-amber group-hover:text-enamel mt-auto pt-1">
              {option.cta}
            </span>
          </span>
        </button>
      ))}
      <button
        data-cuelume-close=""
        className="text-body text-mud hover:text-enamel min-h-11 self-center px-3 md:col-span-2 md:justify-self-center"
        onClick={() => onChoose("later")}
        type="button"
      >
        Decide later
      </button>
    </div>
  </BottomSheet>
);

/**
 * After someone presses CONNECT WALLET on the landing page and signs in there
 * is no obvious next step, so this asks whether they are here to rent out a
 * plan or to rent capacity and sends them to the first step of that path.
 */
export const RoleChooser = () => {
  const siwe = useSiweState();
  const { address } = useAccount();
  const pathname = usePathname();
  const router = useRouter();
  const connectKit = useModal();
  const [open, setOpen] = useState(false);
  const wasSignedIn = useRef<boolean | null>(null);

  useEffect(() => {
    const previous = wasSignedIn.current;
    wasSignedIn.current = siwe.isSignedIn;
    if (!(siwe.isSignedIn && address) || pathname !== LANDING) {
      return;
    }
    const justSignedIn = previous === false;
    if (justSignedIn && takeRoleChoiceRequest()) {
      connectKit.setOpen(false);
      setOpen(true);
    }
  }, [siwe.isSignedIn, address, pathname, connectKit]);

  const choose = (href?: string) => {
    setOpen(false);
    if (href) {
      router.push(href);
    }
  };

  return (
    <RoleChooserSheet
      onChoose={(role) =>
        choose(ROLES.find((option) => option.role === role)?.href)
      }
      open={open}
    />
  );
};
