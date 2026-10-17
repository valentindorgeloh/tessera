"use client";

import { Icon } from "@astryxdesign/core/Icon";
import { List, ListItem } from "@astryxdesign/core/List";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { Heading } from "@astryxdesign/core/Text";
import { useRecents } from "./recents-store";
import { ROUTE_ICONS } from "./shell-icons";

/** How many recents Home lists. */
const HOME_RECENTS = 8;

const SKELETON_ROWS = [0, 1, 2];

/**
 * Home's "Recent" section (docs/contracts/ui.md "Shell"): the pages and work
 * items visited last, newest first, from the recents store. The list is read
 * after mount (it lives in localStorage), so the server render and the first
 * client render show placeholder rows.
 */
export function RecentsList() {
  const { recents, isLoaded } = useRecents(HOME_RECENTS);
  const header = (
    <Heading level={4} accessibilityLevel={2}>
      Recent
    </Heading>
  );
  if (!isLoaded) {
    return (
      <VStack gap={2} aria-busy="true" aria-label="Loading recent pages">
        {header}
        {SKELETON_ROWS.map((row) => (
          <Skeleton key={row} index={row} height="var(--size-element-md)" />
        ))}
      </VStack>
    );
  }
  return (
    <List header={header} hasDividers edgeCompensation="inline">
      {recents.length === 0 ? (
        <ListItem label="Nothing here yet" description="The pages and work items you open show up here." />
      ) : (
        recents.map((recent) => (
          <ListItem key={recent.path} label={recent.label} href={recent.path} startContent={<Icon icon={ROUTE_ICONS[recent.icon]} size="sm" color="secondary" />} />
        ))
      )}
    </List>
  );
}
