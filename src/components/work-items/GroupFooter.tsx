"use client";

/**
 * "Show more" footer of a paged group, board column, lane cell or ungrouped
 * list (decision 112): the next page's size and how many rows stay hidden. It
 * renders nothing once everything is loaded.
 */
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import type { Display } from "@/lib/tessera/types";
import { hasUnloaded, loadMoreSize, showMoreLabel } from "./paging";

export type GroupFooterProps = {
  display: Display;
  loaded: number;
  total: number;
  isLoading?: boolean;
  onLoadMore: () => void;
  /**
   * `row` insets like a table row, `list` puts the button on the list rows' key column (so its label starts at the
   * key text), `card` sits in a board column or cell, `inline` goes inside a table group header.
   */
  variant?: "row" | "list" | "card" | "inline";
};

export function GroupFooter({ display, loaded, total, isLoading = false, onLoadMore, variant = "row" }: GroupFooterProps) {
  if (!hasUnloaded(loaded, total)) return null;
  return (
    <HStack className="tessera-paging-footer" data-variant={variant}>
      <Button
        variant="ghost"
        size="sm"
        label={showMoreLabel(loaded, total, loadMoreSize(display))}
        isLoading={isLoading}
        onClick={(event) => {
          // Inside a table group header the click must not also collapse the group.
          event.stopPropagation();
          onLoadMore();
        }}
      />
    </HStack>
  );
}

/**
 * "N pts" beside a group's count: the engine sums the whole group
 * (decision 113), so the number does not shrink with the loaded page.
 * Shown only while the estimate property is visible and a project counts points.
 */
export function GroupPoints({ points, display }: { points: number | undefined; display: Display }) {
  if (points === undefined || !display.properties.estimate) return null;
  return (
    <Text type="supporting" color="secondary" className="tessera-paging-points">
      {points} pts
    </Text>
  );
}
