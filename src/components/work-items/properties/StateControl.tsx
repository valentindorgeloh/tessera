"use client";

import { HStack } from "@astryxdesign/core/Stack";
import { Selector, type SelectorOptionData } from "@astryxdesign/core/Selector";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import type { State, StateGroup } from "@/lib/tessera/types";
import { useProjectRow } from "../project-provider";
import { PropertyChip, useArmed, useArmedHandoff } from "./arming";
import { stateGroupLabel, stateGroupVariant } from "./option-helpers";

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
  /** Names this control to a row that arms (./arming.tsx); a row without arming leaves it out. */
  armKey?: string;
};

// The group helpers live in the directive-free ./option-helpers.ts (the planning panels import them from there).
export { stateGroupLabel, stateGroupVariant };

/** Dot plus name, used in the selector rows, its trigger and the list group headers. */
export function StateLabel({ state, group, name }: { state?: State; group?: StateGroup; name?: string }) {
  const resolvedGroup = state?.state_group ?? group ?? "backlog";
  const resolvedName = state?.name ?? name ?? stateGroupLabel(resolvedGroup);
  return (
    <HStack gap={1.5} vAlign="center">
      <StatusDot variant={stateGroupVariant(resolvedGroup)} label={stateGroupLabel(resolvedGroup)} />
      <Text type="inherit" className="tessera-wi-label-text">
        {resolvedName}
      </Text>
    </HStack>
  );
}

/** Ghost selector over the project's states; rows show the group's StatusDot. A row that has not armed shows a chip. */
export function StateControl({ value, onChange, compact = false, readOnly = false, label = "State", disabledMessage, armKey }: StateControlProps) {
  const { bundle, statesById } = useProjectRow();
  const { armed, arm } = useArmed();
  const { isDefaultOpen, takeFocus } = useArmedHandoff(armKey);
  if (!armed && !readOnly && armKey !== undefined && disabledMessage === undefined) {
    const state = statesById.get(value);
    return (
      <PropertyChip label={`${label}: ${state?.name ?? "none"}`} armKey={armKey} arm={arm} isSelector>
        {state ? <StateLabel state={state} /> : "State"}
      </PropertyChip>
    );
  }
  const options: SelectorOptionData[] = bundle.states
    .filter((state) => state.state_group !== "triage" || state.id === value)
    .map((state) => ({ value: state.id, label: state.name }));
  const render = (option: SelectorOptionData) => <StateLabel state={statesById.get(option.value)} name={option.label} />;
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
