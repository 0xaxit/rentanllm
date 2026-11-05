import Link from "next/link";

import { BlockHeading, Note } from "@/components/primitives";

const NotFound = () => (
  <main className="flex min-h-dvh flex-col items-start justify-center gap-6 px-4 sm:px-11">
    <Note tone="mud">404 · nothing for sale at this address</Note>
    <BlockHeading as="h1" lines={["NOT FOUND."]} size="h1" />
    <Link
      className="spring text-body text-cement hover:text-amber"
      href="/market"
    >
      ← back to the market
    </Link>
  </main>
);

export default NotFound;
