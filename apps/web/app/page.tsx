import Link from "next/link";
import { Suspense } from "react";

import { AvailableNow } from "@/components/landing/available-now";
import { InstallCommand } from "@/components/landing/install-command";
import { RoleButtons } from "@/components/landing/role-buttons";
import { SiteFooter } from "@/components/landing/site-footer";
import {
  BlockHeading,
  Callout,
  Logotype,
  NavLink,
  Note,
} from "@/components/primitives";
import { DuskDither } from "@/components/shaders/shader-slots";
import { ConnectWallet } from "@/components/wallet/connect-wallet";
import { cx } from "@/lib/cx";

/** Sellers come and go; the "available now" table is at most this many seconds old. */
export const revalidate = 30;

const STEPS = [
  {
    accent: false,
    body: "Run the node agent next to Ollama, pick a model and set a price per million tokens. Nothing leaves your machine but answers.",
    kicker: "01 · SELLER",
    title: "Sell the GPU you already have.",
  },
  {
    accent: false,
    body: "An agent calls one OpenAI-compatible URL. No account, no key: the first answer is a 402 with the price.",
    kicker: "02 · AGENT",
    title: "Ask, get a price.",
  },
  {
    accent: true,
    body: "The agent pays in USDC with x402, straight to the seller's wallet, and the answer streams back with its on-chain receipt.",
    kicker: "03 · BOTH",
    title: "Pay per request.",
  },
] as const;

const NAV_LINKS = [
  { className: "bg-foam", href: "/market", label: "Market" },
  { className: undefined, href: "/agents", label: "Agents" },
  { className: undefined, href: "/console", label: "Sell inference" },
] as const;

const LandingNav = () => (
  <header className="bg-enamel text-soot pt-safe flex flex-wrap items-center justify-between gap-6 px-4 sm:px-11 md:pt-11">
    <div className="flex items-center gap-2 pt-4 md:pt-0">
      <Link aria-label="RentAnLLM home" className="spring" href="/">
        <Logotype />
      </Link>
      <span className="text-label text-clay">v0.1</span>
    </div>
    <nav
      aria-label="Primary"
      className="hidden flex-wrap items-center gap-x-8.25 gap-y-3 md:flex"
    >
      {NAV_LINKS.map((link) => (
        <NavLink className={link.className} href={link.href} key={link.href}>
          {link.label}
        </NavLink>
      ))}
      <ConnectWallet on="desktop" />
    </nav>
    <details className="group relative pt-4 md:hidden">
      <summary
        aria-label="Menu"
        className="bg-carbon text-enamel text-title flex size-11 cursor-pointer list-none items-center justify-center"
      >
        ≡
      </summary>
      <nav
        aria-label="Primary"
        className="bg-enamel border-ash absolute top-full right-0 z-20 mt-2 flex w-60 flex-col border p-2"
      >
        {NAV_LINKS.map((link) => (
          <Link
            className="text-body text-dark hover:bg-aluminum flex min-h-11 items-center px-2"
            href={link.href}
            key={link.href}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </details>
  </header>
);

const Hero = () => (
  <section
    aria-label="Introduction"
    className="bg-enamel text-soot flex flex-col justify-between gap-10 px-4 pt-14 pb-16.5 sm:px-11 lg:flex-row lg:items-center"
  >
    <BlockHeading
      as="h1"
      lines={["OPEN MODELS.", "PAID PER CALL."]}
      size="h1"
    />
    <div className="flex w-full max-w-90 shrink-0 flex-col gap-4 pb-1.5">
      <p className="text-body text-soot leading-6.25">
        An inference market for AI agents. People sell open models running on
        their own machines; agents buy one request at a time and pay the seller
        in USDC, with no account and no API key.
      </p>
      <Note>x402 payments on Hedera · spending caps for agents</Note>
      <div className="flex flex-col gap-2 pt-2">
        <RoleButtons />
        <div className="flex flex-col md:hidden">
          <ConnectWallet on="mobile" />
        </div>
      </div>
    </div>
  </section>
);

/** Light-to-dark dusk band; the Paper Dithering shader drifts over a CSS gradient. */
const DuskBand = () => (
  <div
    aria-hidden="true"
    className="bg-dusk relative h-44 shrink-0 overflow-clip"
  >
    <div className="absolute inset-0">
      <DuskDither />
    </div>
    <p className="text-label text-mud absolute bottom-4 left-4 sm:left-11 lg:left-45">
      {"// 402 payment required · then the answer"}
    </p>
  </div>
);

const HowItWorks = () => (
  <section
    aria-labelledby="how-title"
    className="bg-carbon scroll-mt-6 px-4 pt-11 pb-22 sm:px-11"
    id="how"
  >
    <h2 className="sr-only" id="how-title">
      How a request works
    </h2>
    <ol className="grid gap-11 md:grid-cols-3">
      {STEPS.map((step) => (
        <li key={step.title}>
          <Callout
            className="flex flex-col gap-2.75"
            rule={step.accent ? "amber" : "mud"}
          >
            <p
              className={cx(
                "text-label",
                step.accent ? "text-amber" : "text-mud"
              )}
            >
              {step.kicker}
            </p>
            <h3 className="text-title text-enamel leading-6.5">{step.title}</h3>
            <p className="text-body text-cement leading-5.75">{step.body}</p>
          </Callout>
        </li>
      ))}
    </ol>
    <div className="mt-16 flex max-w-240 flex-col gap-4" id="install">
      <p className="text-label text-amber">RUN A NODE</p>
      <h2 className="text-title text-enamel leading-6.5">
        Install the node agent in one line.
      </h2>
      <InstallCommand />
      <Note tone="mud">
        Linux and macOS, x64 and arm64 · then register a node in the console and
        run ral start --ollama-model llama3.1:8b
      </Note>
    </div>
  </section>
);

const LandingPage = () => (
  <>
    <LandingNav />
    <main>
      <Hero />
      <DuskBand />
      <Suspense fallback={null}>
        <AvailableNow />
      </Suspense>
      <HowItWorks />
    </main>
    <SiteFooter />
  </>
);

export default LandingPage;
