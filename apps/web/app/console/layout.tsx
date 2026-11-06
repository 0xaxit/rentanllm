import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppHeader } from "@/components/app-header";
import { TabBar } from "@/components/app-shell/tab-bar";
import { AppProviders } from "@/components/wallet/app-providers";
import { SignInButton } from "@/components/wallet/sign-in-button";
import { OWNER_TABS } from "@/lib/tabs";

export const metadata: Metadata = {
  description:
    "Set your supply cut-offs and price, run your node, watch tonight's earnings.",
  title: { default: "Owner console", template: "%s · Owner · RentAnLLM" },
};

const OwnerLayout = ({ children }: { children: ReactNode }) => (
  <AppProviders>
    <AppHeader role="sell" tabs={OWNER_TABS} trailing={<SignInButton />} />
    {children}
    <TabBar label="Owner console" tabs={OWNER_TABS} />
  </AppProviders>
);

export default OwnerLayout;
