"use client";

/** Home recents (docs/drafts/p9-plan.md U1): the stored list, filtered by route icon. */
import { useState } from "react";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { RecentsList, RECENTS_FILTERS, isRecentsFilter, type RecentsFilter } from "@/components/shell/RecentsList";

const LABELS: Record<RecentsFilter, string> = {
  all: "All",
  "work-items": "Work items",
  pages: "Pages",
  projects: "Projects",
};

export function RecentsWidget() {
  const [filter, setFilter] = useState<RecentsFilter>("all");
  return (
    <RecentsList
      filter={filter}
      controls={
        <SegmentedControl label="Recent pages" size="sm" value={filter} onChange={(value) => isRecentsFilter(value) && setFilter(value)}>
          {RECENTS_FILTERS.map((value) => (
            <SegmentedControlItem key={value} value={value} label={LABELS[value]} />
          ))}
        </SegmentedControl>
      }
    />
  );
}
