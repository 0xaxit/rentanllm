import { redirect } from "next/navigation";

import { nodeHref, REGISTER_HREF } from "@/lib/setup-steps";

/**
 * Nodes live on the dashboard (one card each) and their own pages now. Old
 * links land in the right place: `?node=` on that node's page (keeping
 * `?next=`), `?next=node` on the dashboard's Register sheet.
 */
const NodesRedirect = async ({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string | string[];
    node?: string | string[];
  }>;
}) => {
  const { next, node } = await searchParams;
  if (typeof node === "string") {
    redirect(nodeHref(node, typeof next === "string" ? { next } : {}));
  }
  redirect(next === "node" ? REGISTER_HREF : "/console");
};

export default NodesRedirect;
