"use client";

import { Selector, type SelectorOptionData } from "@astryxdesign/core/Selector";
import { useProjectRow } from "../project-provider";
import { cycleControlModel } from "./membership-rules";

export type CycleControlProps = {
  /** Cycle id or null. */
  value: string | null;
  onChange: (cycleId: string | null) => void;
  compact?: boolean;
  readOnly?: boolean;
  label?: string;
};

/**
 * Ghost selector over the project's cycles that are not completed; clearing
 * removes the item from its cycle. A value in a completed cycle, or in an
 * archived one (missing from the bundle), is read-only: the engine refuses to
 * move the item out of it (./membership-rules.ts).
 */
export function CycleControl({ value, onChange, compact = false, readOnly = false, label = "Cycle" }: CycleControlProps) {
  const { bundle } = useProjectRow();
  const model = cycleControlModel(value, bundle.cycles);
  const options: SelectorOptionData[] = model.options;
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
      isReadOnly={readOnly || model.readOnly}
      placeholder={compact ? "Cycle" : "No cycle"}
      emptyText="No open cycles in this project"
    />
  );
}
