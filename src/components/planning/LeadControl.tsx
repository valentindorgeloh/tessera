"use client";

/**
 * Module lead picker (docs/contracts/ui.md "Modules (E2)"): an Astryx
 * `Selector` labelled "Lead" over the project's actors plus "No lead". The
 * module dialog and the side panel pass `compact`: a ghost selector at size
 * sm (28px, like the date inputs and Members beside it) whose label the
 * MetadataList row already shows (the PropertyRail pattern).
 */
import { Selector, type SelectorOptionData } from "@astryxdesign/core/Selector";
import { ActorLabel } from "@/components/work-items/properties/AssigneeControl";
import { useProject } from "@/components/work-items/project-provider";

export type LeadControlProps = {
  /** Actor id of the lead, or null. */
  value: string | null;
  onChange: (actorId: string | null) => void;
  readOnly?: boolean;
  /** Ghost selector with its label hidden, for a labelled row (the side panel). */
  compact?: boolean;
};

/** The "No lead" option's value, the DisplayMenu NONE pattern (Selector values are strings). */
const NONE = "__none__";

export function LeadControl({ value, onChange, readOnly = false, compact = false }: LeadControlProps) {
  const { bundle, actorsById } = useProject();
  const options: SelectorOptionData[] = [
    { value: NONE, label: "No lead" },
    ...bundle.actors.filter((actor) => actor.deleted_at === null || actor.id === value).map((actor) => ({ value: actor.id, label: actor.name })),
  ];
  // A lead missing from the bundle (a removed actor) still shows instead of an empty trigger.
  if (value !== null && !actorsById.has(value)) options.push({ value, label: "Removed" });
  const render = (option: SelectorOptionData) => (option.value === NONE ? (option.label ?? "No lead") : <ActorLabel name={option.label ?? option.value} actor={actorsById.get(option.value) ?? null} />);
  return (
    <Selector
      label="Lead"
      isLabelHidden={compact}
      variant={compact ? "ghost" : "input"}
      size={compact ? "sm" : "md"}
      options={options}
      value={value ?? NONE}
      onChange={(next) => {
        const actorId = next === NONE ? null : next;
        if (actorId !== value) onChange(actorId);
      }}
      isReadOnly={readOnly}
      renderOption={render}
      renderValue={render}
      hasSearch={options.length > 8}
    />
  );
}
