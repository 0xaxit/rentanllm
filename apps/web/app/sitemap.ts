import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/env";

/** The public pages search engines should know about. */
const sitemap = (): MetadataRoute.Sitemap => [
  { changeFrequency: "daily", priority: 1, url: `${SITE_URL}/` },
  { changeFrequency: "daily", priority: 0.8, url: `${SITE_URL}/market` },
];

export default sitemap;
