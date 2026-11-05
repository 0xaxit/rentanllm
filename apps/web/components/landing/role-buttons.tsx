import Link from "next/link";

import { IllustrationDither } from "../shaders/shader-slots";

const ROLE_LINKS = [
  {
    href: "/console",
    illustration: "/illustrations/role-owner.svg",
    label: "Sell inference",
  },
  {
    href: "/market",
    illustration: "/illustrations/role-renter.svg",
    label: "Buy inference",
  },
] as const;

/** The owner and renter paths, as two small buttons under the hero copy. */
export const RoleButtons = () => (
  <nav aria-label="Get started" className="flex flex-col gap-2">
    {ROLE_LINKS.map((role) => (
      <Link
        className="spring border-carbon bg-carbon text-enamel hover:text-amber group flex items-stretch border"
        data-cuelume-navigate=""
        href={role.href}
        key={role.href}
      >
        <span className="border-dark relative block h-12 w-24 shrink-0 border-r">
          <IllustrationDither src={role.illustration} />
        </span>
        <span className="text-body flex grow items-center justify-between gap-2 px-3 leading-5.25">
          {role.label}
          <span aria-hidden="true" className="text-amber">
            →
          </span>
        </span>
      </Link>
    ))}
  </nav>
);
