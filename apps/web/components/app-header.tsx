"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { isTabActive } from "@/lib/tabs";
import type { Role, Tab } from "@/lib/tabs";

import { Logotype, NavLink } from "./primitives";
import { RoleSwitch } from "./role-switch";
import { SoundToggle } from "./sound/sound-toggle";

/**
 * Light enamel header used above the dark app screens (md and up): the Buy |
 * Sell switch, then only the tabs for the side the page belongs to.
 */
export const AppHeader = ({
  role,
  tabs,
  trailing,
}: {
  role: Role;
  tabs: readonly Tab[];
  trailing: ReactNode;
}) => {
  const pathname = usePathname();
  return (
    <header className="bg-enamel text-soot hidden px-4 py-5.5 sm:px-11 md:block">
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <div className="flex items-center gap-4">
          <Link aria-label="RentAnLLM home" className="spring" href="/">
            <Logotype />
          </Link>
          <RoleSwitch current={role} />
        </div>
        <nav
          aria-label={role === "buy" ? "Buyer" : "Seller"}
          className="flex flex-wrap items-center gap-x-8.25 gap-y-3"
        >
          {tabs.map((tab) => (
            <NavLink
              current={isTabActive(tab, pathname)}
              href={tab.href}
              key={tab.href}
            >
              {tab.label}
            </NavLink>
          ))}
          <SoundToggle className="text-clay hover:text-soot" />
          {trailing}
        </nav>
      </div>
    </header>
  );
};
