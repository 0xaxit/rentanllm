import type { MetadataRoute } from "next";

import { palette } from "@/lib/tokens";

/** Installable to the home screen: opens straight into the console, no browser chrome. */
const manifest = (): MetadataRoute.Manifest => ({
  background_color: palette.carbon,
  categories: ["finance", "developer", "productivity"],
  description:
    "An inference market for AI agents: open models, paid per request in USDC.",
  display: "standalone",
  // The dusk mark: an amber sun setting over dithered water, on carbon
  // (public/brand/mark.svg). Padded inside the maskable safe zone.
  icons: [
    {
      purpose: "any",
      sizes: "192x192",
      src: "/icons/icon-192.png",
      type: "image/png",
    },
    {
      purpose: "any",
      sizes: "512x512",
      src: "/icons/icon-512.png",
      type: "image/png",
    },
    {
      purpose: "maskable",
      sizes: "512x512",
      src: "/icons/icon-512.png",
      type: "image/png",
    },
  ],
  id: "/",
  name: "RentAnLLM",
  orientation: "portrait",
  short_name: "RentAnLLM",
  shortcuts: [
    { name: "Seller console", url: "/console" },
    { name: "Market", url: "/market" },
  ],
  start_url: "/console",
  theme_color: palette.carbon,
});

export default manifest;
