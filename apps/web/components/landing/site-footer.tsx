import Link from "next/link";

import { AsciiWordmark } from "../ascii-wordmark/ascii-wordmark";
import { Logotype } from "../primitives";

interface FooterColumn {
  readonly title: string;
  readonly links: readonly { readonly label: string; readonly href: string }[];
}

const COLUMNS: readonly FooterColumn[] = [
  {
    links: [
      { href: "/market", label: "Market" },
      { href: "/#how", label: "How it works" },
    ],
    title: "PRODUCT",
  },
  {
    links: [
      { href: "/console", label: "Sell inference" },
      { href: "/console", label: "Nodes" },
      { href: "/console/sales", label: "Sales" },
    ],
    title: "SELLERS",
  },
  {
    links: [
      { href: "/market", label: "x402 API" },
      { href: "/agents", label: "MCP server" },
    ],
    title: "AGENTS",
  },
  {
    links: [
      { href: "mailto:hello@rentanllm.xyz", label: "Contact" },
      { href: "/#footer", label: "Terms" },
      { href: "/#footer", label: "Privacy" },
    ],
    title: "COMPANY",
  },
];

export const SiteFooter = () => (
  <footer
    className="border-soot bg-pit flex flex-col gap-16.5 overflow-clip border-t px-4 pt-22 sm:px-11"
    id="footer"
  >
    <div className="flex flex-col justify-between gap-12 lg:flex-row lg:items-start">
      <div className="flex w-full max-w-90 shrink-0 flex-col items-start gap-4">
        <Logotype />
        <p className="text-body text-cement leading-5.75">
          Open models on people's own machines, bought by AI agents one request
          at a time. Paid in USDC.
        </p>
      </div>
      <nav
        aria-label="Footer"
        className="grid grid-cols-2 gap-x-16.5 gap-y-10 md:grid-cols-4"
      >
        {COLUMNS.map((column) => (
          <div className="flex w-40 flex-col gap-3.5" key={column.title}>
            <h2 className="text-label text-mud leading-2.75">{column.title}</h2>
            <ul className="flex flex-col gap-3.5">
              {column.links.map((link) => (
                <li key={link.label}>
                  <Link
                    className="spring text-body text-cement hover:text-amber inline-block leading-5.25"
                    href={link.href}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </div>
    <div className="text-label text-clay flex flex-wrap justify-between gap-2 leading-2.75">
      <p>All rights reserved © 2026</p>
      <p>{"// x402 · USDC on Hedera · Arkiv"}</p>
    </div>
    <AsciiWordmark />
  </footer>
);
