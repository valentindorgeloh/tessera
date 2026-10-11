"use client";

/**
 * A relative Astryx Timestamp ("8 minutes ago") that renders only once the
 * page is hydrated. Timestamp reads the clock during render, so a value
 * between 10 and 60 seconds old reads "12 seconds ago" in the server HTML and
 * "13 seconds ago" on the client, and React reports a hydration mismatch
 * (seen after an edit followed by a reload). Timestamp does not accept
 * `suppressHydrationWarning`, so the server render and the hydration pass
 * leave the slot empty; client navigations render the time at once.
 *
 * Timestamp fixes its "now" when it mounts and only moves it with `isLive`,
 * so a value that changes later (another writer bumps `updated_at` while the
 * peek is open) read "in 1 minute". The time is keyed by its value, which
 * restarts that clock on every new value, and stays live by default.
 */
import { useSyncExternalStore } from "react";
import { Timestamp, type TimestampProps } from "@astryxdesign/core/Timestamp";

const subscribe = () => () => {};

/** False in the server render and the hydration pass, true afterwards. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

export type RelativeTimeProps = Omit<TimestampProps, "format">;

export function RelativeTime({ hasTooltip = true, isLive = true, ...props }: RelativeTimeProps) {
  const hydrated = useHydrated();
  return hydrated ? <Timestamp key={String(props.value)} {...props} format="relative" hasTooltip={hasTooltip} isLive={isLive} /> : null;
}
