"use client";

import { MultiSelector, type MultiSelectorOptionData } from "@astryxdesign/core/MultiSelector";
import { HStack } from "@astryxdesign/core/Stack";
import { Token } from "@astryxdesign/core/Token";
import { useProject } from "../project-provider";
import { archivedModulesLabel, mergeModuleChange, splitModuleValue } from "./membership-rules";

export type ModuleControlProps = {
  /** Module ids. */
  value: string[];
  onChange: (moduleIds: string[]) => void;
  compact?: boolean;
  readOnly?: boolean;
  label?: string;
};

/**
 * Ghost multi-selector over the project's non-archived modules (an item may
 * belong to several). Ids of archived modules are not in the bundle: they stay
 * out of the selector, are added back on every change so `set_modules` never
 * drops them, and show as a read-only count (./membership-rules.ts).
 */
export function ModuleControl({ value, onChange, compact = false, readOnly = false, label = "Modules" }: ModuleControlProps) {
  const { bundle } = useProject();
  const options: MultiSelectorOptionData[] = bundle.modules.map((module) => ({ value: module.id, label: module.name }));
  const { editable, kept } = splitModuleValue(value, bundle.modules);
  const selector = (
    <MultiSelector
      label={label}
      isLabelHidden
      variant="ghost"
      size={compact ? "sm" : "md"}
      options={options}
      value={editable}
      onChange={(next) => onChange(mergeModuleChange(next, kept))}
      isReadOnly={readOnly}
      triggerDisplay="labels"
      formatValue={(items) => items.map((item) => item.label).join(", ")}
      placeholder="No modules"
      // Archived modules are not listed, so "yet" would be wrong once the item kept one.
      emptyText={kept.length > 0 ? "No active modules in this project" : "No modules in this project yet"}
      hasSearch={options.length > 8}
    />
  );
  if (kept.length === 0) return selector;
  return (
    <HStack gap={1} vAlign="center" wrap="wrap">
      {selector}
      <Token size="sm" color="gray" label={archivedModulesLabel(kept.length)} />
    </HStack>
  );
}
