"use client";

import { MultiSelector, type MultiSelectorOptionData } from "@astryxdesign/core/MultiSelector";
import { useProject } from "../project-provider";

export type ModuleControlProps = {
  /** Module ids. */
  value: string[];
  onChange: (moduleIds: string[]) => void;
  compact?: boolean;
  readOnly?: boolean;
  label?: string;
};

/** Ghost multi-selector over the project's non-archived modules (an item may belong to several). */
export function ModuleControl({ value, onChange, compact = false, readOnly = false, label = "Modules" }: ModuleControlProps) {
  const { bundle } = useProject();
  const options: MultiSelectorOptionData[] = bundle.modules.map((module) => ({ value: module.id, label: module.name }));
  return (
    <MultiSelector
      label={label}
      isLabelHidden
      variant="ghost"
      size={compact ? "sm" : "md"}
      options={options}
      value={value}
      onChange={onChange}
      isReadOnly={readOnly}
      triggerDisplay="labels"
      formatValue={(items) => items.map((item) => item.label).join(", ")}
      placeholder="No modules"
      emptyText="No modules in this project yet"
      hasSearch={options.length > 8}
    />
  );
}
