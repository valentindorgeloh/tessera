"use client";

/**
 * List layout (docs/contracts/ui.md "Work items screen"): one List per group
 * under a collapsible header, rows as ListItem with the key as the open
 * control and the enabled properties as compact ghost controls, a quick-add
 * row at the end of every group. Arrow keys move between the rows' open
 * controls (roving tab stop), Enter opens the focused item.
 *
 * Labels, assignees and modules are shown read-only here: `LayoutProps.onUpdate`
 * carries the update_work_item patch only; the set_* tools are reached from
 * the detail page and, in P2b, the peek panel. Quick-add placeholders
 * (./optimistic.ts) render as inert rows until the server item replaces them.
 */
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { useListFocus } from "@astryxdesign/core/hooks";
import { List, ListItem } from "@astryxdesign/core/List";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import type { Display, Group, StateGroup, WorkItem } from "@/lib/tessera/types";
import { isOptimisticId } from "./optimistic";
import { useProject } from "./project-provider";
import { ActorLabel, CycleControl, DateControl, PriorityControl, PriorityLabel, StateControl, StateLabel, paletteTokenColor } from "./properties";
import { QuickAdd } from "./QuickAdd";
import type { LayoutProps, QuickAddGroup, UpdateWorkItemPatch } from "./types";

const NONE_GROUP_ID = "none";
const STATE_GROUPS: readonly StateGroup[] = ["backlog", "unstarted", "started", "completed", "cancelled", "triage"];

function isStateGroup(value: string): value is StateGroup {
  return (STATE_GROUPS as readonly string[]).includes(value);
}

/** Day part of an ISO timestamp or date, for the created/updated columns. */
function dayOf(value: string | null): string {
  return value ? value.slice(0, 10) : "";
}

// ---------------------------------------------------------------------------
// Group header marker by group kind
// ---------------------------------------------------------------------------

function GroupMarker({ group }: { group: Group }) {
  const { statesById } = useProject();
  if (group.id === NONE_GROUP_ID) {
    return (
      <Text type="inherit" color="secondary" maxLines={1} hasTruncateTooltip={false}>
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
      return <ActorLabel name={group.name} />;
    default:
      return (
        <Text type="inherit" maxLines={1} hasTruncateTooltip={false}>
          {group.name}
        </Text>
      );
  }
}

function GroupHeader({ group }: { group: Group }) {
  return (
    <HStack gap={2} vAlign="center" className="tessera-wi-group-header">
      <HStack className="tessera-wi-group-name" vAlign="center">
        <Text type="label" weight="medium">
          <GroupMarker group={group} />
        </Text>
      </HStack>
      <Badge label={group.count} />
    </HStack>
  );
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

type RowProps = {
  item: WorkItem;
  display: Display;
  onUpdate: (id: string, patch: UpdateWorkItemPatch) => void;
  onOpen: (id: string) => void;
};

function RowProperties({ item, display, onUpdate, readOnly = false }: Omit<RowProps, "onOpen"> & { readOnly?: boolean }) {
  const { bundle, labelsById, actorsById, modulesById } = useProject();
  const props = display.properties;
  const nodes: ReactNode[] = [];
  if (props.state) {
    nodes.push(<StateControl key="state" compact readOnly={readOnly} value={item.state_id} onChange={(state_id) => onUpdate(item.id, { state_id })} />);
  }
  if (props.priority) {
    nodes.push(<PriorityControl key="priority" compact readOnly={readOnly} value={item.priority} onChange={(priority) => onUpdate(item.id, { priority })} />);
  }
  if (props.labels && item.label_ids.length > 0) {
    nodes.push(
      <HStack key="labels" gap={1} vAlign="center" wrap="wrap">
        {item.label_ids.map((id) => {
          const label = labelsById.get(id);
          return label ? <Token key={id} label={label.name} size="sm" color={paletteTokenColor(label.color)} /> : null;
        })}
      </HStack>,
    );
  }
  if (props.cycle && bundle.project.cycles_enabled) {
    nodes.push(<CycleControl key="cycle" compact readOnly={readOnly} value={item.cycle_id} onChange={(cycle_id) => onUpdate(item.id, { cycle_id })} />);
  }
  if (props.modules && bundle.project.modules_enabled && item.module_ids.length > 0) {
    nodes.push(
      <HStack key="modules" gap={1} vAlign="center" wrap="wrap">
        {item.module_ids.map((id) => {
          const mod = modulesById.get(id);
          return mod ? <Token key={id} label={mod.name} size="sm" /> : null;
        })}
      </HStack>,
    );
  }
  if (props.assignees && item.assignee_ids.length > 0) {
    nodes.push(
      <HStack key="assignees" gap={0.5} vAlign="center">
        {item.assignee_ids.map((id) => {
          const actor = actorsById.get(id);
          return actor ? <Avatar key={id} name={actor.name} size="xsm" /> : null;
        })}
      </HStack>,
    );
  }
  if (props.start_date) {
    nodes.push(
      <DateControl
        key="start"
        compact
        readOnly={readOnly}
        label="Start date"
        value={item.start_date}
        max={item.target_date}
        onChange={(start_date) => onUpdate(item.id, { start_date })}
      />,
    );
  }
  if (props.target_date) {
    nodes.push(
      <DateControl
        key="target"
        compact
        readOnly={readOnly}
        label="Target date"
        value={item.target_date}
        min={item.start_date}
        onChange={(target_date) => onUpdate(item.id, { target_date })}
      />,
    );
  }
  if (props.sub_items_count && item.sub_items_count > 0) {
    nodes.push(<Badge key="sub" label={`${item.sub_items_count} sub-items`} />);
  }
  if (props.links && item.links_count > 0) {
    nodes.push(<Badge key="links" label={`${item.links_count} links`} />);
  }
  if (props.created_at) {
    nodes.push(
      <Text key="created" type="supporting" className="tessera-wi-prop-text" hasTabularNumbers>
        Created {dayOf(item.created_at)}
      </Text>,
    );
  }
  if (props.updated_at) {
    nodes.push(
      <Text key="updated" type="supporting" className="tessera-wi-prop-text" hasTabularNumbers>
        Updated {dayOf(item.updated_at)}
      </Text>,
    );
  }
  return (
    <HStack gap={1} vAlign="center" className="tessera-wi-props">
      {nodes}
    </HStack>
  );
}

function WorkItemRow({ item, display, onUpdate, onOpen }: RowProps) {
  // The key button owns the row's action: surface clicks delegate to it and it is the row's only tab stop.
  const openRef = useRef<HTMLButtonElement>(null);
  if (isOptimisticId(item.id)) {
    // Placeholder from quick-add: nothing to open or edit until the server item arrives.
    return (
      <ListItem
        label={item.name}
        className="tessera-wi-row tessera-wi-row-pending"
        startContent={
          <Text type="supporting" color="secondary" className="tessera-wi-pending-key">
            Saving…
          </Text>
        }
        endContent={<RowProperties item={item} display={display} onUpdate={onUpdate} readOnly />}
      />
    );
  }
  return (
    <ListItem
      label={item.name}
      className="tessera-wi-row"
      interactiveRef={openRef}
      startContent={
        <Button
          ref={openRef}
          className="tessera-wi-open"
          variant="ghost"
          size="sm"
          label={item.key}
          tooltip={display.properties.key ? undefined : item.key}
          onClick={() => onOpen(item.id)}
        />
      }
      endContent={<RowProperties item={item} display={display} onUpdate={onUpdate} />}
    />
  );
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

type GroupSectionProps = {
  group: Group | null;
  items: WorkItem[];
  display: Display;
  isOpen: boolean;
  onToggle: (isOpen: boolean) => void;
  onUpdate: RowProps["onUpdate"];
  onOpen: RowProps["onOpen"];
  onQuickAdd: (group: QuickAddGroup, name: string) => void;
};

function GroupSection({ group, items, display, isOpen, onToggle, onUpdate, onOpen, onQuickAdd }: GroupSectionProps) {
  const quickAddGroup: QuickAddGroup = group ? { field: group.field, value: group.id === NONE_GROUP_ID ? null : group.id } : { field: null, value: null };
  const body = (
    <VStack gap={0}>
      {items.length > 0 ? (
        <List density="compact" hasDividers>
          {items.map((item) => (
            <WorkItemRow key={item.id} item={item} display={display} onUpdate={onUpdate} onOpen={onOpen} />
          ))}
        </List>
      ) : null}
      <QuickAdd onSubmit={(name) => onQuickAdd(quickAddGroup, name)} />
    </VStack>
  );
  if (!group) return body;
  return (
    <VStack gap={0} className="tessera-wi-group">
      <Collapsible trigger={<GroupHeader group={group} />} isOpen={isOpen} onOpenChange={onToggle} chevronPosition="start">
        {body}
      </Collapsible>
    </VStack>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function ListLayout({ result, display, onUpdate, onOpen, onQuickAdd }: LayoutProps) {
  const itemsById = useMemo(() => new Map(result.items.map((item) => [item.id, item])), [result.items]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const { listRef, handleKeyDown, handleFocus } = useListFocus<HTMLElement>({
    itemSelector: ".tessera-wi-open",
    orientation: "vertical",
    wrap: false,
    hasRovingTabIndex: true,
    hasCaretGuard: true,
  });

  const groups = display.group_by && result.groups ? result.groups.filter((group) => display.show_empty_groups || group.count > 0) : null;

  const toggle = (id: string, isOpen: boolean) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (isOpen) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isEmpty = result.items.length === 0 && (groups === null || groups.length === 0);

  return (
    <VStack ref={listRef} onKeyDown={handleKeyDown} onFocus={handleFocus} gap={groups ? 2 : 0} className="tessera-wi-list" paddingBlock={2}>
      {isEmpty ? (
        <EmptyState
          isCompact
          title="No work items yet"
          description="Create the first one with the button above, press c, or use the quick-add row."
        />
      ) : null}
      {groups ? (
        groups.map((group) => (
          <GroupSection
            key={`${group.field}:${group.id}`}
            group={group}
            items={group.item_ids.flatMap((id) => {
              const item = itemsById.get(id);
              return item ? [item] : [];
            })}
            display={display}
            isOpen={!collapsed.has(group.id)}
            onToggle={(isOpen) => toggle(group.id, isOpen)}
            onUpdate={onUpdate}
            onOpen={onOpen}
            onQuickAdd={onQuickAdd}
          />
        ))
      ) : (
        <GroupSection
          group={null}
          items={result.items}
          display={display}
          isOpen
          onToggle={() => {}}
          onUpdate={onUpdate}
          onOpen={onOpen}
          onQuickAdd={onQuickAdd}
        />
      )}
    </VStack>
  );
}
