"use client";

import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Layout";
import { SideNav, SideNavHeading } from "@astryxdesign/core/SideNav";

const ROWS = [0, 1, 2, 3, 4, 5];

/** Suspense fallback for the sidebar: the same rail, with placeholder rows where the projects go. */
export function SidebarSkeleton() {
  return (
    <SideNav aria-label="Tessera" header={<SideNavHeading heading="Tessera" headingHref="/home" />}>
      <VStack gap={2} padding={2} aria-busy="true" aria-label="Loading navigation">
        {ROWS.map((row) => (
          <Skeleton key={row} index={row} height="var(--size-element-sm)" width={row % 3 === 0 ? "70%" : "90%"} />
        ))}
      </VStack>
    </SideNav>
  );
}
