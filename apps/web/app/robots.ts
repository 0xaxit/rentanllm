import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/env";

/** Crawl the public pages; the API proxy and the signed-in consoles are not for search. */
const robots = (): MetadataRoute.Robots => ({
  rules: {
    allow: "/",
    disallow: ["/api/", "/console", "/connect", "/budget"],
    userAgent: "*",
  },
  sitemap: `${SITE_URL}/sitemap.xml`,
});

export default robots;
