"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { pauseListing, updateListing } from "@/lib/api/actions";
import type { Listing } from "@/lib/api/types";

import { SegmentedControl } from "../app-shell/segmented-control";
import { useToast } from "../app-shell/toast";

type Status = Listing["status"];

/** Draft / live / paused switch for one listing. */
export const ListingStatus = ({
  listingId,
  status,
}: {
  listingId: string;
  status: Status;
}) => {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState<Status>(status);

  const change = async (next: Status) => {
    const previous = value;
    setValue(next);
    const result =
      next === "paused"
        ? await pauseListing(listingId)
        : await updateListing(listingId, { status: next });
    if (!result.ok) {
      setValue(previous);
      toast({
        detail: result.error.message,
        title: "Not changed",
        tone: "error",
      });
      return;
    }
    toast({ title: `Listing ${next}` });
    router.refresh();
  };

  return (
    <SegmentedControl<Status>
      label="Listing status"
      onChange={(next) => {
        change(next).catch(() => setValue(status));
      }}
      segments={[
        { label: "LIVE", value: "live" },
        { label: "PAUSED", value: "paused" },
        { label: "DRAFT", value: "draft" },
      ]}
      value={value}
    />
  );
};
