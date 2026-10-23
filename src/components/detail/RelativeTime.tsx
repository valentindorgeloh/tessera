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
 *
 * A time inside a row (an activity entry, a comment) passes `hasTooltip={false}`:
 * Timestamp adds a tab stop only while its hover card is attached, so the
 * rows add none. The absolute time then moves to the `<time>`'s `title`, so a
 * pointer still reads it. The Created and Updated rows of the property rail
 * keep the card (and its Copy), and with it the focus stop.
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

/** "Oct 21, 2026, 3:04 PM": the value in the viewer's zone (a number is Unix seconds, as Timestamp reads it). */
export function absoluteTitle(value: TimestampProps["value"]): string | undefined {
  const date = new Date(typeof value === "number" ? value * 1000 : value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function RelativeTime({ hasTooltip = true, isLive = true, ...props }: RelativeTimeProps) {
  const hydrated = useHydrated();
  if (!hydrated) return null;
  // TimestampProps has no `title`, but Timestamp spreads its rest props onto the <time>, so the absolute time rides along untyped.
  const title = hasTooltip ? {} : { title: absoluteTitle(props.value) };
  return <Timestamp key={String(props.value)} {...props} {...title} format="relative" hasTooltip={hasTooltip} isLive={isLive} />;
}
