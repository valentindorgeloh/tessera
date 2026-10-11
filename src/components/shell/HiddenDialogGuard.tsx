"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { closeHiddenDialogs } from "./hidden-dialogs";

/**
 * After every navigation, closes the modal dialogs the route just left behind
 * in its hidden Activity, so the page shown next stays usable (./hidden-dialogs.ts).
 * The URL changes in the same commit that hides the old route, so the effect
 * sees the final DOM. Renders nothing; it reads request-bound hooks, so the
 * shell wraps it in its own Suspense boundary.
 */
export function HiddenDialogGuard() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    closeHiddenDialogs(document);
  }, [pathname, search]);
  return null;
}
