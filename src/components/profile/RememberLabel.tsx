"use client";

/** Remembers a route's name for the recents list. Renders nothing. */
import { useEffect } from "react";
import { registerEntityLabel } from "@/components/shell/entity-labels";

export function RememberLabel({ id, label }: { id: string; label: string }) {
  useEffect(() => {
    registerEntityLabel(id, label);
  }, [id, label]);
  return null;
}
