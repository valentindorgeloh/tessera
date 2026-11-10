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
import { memo, useCallback, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { useEntryAnimation, useListFocus, type AnimatedLayout } from "@astryxdesign/core/hooks";
import { List, ListItem } from "@astryxdesign/core/List";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { formatEstimateValue } from "@/components/estimates/estimate-format";
import { ActorAvatar } from "@/components/shell/ActorAvatar";
import { groupLimitKey } from "@/lib/tessera/core/group";
import type { Display, Group, StateGroup, WorkItem } from "@/lib/tessera/types";
import { visibleGroups, nothingMatches } from "./list-groups";
import { isOptimisticId } from "./optimistic";
import { useProjectRow } from "./project-provider";
import { RowProject } from "./row-project";
import { ActorLabel, CycleControl, DateControl, PriorityControl, PriorityLabel, StateControl, StateLabel, paletteTokenColor } from "./properties";
import { ArmedContext, useArmed, useRowArming } from "./properties/arming";
import { isOverdue } from "./properties/date-format";
import { splitShownNames } from "./properties/membership-rules";
import { GroupFooter, GroupPoints } from "./GroupFooter";
import { UNGROUPED_KEY, loadedOfTotal } from "./paging";
import { NoResults } from "./NoResults";
import { OneLineText } from "./OneLineText";
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

function GroupHeader({ group, display, selection, ids }: { group: Group; display: Display; selection?: LayoutProps["selection"]; ids: readonly string[] }) {
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

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

type RowProps = {
  item: WorkItem;
  display: Display;
  onUpdate: (id: string, patch: UpdateWorkItemPatch) => void;
  onOpen: (id: string) => void;
  /** Archived project: every property control is read-only (F3.4). */
  readOnly?: boolean;
  /** Absent: the list has no selection column. Otherwise whether this row is ticked. */
  selected?: boolean;
  /** The selection hook's fixed-identity toggle (use-selection.ts); present exactly when `selected` is. */
  onToggle?: (id: string, shift: boolean) => void;
};

function RowProperties({ item, display, onUpdate, readOnly = false }: Pick<RowProps, "item" | "display" | "onUpdate" | "readOnly">) {
  const { bundle, labelsById, actorsById, modulesById, statesById } = useProjectRow();
  const { armed } = useArmed();
  const props = display.properties;
  const nodes: ReactNode[] = [];
  if (props.state) {
    nodes.push(<StateControl key="state" armKey="state" compact readOnly={readOnly} value={item.state_id} onChange={(state_id) => onUpdate(item.id, { state_id })} />);
  }
  if (props.priority) {
    nodes.push(<PriorityControl key="priority" armKey="priority" compact readOnly={readOnly} value={item.priority} onChange={(priority) => onUpdate(item.id, { priority })} />);
  }
  if (props.labels && item.label_ids.length > 0) {
    const labels = item.label_ids.flatMap((id) => {
      const label = labelsById.get(id);
      return label ? [label] : [];
    });
    // Two labels, then "+N" with every name in a tooltip (docs/drafts/plane-visual-reference.md section 6).
    const { shown, hidden } = splitShownNames(labels);
    nodes.push(
      <HStack key="labels" gap={2} vAlign="center" wrap="wrap" className="tessera-wi-chips">
        {shown.map((label) => (
          <Token key={label.id} label={label.name} size="sm" color={paletteTokenColor(label.color)} />
        ))}
        {hidden > 0 ? (
          // The tooltip's layer mounts once the row is armed; the token carries the count either way.
          armed ? (
            <Tooltip key="labels-more" content={labels.map((label) => label.name).join(", ")}>
              <Token label={`+${hidden}`} size="sm" description={`${hidden} more labels`} />
            </Tooltip>
          ) : (
            <Token key="labels-more" label={`+${hidden}`} size="sm" description={`${hidden} more labels`} />
          )
        ) : null}
      </HStack>,
    );
  }
  if (props.cycle && bundle.project.cycles_enabled) {
    nodes.push(<CycleControl key="cycle" armKey="cycle" compact readOnly={readOnly} value={item.cycle_id} onChange={(cycle_id) => onUpdate(item.id, { cycle_id })} />);
  }
  if (props.modules && bundle.project.modules_enabled && item.module_ids.length > 0) {
    nodes.push(
      <HStack key="modules" gap={2} vAlign="center" wrap="wrap" className="tessera-wi-chips">
        {item.module_ids.map((id) => {
          const mod = modulesById.get(id);
          return mod ? <Token key={id} label={mod.name} size="sm" /> : null;
        })}
      </HStack>,
    );
  }
  if (props.assignees && item.assignee_ids.length > 0) {
    nodes.push(
      <HStack key="assignees" gap={0.5} vAlign="center" className="tessera-wi-assignees">
        {item.assignee_ids.map((id) => {
          const actor = actorsById.get(id);
          return actor ? <ActorAvatar key={id} actor={actor} size="xsm" /> : null;
        })}
      </HStack>,
    );
  }
  if (props.start_date) {
    nodes.push(
      <DateControl
        key="start"
        armKey="start"
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
        armKey="target"
        compact
        readOnly={readOnly}
        label="Target date"
        value={item.target_date}
        min={item.start_date}
        isOverdue={isOverdue(item.target_date, bundle.today, statesById.get(item.state_id)?.state_group)}
        onChange={(target_date) => onUpdate(item.id, { target_date })}
      />,
    );
  }
  if (props.sub_items_count && item.sub_items_count > 0) {
    nodes.push(<Badge key="sub" label={`${item.sub_items_count} sub-items`} className="tessera-wi-count" />);
  }
  if (props.links && item.links_count > 0) {
    nodes.push(<Badge key="links" label={`${item.links_count} links`} className="tessera-wi-count" />);
  }
  if (props.estimate && item.estimate_point_id && bundle.estimate) {
    const point = bundle.estimate.points.find((entry) => entry.id === item.estimate_point_id);
    if (point) nodes.push(<Token key="estimate" label={formatEstimateValue(bundle.estimate.type, point.value)} size="sm" />);
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
    <HStack gap={2} vAlign="center" hAlign="end" wrap="wrap" className="tessera-wi-props">
      {nodes}
    </HStack>
  );
}

/**
 * The row title: one line with an ellipsis, and the full title in a tooltip when it is cut. The ellipsis is CSS
 * (`tessera-wi-title` in work-items.css) and `OneLineText` measures the title only on hover: Astryx 0.6.8 Text
 * measures every Text it truncates on mount, a forced layout per row. The class also lets work-items.css give
 * Astryx's label slot a minimum width, so the properties wrap below the title instead of squeezing it (narrow
 * windows, the peek panel open).
 */
function RowTitle({ name }: { name: string }) {
  return (
    <OneLineText className="tessera-wi-title" weight="medium">
      {name}
    </OneLineText>
  );
}

/**
 * The row a quick-add shows until the server item arrives: inert, and it fades in. It is the only row that animates:
 * the real rows mount on scroll, on "Show more" and on the agent refresh, which must stay still. `useEntryAnimation`
 * is Astryx's own (docs/contracts/ui.md "Motion"): null on first paint and while hydrating, off under Reduce Motion.
 */
export function PendingRow({ item, display, onUpdate }: Pick<RowProps, "item" | "display" | "onUpdate">) {
  const entry = useEntryAnimation("fadeIn");
  return (
    <ListItem
      label={<RowTitle name={item.name} />}
      className="tessera-wi-row tessera-wi-row-pending"
      xstyle={entry ?? undefined}
      startContent={
        <Text type="supporting" color="secondary" className="tessera-wi-pending-key">
          Saving…
        </Text>
      }
      endContent={
        <RowProject projectId={item.project_id}>
          <RowProperties item={item} display={display} onUpdate={onUpdate} readOnly />
        </RowProject>
      }
    />
  );
}

/**
 * Memoized (decision 141): a row redraws only when its own item, the display, its tick or the read-only flag changed
 * (the handlers keep one identity, WorkItemsScreen and use-selection.ts). Everything else it reads comes through
 * `useProjectRow()`, which does not change on a write that leaves the row alone.
 */
const WorkItemRow = memo(function WorkItemRow({ item, display, onUpdate, onOpen, readOnly = false, selected, onToggle }: RowProps) {
  // The key button owns the row's action: surface clicks delegate to it and it is the row's only tab stop.
  const openRef = useRef<HTMLButtonElement>(null);
  // The row draws its property controls as chips until the pointer or keyboard focus reaches it (./properties/arming.tsx):
  // the closed selectors and popovers of a long list cost more than the rows themselves.
  const { state: arming, handlers } = useRowArming();
  // Placeholder from quick-add: nothing to open or edit until the server item arrives.
  if (isOptimisticId(item.id)) return <PendingRow item={item} display={display} onUpdate={onUpdate} />;
  return (
    <ListItem
      label={<RowTitle name={item.name} />}
      className="tessera-wi-row"
      data-selected={selected ? "" : undefined}
      data-item-id={item.id}
      interactiveRef={openRef}
      onPointerEnter={handlers.onPointerEnter}
      onPointerMove={handlers.onPointerMove}
      onFocus={handlers.onFocus}
      startContent={
        <HStack gap={1} vAlign="center">
          {selected !== undefined && onToggle ? (
            <CheckboxInput
              className="tessera-wi-select"
              size="sm"
              isLabelHidden
              label={`Select ${item.key}`}
              value={selected}
              onChange={(_checked, event) => onToggle(item.id, "shiftKey" in event.nativeEvent && event.nativeEvent.shiftKey === true)}
            />
          ) : null}
          <Button
            ref={openRef}
            className="tessera-wi-open"
            data-focus-key="open"
            variant="ghost"
            size="sm"
            label={item.key}
            tooltip={arming.armed && !display.properties.key ? item.key : undefined}
            onClick={() => onOpen(item.id)}
          />
        </HStack>
      }
      endContent={
        <RowProject projectId={item.project_id}>
          <ArmedContext value={arming}>
            <RowProperties item={item} display={display} onUpdate={onUpdate} readOnly={readOnly} />
          </ArmedContext>
        </RowProject>
      }
    />
  );
});

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
  onQuickAdd: LayoutProps["onQuickAdd"];
  canQuickAdd: LayoutProps["canQuickAdd"];
  readOnly: boolean;
  selection?: LayoutProps["selection"];
  /** "Show more" for a group with unloaded rows (decision 112); absent when everything is loaded. */
  more?: { loaded: number; total: number; isLoading: boolean; onLoadMore: () => void };
  /** The scroller's `useAnimatedLayout` handle: a group opening or closing glides and the groups below follow. */
  animatedLayout?: AnimatedLayout;
};

function GroupSection({
  group,
  items,
  display,
  isOpen,
  onToggle,
  onUpdate,
  onOpen,
  onQuickAdd,
  canQuickAdd,
  readOnly,
  selection,
  more,
  animatedLayout,
}: GroupSectionProps) {
  const quickAddGroup: QuickAddGroup = group ? { field: group.field, value: group.id === NONE_GROUP_ID ? null : group.id } : { field: null, value: null };
  // No row when the list cannot create items, or when this group pins a state the scope refuses (a closed state in a cycle).
  const showQuickAdd = !readOnly && onQuickAdd !== undefined && canQuickAdd?.(quickAddGroup) !== false;
  const body = (
    <VStack gap={0}>
      {items.length > 0 ? (
        <List density="compact" hasDividers>
          {items.map((item) => (
            <WorkItemRow
              key={item.id}
              item={item}
              display={display}
              onUpdate={onUpdate}
              onOpen={onOpen}
              readOnly={readOnly}
              selected={selection ? selection.selected.has(item.id) : undefined}
              onToggle={selection?.onToggle}
            />
          ))}
        </List>
      ) : null}
      {more ? <GroupFooter variant="list" display={display} loaded={more.loaded} total={more.total} isLoading={more.isLoading} onLoadMore={more.onLoadMore} /> : null}
      {showQuickAdd ? <QuickAdd onSubmit={(name) => onQuickAdd(quickAddGroup, name)} /> : null}
    </VStack>
  );
  if (!group) return body;
  return (
    <VStack gap={0} className="tessera-wi-group">
      <Collapsible
        trigger={<GroupHeader group={group} display={display} selection={selection} ids={items.filter((item) => !isOptimisticId(item.id)).map((item) => item.id)} />}
        isOpen={isOpen}
        onOpenChange={onToggle}
        chevronPosition="start"
        animatedLayout={animatedLayout}
      >
        {body}
      </Collapsible>
    </VStack>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function ListLayout({
  result,
  display,
  onUpdate,
  onOpen,
  onQuickAdd,
  canQuickAdd,
  readOnly = false,
  selection,
  onLoadMore,
  onLoadMoreUngrouped,
  isLoadingMore,
  onClearFilters,
  animatedLayout,
}: LayoutProps & {
  /** From WorkItemsScreen, bound to the element that scrolls the list; the groups pass it to their Collapsible. */
  animatedLayout?: AnimatedLayout;
}) {
  const itemsById = useMemo(() => new Map(result.items.map((item) => [item.id, item])), [result.items]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const { listRef, handleKeyDown: moveBetweenRows, handleFocus } = useListFocus<HTMLElement>({
    itemSelector: ".tessera-wi-open",
    orientation: "vertical",
    wrap: false,
    hasRovingTabIndex: true,
    hasCaretGuard: true,
  });
  // The arrow, Home and End keys of a control inside a row bubble up to this list: a selector (open or closed) and a
  // calendar grid take them with `preventDefault`, and a key typed in an open layer (the date popover renders inline,
  // as a native popover) belongs to that layer. Only a key nothing took moves between the rows.
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.defaultPrevented || (event.target instanceof Element && event.target.closest("[popover]") !== null)) return;
      moveBetweenRows(event);
    },
    [moveBetweenRows],
  );

  const groups = visibleGroups(result, display);

  const toggle = (id: string, isOpen: boolean) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (isOpen) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const hasNoItems = result.items.length === 0;
  const isEmpty = hasNoItems && (groups === null || groups.length === 0);
  const hasNoMatches = nothingMatches(result, groups, onClearFilters !== undefined);

  return (
    <VStack
      ref={listRef}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      gap={groups ? 2 : 0}
      className={selection && selection.selected.size > 0 ? "tessera-wi-list tessera-wi-list--selecting" : "tessera-wi-list"}
      paddingBlock={2}
      data-list-ready=""
    >
      {hasNoMatches && onClearFilters ? <NoResults onClear={onClearFilters} /> : null}
      {isEmpty && !onClearFilters ? (
        <EmptyState
          isCompact
          className="tessera-wi-empty"
          title="No work items yet"
          description={onQuickAdd && !readOnly ? "Create the first one with the button above, press c, or use the quick-add row." : "New work items cannot be added to this list."}
        />
      ) : null}
      {groups ? (
        (hasNoMatches ? [] : groups).map((group) => (
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
            canQuickAdd={canQuickAdd}
            readOnly={readOnly}
            selection={selection}
            animatedLayout={animatedLayout}
            more={
              group.has_more && onLoadMore
                ? { loaded: group.item_ids.length, total: group.count, isLoading: isLoadingMore?.(groupLimitKey(group.id)) ?? false, onLoadMore: () => onLoadMore(group.id) }
                : undefined
            }
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
          canQuickAdd={canQuickAdd}
          readOnly={readOnly}
          selection={selection}
          more={
            result.has_more && onLoadMoreUngrouped
              ? { loaded: result.items.length, total: result.total, isLoading: isLoadingMore?.(UNGROUPED_KEY) ?? false, onLoadMore: onLoadMoreUngrouped }
              : undefined
          }
        />
      )}
    </VStack>
  );
}
