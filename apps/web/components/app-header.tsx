"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { isTabActive } from "@/lib/tabs";
import type { Tab } from "@/lib/tabs";

import { Logotype, NavLink } from "./primitives";
import { SoundToggle } from "./sound/sound-toggle";

/** Light enamel header used above the dark app screens (md and up). */
export const AppHeader = ({
  section,
  tabs,
  trailing,
}: {
  section: string;
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
          <span className="text-title text-clay leading-5.5">/ {section}</span>
        </div>
        <nav
          aria-label="Primary"
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
