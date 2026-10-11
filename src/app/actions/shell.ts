"use server";

import { refresh } from "next/cache";

/**
 * Re-renders the current route after an external write (docs/contracts/ui.md,
 * "External writes"). `ChangesPoller` calls it when `/api/changes` reports
 * activity by an actor other than the user; it is the only sanctioned way for
 * client code to refresh, since `refresh()` works inside Server Actions only.
 */
export async function refreshAction(): Promise<void> {
  refresh();
}
