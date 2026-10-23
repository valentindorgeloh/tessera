"use client";

import type { ReactNode } from "react";
import { Icon } from "@astryxdesign/core/Icon";
import { List, ListItem } from "@astryxdesign/core/List";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { Heading } from "@astryxdesign/core/Text";
import { useRecents } from "./recents-store";
import { ROUTE_ICONS } from "./shell-icons";

/** How many recents Home lists when `limit` is omitted. */
const HOME_RECENTS = 8;

const SKELETON_ROWS = [0, 1, 2];

/** Home's recents filter, matched on the route icon (docs/drafts/p9-plan.md U1). */
export const RECENTS_FILTERS = ["all", "work-items", "pages", "projects"] as const;

export type RecentsFilter = (typeof RECENTS_FILTERS)[number];

const FILTER_ICONS: Record<Exclude<RecentsFilter, "all">, ReadonlySet<string>> = {
  "work-items": new Set(["work-item", "work-items"]),
  pages: new Set(["page"]),
  projects: new Set(["projects"]),
};

export function isRecentsFilter(value: string): value is RecentsFilter {
  return (RECENTS_FILTERS as readonly string[]).includes(value);
}

/**
 * Newest recents whose icon matches `filter`, capped at `limit`. `all` keeps
 * every icon. A negative limit yields an empty list.
 */
export function filterRecents<T extends { icon: string }>(recents: readonly T[], filter: RecentsFilter, limit: number): T[] {
  const matched = filter === "all" ? recents : recents.filter((recent) => FILTER_ICONS[filter].has(recent.icon));
  return matched.slice(0, limit < 0 ? 0 : limit);
}

export type RecentsListProps = {
  /** Omitted means every icon, which is what Home showed before the filter existed. */
  filter?: RecentsFilter;
  /** Omitted means the first 8, which is what Home showed before. */
  limit?: number;
  /**
   * Rendered under the "Recent" heading, above the rows (Home puts its kind
   * filter there, so the heading comes first). Added by the visual-audit
   * workspace lane (W7); omitting it keeps the old markup.
   */
  controls?: ReactNode;
};

/**
 * Home's "Recent" section (docs/contracts/ui.md "Shell"): the pages and work
 * items visited last, newest first, from the recents store. The list is read
 * after mount (it lives in localStorage), so the server render and the first
 * client render show placeholder rows. Omitting `filter` and `limit` keeps
 * that list: every icon, eight rows.
 */
export function RecentsList({ filter = "all", limit = HOME_RECENTS, controls }: RecentsListProps = {}) {
  const { recents, isLoaded } = useRecents();
  const heading = (
    <Heading level={4} accessibilityLevel={2}>
      Recent
    </Heading>
  );
  // With controls, the heading and the controls sit above the list and the list carries its own label, so the controls stay out of its accessible name.
  const lead =
    controls === undefined ? null : (
      <VStack gap={2}>
        {heading}
        {controls}
      </VStack>
    );
  if (!isLoaded) {
    return (
      <VStack gap={2} aria-busy="true" aria-label="Loading recent pages">
        {lead ?? heading}
        {SKELETON_ROWS.map((row) => (
          <Skeleton key={row} index={row} height="var(--size-element-md)" />
        ))}
      </VStack>
    );
  }
  const shown = filterRecents(recents, filter, limit);
  const emptyLabel = recents.length === 0 ? "Nothing here yet" : "Nothing in this filter";
  const emptyDescription = recents.length === 0 ? "The pages and work items you open show up here." : "Try another kind of page.";
  const list = (
    <List header={lead === null ? heading : undefined} aria-label={lead === null ? undefined : "Recent"} hasDividers edgeCompensation="inline">
      {shown.length === 0 ? (
        <ListItem label={emptyLabel} description={emptyDescription} />
      ) : (
        shown.map((recent) => (
          <ListItem key={recent.path} label={recent.label} href={recent.path} startContent={<Icon icon={ROUTE_ICONS[recent.icon]} size="sm" color="secondary" />} />
        ))
      )}
    </List>
  );
  return lead === null ? (
    list
  ) : (
    <VStack gap={4} className="tessera-recents">
      {lead}
      {list}
    </VStack>
  );
}
