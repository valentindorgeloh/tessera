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
import { memo, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { useEntryAnimation, useListFocus, type AnimatedLayout } from "@astryxdesign/core/hooks";
import { ListItem } from "@astryxdesign/core/List";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { formatEstimateValue } from "@/components/estimates/estimate-format";
import { ActorAvatar } from "@/components/shell/ActorAvatar";
import { useEdgeKeys } from "@/components/virtual/home-end";
import { VIRTUAL_LIST_MIN } from "@/components/virtual/virtual-config";
import { estimateStarts, shouldVirtualize } from "@/components/virtual/virtual-math";
import { groupLimitKey } from "@/lib/tessera/core/group";
import type { Display, Group, WorkItem } from "@/lib/tessera/types";
import { visibleGroups, nothingMatches } from "./list-groups";
import { isOptimisticId } from "./optimistic";
import { useProjectRow } from "./project-provider";
import { RowProject } from "./row-project";
import { CycleControl, DateControl, PriorityControl, StateControl, paletteTokenColor } from "./properties";
import { ArmedContext, useArmed, useRowArming } from "./properties/arming";
import { isOverdue } from "./properties/date-format";
import { splitShownNames } from "./properties/membership-rules";
import { GroupFooter } from "./GroupFooter";
import { GroupHeader, NONE_GROUP_ID } from "./ListGroupHeader";
import { ListGroupRows, virtualRowProps, type WindowRowProps } from "./ListGroupRows";
import { UNGROUPED_KEY } from "./paging";
import { NoResults } from "./NoResults";
import { OneLineText } from "./OneLineText";
import { QuickAdd } from "./QuickAdd";
import type { LayoutProps, QuickAddGroup, UpdateWorkItemPatch } from "./types";

/** Day part of an ISO timestamp or date, for the created/updated columns. */
function dayOf(value: string | null): string {
  return value ? value.slice(0, 10) : "";
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export type RowProps = {
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

/** A row plus its window props (ListGroupRows, decisions 135 and 137). */
export type WorkItemRowProps = RowProps & WindowRowProps;

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
 * In a windowed list it carries the same window props as a real row (ListGroupRows).
 */
export function PendingRow({ item, display, onUpdate, windowed = {} }: Pick<RowProps, "item" | "display" | "onUpdate"> & { windowed?: WindowRowProps }) {
  const entry = useEntryAnimation("fadeIn");
  return (
    <ListItem
      label={<RowTitle name={item.name} />}
      {...virtualRowProps("tessera-wi-row tessera-wi-row-pending", windowed)}
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
export const WorkItemRow = memo(function WorkItemRow({ item, display, onUpdate, onOpen, readOnly = false, selected, onToggle, ...windowed }: WorkItemRowProps) {
  // The key button owns the row's action: surface clicks delegate to it and it is the row's only tab stop.
  const openRef = useRef<HTMLButtonElement>(null);
  // The row draws its property controls as chips until the pointer or keyboard focus reaches it (./properties/arming.tsx):
  // the closed selectors and popovers of a long list cost more than the rows themselves.
  const { state: arming, handlers } = useRowArming();
  // Placeholder from quick-add: nothing to open or edit until the server item arrives.
  if (isOptimisticId(item.id)) return <PendingRow item={item} display={display} onUpdate={onUpdate} windowed={windowed} />;
  return (
    <ListItem
      label={<RowTitle name={item.name} />}
      {...virtualRowProps("tessera-wi-row", windowed)}
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
  /** The list's window (ListGroupRows): threshold result, estimated row start, aria-setsize. */
  isVirtual: boolean;
  estimateStart: number;
  setSize: number;
  /** The scroller's `useAnimatedLayout` handle: a group opening or closing glides and the groups below follow. */
  animatedLayout?: AnimatedLayout;
};

function quickAddGroupOf(group: Group | null): QuickAddGroup {
  return group ? { field: group.field, value: group.id === NONE_GROUP_ID ? null : group.id } : { field: null, value: null };
}

/** No row when the list cannot create items, or when this group pins a state the scope refuses (a closed state in a cycle). */
function showsQuickAdd(group: Group | null, readOnly: boolean, onQuickAdd: LayoutProps["onQuickAdd"], canQuickAdd: LayoutProps["canQuickAdd"]): boolean {
  return !readOnly && onQuickAdd !== undefined && canQuickAdd?.(quickAddGroupOf(group)) !== false;
}

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
  isVirtual,
  estimateStart,
  setSize,
  animatedLayout,
}: GroupSectionProps) {
  const quickAddGroup = quickAddGroupOf(group);
  const showQuickAdd = showsQuickAdd(group, readOnly, onQuickAdd, canQuickAdd);
  const body = (
    <VStack gap={0}>
      <ListGroupRows
        anchorId={`list:${group ? group.id : "flat"}`}
        items={items}
        setSize={setSize}
        isVirtual={isVirtual}
        isOpen={isOpen}
        estimateStart={estimateStart}
        row={{ display, onUpdate, onOpen, readOnly, selection }}
        Row={WorkItemRow}
        glidesOnClose={animatedLayout !== undefined}
      />
      {more ? <GroupFooter variant="list" display={display} loaded={more.loaded} total={more.total} isLoading={more.isLoading} onLoadMore={more.onLoadMore} /> : null}
      {showQuickAdd && onQuickAdd ? <QuickAdd onSubmit={(name) => onQuickAdd(quickAddGroup, name)} /> : null}
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
  /**
   * From WorkItemsScreen, bound to the element that scrolls the list; the groups pass it to their Collapsible while the
   * list is not windowed. A windowed list has no glide (docs/contracts/ui.md "Motion"): a closing group's held rows
   * cannot fill the window, so the groups below showed a blank scroller for a few frames.
   */
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

  const groups = useMemo(() => visibleGroups(result, display), [result, display]);
  // One items array per group, kept while the result is: ListGroupRows keys its window on it (decision 136).
  const groupItems = useMemo(
    () => (groups ?? []).map((group) => group.item_ids.flatMap((id) => (itemsById.has(id) ? [itemsById.get(id) as WorkItem] : []))),
    [groups, itemsById],
  );

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
  const shownGroups = groups && !hasNoMatches ? groups : null;

  // Decision 135: window every group once the list holds more than VIRTUAL_LIST_MIN loaded rows across all groups.
  const isVirtual = shouldVirtualize(shownGroups ? groupItems.reduce((sum, items) => sum + items.length, 0) : result.items.length, VIRTUAL_LIST_MIN);
  const starts = estimateStarts(
    shownGroups
      ? shownGroups.map((group, i) => {
          const isOpen = !collapsed.has(group.id);
          const hasFooter = isOpen && group.has_more && onLoadMore !== undefined;
          return { rows: groupItems[i].length, isOpen, hasBand: true, hasFooter, hasQuickAdd: isOpen && showsQuickAdd(group, readOnly, onQuickAdd, canQuickAdd) };
        })
      : [{ rows: result.items.length, isOpen: true, hasBand: false, hasFooter: false, hasQuickAdd: false }],
    "list",
  );
  // Home/End in a virtual list scroll the scroller and focus the first or last loaded row once it is mounted and still.
  const edgeKeys = useEdgeKeys({
    isVirtual,
    focusSelector: ".tessera-wi-open",
    lastCount: () => (shownGroups ? (groupItems.filter((items, i) => items.length > 0 && !collapsed.has(shownGroups[i].id)).at(-1)?.length ?? 0) : result.items.length),
    onOtherKey: moveBetweenRows,
  });
  // The arrow, Home and End keys of a control inside a row bubble up to this list: a selector (open or closed) and a
  // calendar grid take them with `preventDefault`, and a key typed in an open layer (the date popover renders inline,
  // as a native popover) belongs to that layer. Only a key nothing took moves between the rows or to the list's edge.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || (event.target instanceof Element && event.target.closest("[popover]") !== null)) return;
    edgeKeys(event);
  };

  return (
    <VStack
      ref={listRef}
      onKeyDown={onKeyDown}
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
        (shownGroups ?? []).map((group, i) => (
          <GroupSection
            key={`${group.field}:${group.id}`}
            group={group}
            items={groupItems[i]}
            isVirtual={isVirtual}
            estimateStart={starts[i]}
            setSize={Math.max(group.count, groupItems[i].length)}
            display={display}
            isOpen={!collapsed.has(group.id)}
            onToggle={(isOpen) => toggle(group.id, isOpen)}
            onUpdate={onUpdate}
            onOpen={onOpen}
            onQuickAdd={onQuickAdd}
            canQuickAdd={canQuickAdd}
            readOnly={readOnly}
            selection={selection}
            animatedLayout={isVirtual ? undefined : animatedLayout}
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
          isVirtual={isVirtual}
          estimateStart={starts[0]}
          setSize={Math.max(result.total, result.items.length)}
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
