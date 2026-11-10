"use client";

/**
 * Estimate selector for the property rail, the create dialog, the list and
 * the bulk bar. Hidden while Estimates are off or the project has no active
 * system. Options come from the project bundle.
 */
import { Selector, type SelectorOptionData } from "@astryxdesign/core/Selector";
import { formatEstimateValue } from "@/components/estimates/estimate-format";
import { useProjectRow } from "@/components/work-items/project-provider";
import { PropertyChip, useArmed, useArmedHandoff } from "./arming";

export type EstimateControlProps = {
  value: string | null;
  onChange: (value: string | null) => void;
  size?: "sm" | "md";
  isLabelHidden?: boolean;
  readOnly?: boolean;
  /** Names this control to a row that arms (./arming.tsx); a row without arming leaves it out. */
  armKey?: string;
};

export function EstimateControl({ value, onChange, size = "md", isLabelHidden = true, readOnly = false, armKey }: EstimateControlProps) {
  const { bundle } = useProjectRow();
  const { armed, arm } = useArmed();
  const { isDefaultOpen, takeFocus } = useArmedHandoff(armKey);
  const estimate = bundle.estimate;
  if (!bundle.project.estimates_enabled || estimate === null) return null;
  if (!armed && !readOnly && armKey !== undefined) {
    const point = value === null ? undefined : estimate.points.find((candidate) => candidate.id === value);
    const shown = point === undefined ? undefined : formatEstimateValue(estimate.type, point.value);
    return (
      <PropertyChip label={`Estimate: ${shown ?? "none"}`} armKey={armKey} arm={arm} isSelector hasClear={value !== null}>
        {shown ?? "No estimate"}
      </PropertyChip>
    );
  }
  const options: SelectorOptionData[] = estimate.points.map((point) => ({
    value: point.id,
    label: formatEstimateValue(estimate.type, point.value),
  }));
  const render = (option: SelectorOptionData) => option.label;
  return (
    <Selector
      ref={takeFocus}
      isDefaultOpen={isDefaultOpen}
      label="Estimate"
      isLabelHidden={isLabelHidden}
      hasClear
      variant="ghost"
      size={size}
      options={options}
      value={value}
      onChange={(next) => onChange(next === "" || next === null ? null : next)}
      isReadOnly={readOnly}
      renderOption={render}
      renderValue={render}
      placeholder="No estimate"
    />
  );
}
