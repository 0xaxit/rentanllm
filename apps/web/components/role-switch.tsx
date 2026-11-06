import Link from "next/link";

import { cx } from "@/lib/cx";
import { ROLES } from "@/lib/tabs";
import type { Role } from "@/lib/tabs";

/**
 * Buy | Sell segmented switch. `current` is the side the page belongs to, or
 * null on pages that belong to neither (the landing page).
 */
export const RoleSwitch = ({ current }: { current: Role | null }) => (
  <nav
    aria-label="Buy or sell"
    className="border-ash flex items-stretch border p-0.5"
  >
    {ROLES.map((role) => {
      const active = role.role === current;
      return (
        <Link
          aria-current={active ? "page" : undefined}
          className={cx(
            "spring text-body flex min-h-9 items-center gap-2 px-3 leading-5.25",
            active ? "bg-carbon text-enamel" : "text-dark hover:bg-aluminum"
          )}
          data-cuelume-navigate=""
          href={role.href}
          key={role.role}
        >
          {role.label}
          <span
            className={cx(
              "text-label hidden lg:inline",
              active ? "text-ash" : "text-clay"
            )}
          >
            {role.hint}
          </span>
        </Link>
      );
    })}
  </nav>
);
