"use client";

import { Icon } from "@astryxdesign/core/Icon";
import { HStack } from "@astryxdesign/core/Stack";
import { Selector, type SelectorOptionData } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import type { Priority } from "@/lib/tessera/types";
import { PropertyChip, useArmed, useArmedHandoff } from "./arming";
import { PRIORITY_OPTIONS, isPriority, priorityOption, type PriorityOption } from "./option-helpers";

export type PriorityControlProps = {
  value: Priority;
  onChange: (priority: Priority) => void;
  compact?: boolean;
  readOnly?: boolean;
  label?: string;
  /** A compact control shows the glyph alone in a row; a form keeps the name beside it. */
  hasLabel?: boolean;
  /** Names this control to a row that arms (./arming.tsx); a row without arming leaves it out. */
  armKey?: string;
};

// The option list and its helpers live in the directive-free ./option-helpers.ts.
export { PRIORITY_OPTIONS, isPriority, priorityOption, type PriorityOption };

/** Glyph plus label, shared by the selector rows, its trigger and the list group headers. */
export function PriorityLabel({ value }: { value: string }) {
  const option = priorityOption(value);
  return (
    <HStack gap={1.5} vAlign="center">
      <Icon icon={option.icon} size="sm" color={option.value === "none" ? "secondary" : "primary"} />
      <Text type="inherit" className="tessera-wi-label-text">
        {option.label}
      </Text>
    </HStack>
  );
}

/** Ghost selector over the five priorities with their Phosphor glyphs. */
export function PriorityControl({ value, onChange, compact = false, readOnly = false, label = "Priority", hasLabel = false, armKey }: PriorityControlProps) {
  const { armed, arm } = useArmed();
  const { isDefaultOpen, takeFocus } = useArmedHandoff(armKey);
  const glyphOnly = compact && !hasLabel;
  if (!armed && !readOnly && armKey !== undefined) {
    const current = priorityOption(value);
    return (
      <PropertyChip label={`${label}: ${current.label}`} armKey={armKey} arm={arm} isSelector className={glyphOnly ? "tessera-wi-chip--icon" : undefined}>
        {glyphOnly ? <Icon icon={current.icon} size="sm" color={current.value === "none" ? "secondary" : "primary"} label={current.label} /> : <PriorityLabel value={value} />}
      </PropertyChip>
    );
  }
  const options: SelectorOptionData[] = PRIORITY_OPTIONS.map((option) => ({ value: option.value, label: option.label }));
  const render = (option: SelectorOptionData) => <PriorityLabel value={option.value} />;
  // Rows show the glyph alone; the option list and the full control keep the label.
  const renderValue = glyphOnly
    ? (option: SelectorOptionData) => {
        const current = priorityOption(option.value);
        return <Icon icon={current.icon} size="sm" color={current.value === "none" ? "secondary" : "primary"} label={current.label} />;
      }
    : render;
  return (
    <Selector
      ref={takeFocus}
      isDefaultOpen={isDefaultOpen}
      label={label}
      isLabelHidden
      variant="ghost"
      size={compact ? "sm" : "md"}
      // The glyph-only chip is narrower than a finger; work-items.css widens its hit area on touch.
      controlClassName={glyphOnly ? "tessera-wi-chip--icon" : undefined}
      options={options}
      value={value}
      onChange={(next) => {
        if (isPriority(next)) onChange(next);
      }}
      isReadOnly={readOnly}
      renderOption={render}
      renderValue={renderValue}
      placeholder="Priority"
    />
  );
}
