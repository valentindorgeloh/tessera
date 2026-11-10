"use client";

import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Layout";
import { SideNav } from "@astryxdesign/core/SideNav";
import { useSideNavChrome, useSideNavKey } from "./side-nav-chrome";

const ROWS = [0, 1, 2, 3, 4, 5];

/**
 * Suspense fallback for the sidebar: the same frame as the sidebar
 * (`useSideNavChrome()`, so a stored rail shows as the 60 or 48px rail and a
 * floating sidebar stays closed), with placeholder rows where the items go.
 */
export function SidebarSkeleton() {
  const sideNavKey = useSideNavKey();
  const chrome = useSideNavChrome();
  return (
    <SideNav key={sideNavKey} {...chrome} aria-label="Work">
      <VStack gap={2} padding={2} aria-busy="true" aria-label="Loading navigation">
        {ROWS.map((row) => (
          <Skeleton key={row} index={row} height="var(--size-element-sm)" width={row % 3 === 0 ? "70%" : "90%"} />
        ))}
      </VStack>
    </SideNav>
  );
}
