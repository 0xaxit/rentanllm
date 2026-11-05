import type { ApiNode } from "./api/types";

/** Status chip tone for a node: online green, offline red, anything else clay. */
export const nodeStatusTone = (status: ApiNode["status"]) => {
  if (status === "online") {
    return "live" as const;
  }
  return status === "offline" ? ("down" as const) : ("clay" as const);
};
