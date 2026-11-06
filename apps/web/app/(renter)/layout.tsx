import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppHeader } from "@/components/app-header";
import { TabBar } from "@/components/app-shell/tab-bar";
import { AppProviders } from "@/components/wallet/app-providers";
import { SignInButton } from "@/components/wallet/sign-in-button";
import { MARKET_TABS } from "@/lib/tabs";

export const metadata: Metadata = {
  description:
    "Open models on people's own machines, bought one request at a time by AI agents, paid in USDC straight to the seller.",
  title: { default: "Market", template: "%s · RentAnLLM" },
};

const MarketLayout = ({ children }: { children: ReactNode }) => (
  <AppProviders>
    <AppHeader section="MARKET" tabs={MARKET_TABS} trailing={<SignInButton />} />
    {children}
    <TabBar label="Market" tabs={MARKET_TABS} />
  </AppProviders>
);

export default MarketLayout;
