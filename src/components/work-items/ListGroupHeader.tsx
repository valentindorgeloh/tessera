"use client";

/**
 * The list layout's group header (ListLayout.tsx): the marker for the group's kind (a state, a state group, a priority,
 * a label, cycle or module token, an actor) and the header row with the group's select-all checkbox, count and points.
 */
import { Badge } from "@astryxdesign/core/Badge";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import type { Display, Group, StateGroup } from "@/lib/tessera/types";
import { useProjectRow } from "./project-provider";
import { ActorLabel, PriorityLabel, StateLabel, paletteTokenColor } from "./properties";
import { GroupPoints } from "./GroupFooter";
import { loadedOfTotal } from "./paging";
import type { LayoutProps } from "./types";

export const NONE_GROUP_ID = "none";
const STATE_GROUPS: readonly StateGroup[] = ["backlog", "unstarted", "started", "completed", "cancelled", "triage"];

function isStateGroup(value: string): value is StateGroup {
  return (STATE_GROUPS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Group header marker by group kind
// ---------------------------------------------------------------------------

function GroupMarker({ group }: { group: Group }) {
  const { statesById, actorsById } = useProjectRow();
  if (group.id === NONE_GROUP_ID) {
    return (
      <Text type="inherit" color="secondary" className="tessera-wi-label-text">
        {group.name}
      </Text>
    );
  }
  switch (group.field) {
    case "state":
      return <StateLabel state={statesById.get(group.id)} name={group.name} />;
    case "state_group":
      return <StateLabel group={isStateGroup(group.id) ? group.id : "backlog"} name={group.name} />;
    case "priority":
      return <PriorityLabel value={group.id} />;
    case "labels":
    case "cycle":
    case "module":
      return <Token label={group.name} size="sm" color={paletteTokenColor(group.color)} />;
    case "assignees":
    case "created_by":
      return <ActorLabel name={group.name} actor={actorsById.get(group.id) ?? null} />;
    default:
      return (
        <Text type="inherit" className="tessera-wi-label-text">
          {group.name}
        </Text>
      );
  }
}

export function GroupHeader({ group, display, selection, ids }: { group: Group; display: Display; selection?: LayoutProps["selection"]; ids: readonly string[] }) {
  const selectedCount = selection ? ids.filter((id) => selection.selected.has(id)).length : 0;
  const value = !selection || selectedCount === 0 ? false : selectedCount === ids.length ? true : "indeterminate";
  return (
    <HStack gap={2} vAlign="center" className="tessera-wi-group-header">
      {/* Gutter furniture (work-items.css): positioned over the gutter, so it takes no slot and the group marker starts at the row key's x. */}
      {selection && ids.length > 0 ? (
        <CheckboxInput
          className="tessera-wi-select tessera-wi-group-select"
          size="sm"
          isLabelHidden
          label={group.has_more ? `Select ${group.name} (${loadedOfTotal(ids.length, group.count)})` : `Select ${group.name}`}
          value={value}
          onClick={(event) => event.stopPropagation()}
          onChange={(checked) => selection.onToggleIds(ids, checked === true || value === "indeterminate")}
        />
      ) : null}
      <HStack className="tessera-wi-group-name" vAlign="center">
        <Text type="label" weight="medium">
          <GroupMarker group={group} />
        </Text>
      </HStack>
      <Badge label={group.count} />
      <GroupPoints points={group.estimate_points} display={display} />
    </HStack>
  );
}
