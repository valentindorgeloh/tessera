"use client";

import { MultiSelector, type MultiSelectorOptionData } from "@astryxdesign/core/MultiSelector";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { ActorAvatar, type AvatarActor } from "@/components/shell/ActorAvatar";
import { useProjectRow } from "../project-provider";

export type AssigneeControlProps = {
  /** Actor ids. */
  value: string[];
  onChange: (actorIds: string[]) => void;
  compact?: boolean;
  readOnly?: boolean;
  label?: string;
};

/** Avatar plus name row for selector options and group headers. Pass `actor` when known, so an agent shows its glyph. */
export function ActorLabel({ name, actor = null }: { name: string; actor?: AvatarActor | null }) {
  return (
    <HStack gap={1.5} vAlign="center">
      <ActorAvatar actor={actor} name={name} size="xsm" tooltip={false} />
      <Text type="inherit" className="tessera-wi-label-text">
        {name}
      </Text>
    </HStack>
  );
}

/** Ghost multi-selector over the live actors (the user, the assistant and registered agents). */
export function AssigneeControl({ value, onChange, compact = false, readOnly = false, label = "Assignees" }: AssigneeControlProps) {
  const { bundle, actorsById } = useProjectRow();
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
      renderOption={(option) => <ActorLabel name={option.label ?? option.value} actor={actorsById.get(option.value) ?? null} />}
      placeholder="Unassigned"
      hasSearch={options.length > 8}
    />
  );
}
