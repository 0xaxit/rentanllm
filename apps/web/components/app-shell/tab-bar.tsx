"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cx } from "@/lib/cx";
import { isTabActive } from "@/lib/tabs";
import type { Tab } from "@/lib/tabs";

import { PixelIcon } from "./icons";

/** Fixed bottom tab bar for phones (< md). Desktop uses the header nav instead. */
export const TabBar = ({
  tabs,
  label,
}: {
  tabs: readonly Tab[];
  label: string;
}) => {
  const pathname = usePathname();
  return (
    <nav
      aria-label={label}
      className="border-soot pb-safe fixed inset-x-0 bottom-0 z-30 border-t bg-black/95 backdrop-blur md:hidden"
    >
      <ul className="h-tabbar flex">
        {tabs.map((tab) => {
          const active = isTabActive(tab, pathname);
          return (
            <li className="flex grow basis-0" key={tab.href}>
              <Link
                aria-current={active ? "page" : undefined}
                className={cx(
                  "text-label flex grow flex-col items-center gap-1.5 pt-2.5",
                  active ? "text-amber" : "text-mud"
                )}
                data-cuelume-navigate=""
                href={tab.href}
              >
                <PixelIcon name={tab.icon} />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};
