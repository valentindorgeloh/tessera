"use client";

import { Avatar } from "@astryxdesign/core/Avatar";
import { MultiSelector, type MultiSelectorOptionData } from "@astryxdesign/core/MultiSelector";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useProject } from "../project-provider";

export type AssigneeControlProps = {
  /** Actor ids. */
  value: string[];
  onChange: (actorIds: string[]) => void;
  compact?: boolean;
  readOnly?: boolean;
  label?: string;
};

/** Avatar plus name row for selector options and group headers. */
export function ActorLabel({ name }: { name: string }) {
  return (
    <HStack gap={1.5} vAlign="center">
      <Avatar name={name} size="xsm" tooltip={false} />
      <Text type="inherit" className="tessera-wi-label-text">
        {name}
      </Text>
    </HStack>
  );
}

/** Ghost multi-selector over the live actors (the user, the assistant and registered agents). */
export function AssigneeControl({ value, onChange, compact = false, readOnly = false, label = "Assignees" }: AssigneeControlProps) {
  const { bundle, actorsById } = useProject();
  const options: MultiSelectorOptionData[] = bundle.actors
    .filter((actor) => actor.deleted_at === null || value.includes(actor.id))
    .map((actor) => ({ value: actor.id, label: actor.name }));
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
      formatValue={(items) => items.map((item) => actorsById.get(item.value)?.name ?? item.label).join(", ")}
      renderOption={(option) => <ActorLabel name={option.label ?? option.value} />}
      placeholder="Unassigned"
      hasSearch={options.length > 8}
    />
  );
}
