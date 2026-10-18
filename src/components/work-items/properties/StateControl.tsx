"use client";

import { HStack } from "@astryxdesign/core/Stack";
import { Selector, type SelectorOptionData } from "@astryxdesign/core/Selector";
import { StatusDot, type StatusDotProps } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import type { State, StateGroup } from "@/lib/tessera/types";
import { useProject } from "../project-provider";

export type StateControlProps = {
  /** State id. */
  value: string;
  onChange: (stateId: string) => void;
  compact?: boolean;
  readOnly?: boolean;
  /** Accessible label; hidden visually. */
  label?: string;
  /** Disables the control and explains why (a triage item still in Intake). */
  disabledMessage?: string;
};

const GROUP_VARIANT: Record<StateGroup, StatusDotProps["variant"]> = {
  backlog: "neutral",
  unstarted: "neutral",
  started: "accent",
  completed: "success",
  cancelled: "error",
  triage: "warning",
};

const GROUP_LABEL: Record<StateGroup, string> = {
  backlog: "Backlog",
  unstarted: "Not started",
  started: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  triage: "Triage",
};

/** StatusDot variant for a state group (docs/contracts/ui.md: backlog/unstarted neutral, started accent, completed success, cancelled error). */
export function stateGroupVariant(group: StateGroup): StatusDotProps["variant"] {
  return GROUP_VARIANT[group];
}

export function stateGroupLabel(group: StateGroup): string {
  return GROUP_LABEL[group];
}

/** Dot plus name, used in the selector rows, its trigger and the list group headers. */
export function StateLabel({ state, group, name }: { state?: State; group?: StateGroup; name?: string }) {
  const resolvedGroup = state?.state_group ?? group ?? "backlog";
  const resolvedName = state?.name ?? name ?? GROUP_LABEL[resolvedGroup];
  return (
    <HStack gap={1.5} vAlign="center">
      <StatusDot variant={GROUP_VARIANT[resolvedGroup]} label={GROUP_LABEL[resolvedGroup]} />
      <Text type="inherit" maxLines={1} hasTruncateTooltip={false}>
        {resolvedName}
      </Text>
    </HStack>
  );
}

/** Ghost selector over the project's states; rows show the group's StatusDot. */
export function StateControl({ value, onChange, compact = false, readOnly = false, label = "State", disabledMessage }: StateControlProps) {
  const { bundle, statesById } = useProject();
  const options: SelectorOptionData[] = bundle.states
    .filter((state) => state.state_group !== "triage" || state.id === value)
    .map((state) => ({ value: state.id, label: state.name }));
  const render = (option: SelectorOptionData) => <StateLabel state={statesById.get(option.value)} name={option.label} />;
  return (
    <Selector
      label={label}
      isLabelHidden
      variant="ghost"
      size={compact ? "sm" : "md"}
      options={options}
      value={value}
      onChange={onChange}
      isReadOnly={readOnly}
      isDisabled={disabledMessage !== undefined}
      disabledMessage={disabledMessage}
      renderOption={render}
      renderValue={render}
      placeholder="State"
    />
  );
}
