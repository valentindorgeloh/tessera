"use client";

import { MultiSelector, type MultiSelectorOptionData } from "@astryxdesign/core/MultiSelector";
import { Token } from "@astryxdesign/core/Token";
import { useProjectRow } from "../project-provider";
import { summarizeNames } from "./membership-rules";
import { paletteTokenColor } from "./option-helpers";

export type LabelControlProps = {
  /** Label ids. */
  value: string[];
  onChange: (labelIds: string[]) => void;
  compact?: boolean;
  readOnly?: boolean;
  label?: string;
};

// The label colour helper lives in the directive-free ./option-helpers.ts.
export { paletteTokenColor };

/** Ghost multi-selector over the project's labels; rows and headers show the label as a coloured Token. */
export function LabelControl({ value, onChange, compact = false, readOnly = false, label = "Labels" }: LabelControlProps) {
  const { bundle, labelsById } = useProjectRow();
  const options: MultiSelectorOptionData[] = bundle.labels.map((row) => ({ value: row.id, label: row.name }));
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
      // Two names then "+N", so the rail and the dialog never run to an ellipsis; the open list shows every label.
      formatValue={(items) => summarizeNames(items.map((item) => item.label ?? item.value))}
      renderOption={(option) => (
        <Token label={option.label ?? option.value} size="sm" color={paletteTokenColor(labelsById.get(option.value)?.color)} />
      )}
      placeholder="No labels"
      emptyText="No labels in this project yet"
      hasSearch={options.length > 8}
    />
  );
}
