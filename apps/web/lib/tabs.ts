import type { IconName } from "@/components/app-shell/icons";

export interface Tab {
  readonly href: string;
  readonly label: string;
  readonly icon: IconName;
  /** Path prefixes that also light this tab up (e.g. /console/node for Dashboard). */
  readonly matches?: readonly string[];
}

export const isTabActive = (tab: Tab, pathname: string): boolean => {
  if (pathname === tab.href) {
    return true;
  }
  const prefixes = tab.matches ?? [];
  return prefixes.some((prefix) => pathname.startsWith(prefix));
};

export const OWNER_TABS: readonly Tab[] = [
  {
    href: "/console",
    icon: "tonight",
    label: "Dashboard",
    matches: ["/console/node"],
  },
  { href: "/console/sales", icon: "earnings", label: "Sales" },
  { href: "/console/settings", icon: "settings", label: "Settings" },
];

export const MARKET_TABS: readonly Tab[] = [
  { href: "/market", icon: "browse", label: "Market", matches: ["/connect"] },
  { href: "/budget", icon: "wallet", label: "Budget" },
];

export type Role = "buy" | "sell";

export interface RoleLink {
  readonly role: Role;
  readonly href: string;
  readonly label: string;
  /** What this side of the market is, in a few words. */
  readonly hint: string;
}

/** The two sides of the market; every header shows both so a person always knows which side they are on. */
export const ROLES: readonly RoleLink[] = [
  { hint: "pay per request", href: "/market", label: "Buy", role: "buy" },
  {
    hint: "earn from your machine",
    href: "/console",
    label: "Sell",
    role: "sell",
  },
];
