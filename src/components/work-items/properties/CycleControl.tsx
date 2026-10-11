"use client";

import { Selector, type SelectorOptionData } from "@astryxdesign/core/Selector";
import type { CycleStatus } from "@/lib/tessera/types";
import { useProject } from "../project-provider";

export type CycleControlProps = {
  /** Cycle id or null. */
  value: string | null;
  onChange: (cycleId: string | null) => void;
  compact?: boolean;
  readOnly?: boolean;
  label?: string;
};

const STATUS_LABEL: Record<CycleStatus, string> = {
  current: "Current",
  upcoming: "Upcoming",
  completed: "Completed",
  draft: "Draft",
};

/** Ghost selector over the project's non-archived cycles; clearing removes the item from its cycle. */
export function CycleControl({ value, onChange, compact = false, readOnly = false, label = "Cycle" }: CycleControlProps) {
  const { bundle } = useProject();
  const options: SelectorOptionData[] = bundle.cycles.map((cycle) => ({
    value: cycle.id,
    label: cycle.name,
    description: STATUS_LABEL[cycle.status],
  }));
  return (
    <Selector
      label={label}
      isLabelHidden
      variant="ghost"
      size={compact ? "sm" : "md"}
      options={options}
      value={value}
      onChange={(next) => onChange(next)}
      hasClear
      isReadOnly={readOnly}
      placeholder={compact ? "Cycle" : "No cycle"}
      emptyText="No cycles in this project yet"
    />
  );
}
