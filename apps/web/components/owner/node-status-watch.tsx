"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent } from "react";

import { listNodes } from "@/lib/api/actions";
import type { ApiNode } from "@/lib/api/types";
import { shortId } from "@/lib/cx";

import { useToast } from "../app-shell/toast";

const POLL_MS = 3000;

type Seen = Pick<ApiNode, "connectedAt" | "id" | "status">;

const fingerprint = (nodes: readonly Seen[]) =>
  nodes
    .map((n) => `${n.id}:${n.status}:${n.connectedAt?.getTime() ?? ""}`)
    .toSorted()
    .join("|");

/**
 * Owner pages are server-rendered, so a node going offline (or coming back)
 * would only show after a reload. This polls GET /owner/nodes while the tab
 * is visible and refreshes the page when any node's status or tunnel changes.
 * The gateway marks a node offline as soon as its tunnel closes, or after
 * three missed heartbeats when the connection drops silently.
 */
export const NodeStatusWatch = ({ nodes }: { nodes: readonly Seen[] }) => {
  const router = useRouter();
  const toast = useToast();
  const rendered = fingerprint(nodes);

  const onChange = useEffectEvent((next: readonly ApiNode[]) => {
    const statusBefore = new Map(nodes.map((n) => [n.id, n.status]));
    for (const node of next) {
      if (statusBefore.get(node.id) === "online" && node.status !== "online") {
        toast({
          detail: "Its agent disconnected from the gateway.",
          title: `Node ${shortId(node.id)} went offline`,
          tone: "error",
        });
      }
    }
    router.refresh();
  });

  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      const result = await listNodes();
      if (!stopped && result.ok && fingerprint(result.data) !== rendered) {
        onChange(result.data);
      }
    };
    const timer = window.setInterval(() => {
      check().catch(() => null);
    }, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [rendered]);

  return null;
};
