"use client";

import { Selector, type SelectorOptionData } from "@astryxdesign/core/Selector";
import { useProjectRow } from "../project-provider";
import { PropertyChip, useArmed, useArmedHandoff } from "./arming";
import { cycleControlModel } from "./membership-rules";

export type CycleControlProps = {
  /** Cycle id or null. */
  value: string | null;
  onChange: (cycleId: string | null) => void;
  compact?: boolean;
  readOnly?: boolean;
  label?: string;
  /** Names this control to a row that arms (./arming.tsx); a row without arming leaves it out. */
  armKey?: string;
};

/**
 * Ghost selector over the project's cycles that are not completed; clearing
 * removes the item from its cycle. A value in a completed cycle, or in an
 * archived one (missing from the bundle), is read-only: the engine refuses to
 * move the item out of it (./membership-rules.ts).
 */
export function CycleControl({ value, onChange, compact = false, readOnly = false, label = "Cycle", armKey }: CycleControlProps) {
  const { bundle } = useProjectRow();
  const { armed, arm } = useArmed();
  const { isDefaultOpen, takeFocus } = useArmedHandoff(armKey);
  const model = cycleControlModel(value, bundle.cycles);
  if (!armed && !readOnly && !model.readOnly && armKey !== undefined) {
    const current = model.options.find((option) => option.value === value)?.label;
    return (
      <PropertyChip label={`${label}: ${current ?? "none"}`} armKey={armKey} arm={arm} isSelector hasClear={value !== null}>
        {current ?? (compact ? "Cycle" : "No cycle")}
      </PropertyChip>
    );
  }
  const options: SelectorOptionData[] = model.options;
  return (
    <Selector
      ref={takeFocus}
      isDefaultOpen={isDefaultOpen}
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
