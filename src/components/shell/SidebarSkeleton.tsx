"use client";

import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Layout";
import { SideNav, SideNavHeading } from "@astryxdesign/core/SideNav";
import { useSidebarResize } from "./Sidebar";
import { useShell } from "./TesseraShell";

const ROWS = [0, 1, 2, 3, 4, 5];

/** Suspense fallback for the sidebar: the same width and heading, with placeholder rows where the items go. */
export function SidebarSkeleton() {
  const { isNavCollapsed } = useShell();
  const resize = useSidebarResize();
  return (
    <SideNav key={resize.key} aria-label="Work" collapsible={{ isCollapsed: isNavCollapsed, hasButton: false }} resizable={resize.resizable} header={<SideNavHeading heading="Work" headingHref="/" />}>
      <VStack gap={2} padding={2} aria-busy="true" aria-label="Loading navigation">
        {ROWS.map((row) => (
          <Skeleton key={row} index={row} height="var(--size-element-sm)" width={row % 3 === 0 ? "70%" : "90%"} />
        ))}
      </VStack>
    </SideNav>
  );
}
