import { Skeleton } from "@astryxdesign/core/Skeleton";
import { HStack, VStack } from "@astryxdesign/core/Stack";

/**
 * Suspense fallback for the content area, shown while a page's data streams
 * in on a cold load (docs/contracts/ui.md "Reads"). The frame's boundary sits
 * above the page, so a client navigation keeps the old page on screen until
 * the new one is ready instead of committing this skeleton. Generic on
 * purpose: a title row, a toolbar row and a few content rows.
 */
export function PageSkeleton() {
  return (
    <VStack gap={4} padding={5} aria-busy="true" aria-label="Loading page">
      <HStack gap={3} hAlign="between">
        <Skeleton width="30%" height="var(--size-element-md)" />
        <Skeleton width="20%" height="var(--size-element-md)" index={1} />
      </HStack>
      <Skeleton height="calc(var(--size-element-lg) * 3)" index={2} />
      <Skeleton height="var(--size-element-lg)" index={3} />
      <Skeleton height="var(--size-element-lg)" index={4} />
      <Skeleton height="var(--size-element-lg)" index={5} />
    </VStack>
  );
}
