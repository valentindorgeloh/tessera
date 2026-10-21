"use client";

/**
 * Table of contents for a long page (docs/drafts/p10-plan.md "Page outline").
 * Headings come from the editor DOM via Astryx `useOutlineFromDOM` (ids from
 * `heading-ids`); empty when the body has no headings yet. It is an aside
 * inside the page frame (PageScreen, styles/pages.css), not a Layout panel,
 * so opening it never narrows the reading column. Beside the column when the
 * frame is wide enough, stacked above it otherwise; it never covers text.
 */
import type { RefObject } from "react";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Outline, useOutlineFromDOM } from "@astryxdesign/core/Outline";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/Stack";

export type PageOutlineProps = {
  containerRef: RefObject<HTMLElement | null>;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
};

export function PageOutline({ containerRef, scrollContainerRef }: PageOutlineProps) {
  const items = useOutlineFromDOM(containerRef);
  return (
    <VStack as="aside" aria-label="Outline" gap={2} padding={3} className="tessera-page-outline">
      <Text type="supporting" color="secondary">
        Outline
      </Text>
      {items.length === 0 ? (
        <EmptyState isCompact title="No headings yet" description="Add Heading 1–3 in the page body." />
      ) : (
        <Outline items={items} density="compact" scrollContainerRef={scrollContainerRef} label="Page outline" />
      )}
    </VStack>
  );
}
