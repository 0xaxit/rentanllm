import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";

import { SoundBinder } from "@/components/sound/sound-binder";
import { SITE_URL } from "@/lib/env";
import { palette } from "@/lib/tokens";

import "./globals.css";

const departureMono = localFont({
  display: "swap",
  src: "./fonts/DepartureMono-Regular.woff2",
  variable: "--font-departure",
  weight: "400",
});

const DESCRIPTION =
  "An inference market for AI agents. People sell open models running on their own machines; agents pay per request in USDC with x402.";

export const metadata: Metadata = {
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "RentAnLLM",
  },
  applicationName: "RentAnLLM",
  description: DESCRIPTION,
  metadataBase: new URL(SITE_URL),
  openGraph: {
    description: DESCRIPTION,
    siteName: "RentAnLLM",
    type: "website",
  },
  title: {
    default: "RentAnLLM · open models, paid per call",
    template: "%s · RentAnLLM",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: palette.carbon,
  // Draw under the notch / home indicator; the app shell pads with
  // env(safe-area-inset-*).
  viewportFit: "cover",
};

const RootLayout = ({ children }: { children: ReactNode }) => (
  <html className={departureMono.variable} lang="en">
    <body className="bg-carbon text-enamel min-h-dvh font-mono antialiased">
      {children}
      <SoundBinder />
    </body>
  </html>
);

export default RootLayout;
