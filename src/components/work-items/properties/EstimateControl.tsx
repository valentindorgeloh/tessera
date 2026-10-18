"use client";

/**
 * Estimate selector for the property rail, the create dialog, the list and
 * the bulk bar. Hidden while Estimates are off or the project has no active
 * system. Options come from the project bundle.
 */
import { Selector, type SelectorOptionData } from "@astryxdesign/core/Selector";
import { formatEstimateValue } from "@/components/estimates/estimate-format";
import { useProject } from "@/components/work-items/project-provider";

export type EstimateControlProps = {
  value: string | null;
  onChange: (value: string | null) => void;
  size?: "sm" | "md";
  isLabelHidden?: boolean;
  readOnly?: boolean;
};

export function EstimateControl({ value, onChange, size = "md", isLabelHidden = true, readOnly = false }: EstimateControlProps) {
  const { bundle } = useProject();
  const estimate = bundle.estimate;
  if (!bundle.project.estimates_enabled || estimate === null) return null;
  const options: SelectorOptionData[] = estimate.points.map((point) => ({
    value: point.id,
    label: formatEstimateValue(estimate.type, point.value),
  }));
  const render = (option: SelectorOptionData) => option.label;
  return (
    <Selector
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
