"use client";

/**
 * The empty state of a list, board or table while a filter, a search or an
 * Advanced tree is active and nothing matches. A project with no work items
 * at all keeps the first-run state of each layout instead.
 */
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";

export function NoResults({ onClear }: { onClear: () => void }) {
  return (
    <EmptyState
      isCompact
      title="No work items match these filters"
      description="Change the filters or clear them to see more."
      actions={<Button variant="secondary" size="sm" label="Clear filters" onClick={onClear} />}
    />
  );
}
