"use client";

/**
 * One row per work item. A bar runs from start_date to target_date inclusive.
 * One date is a one-day bar with the missing end drawn dashed. Dragging the
 * bar writes both dates in one update; dragging an edge writes only that end,
 * clamped so the start never passes the target. Zoom and dependency
 * connectors follow decisions 90–92.
 */
import { useCallback, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { useHotkeys } from "@astryxdesign/core/hooks";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Popover } from "@astryxdesign/core/Popover";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { useTimelineDrag } from "@/components/dnd/use-timeline-drag";
import { useWeekStart } from "@/components/workspace-settings/workspace-settings-store";
import { daysBetween } from "@/lib/tessera/core/time";
import type { WorkItem } from "@/lib/tessera/types";
import { CalendarDotsIcon, CalendarIcon } from "@/themes/catppuccin/icons";
import { isWeekend, monthLabel, weekBandLabel, weekendShift } from "./calendar-math";
import { applyDayDelta, barPlacement, barSpan, eachDay, previewEnds, scheduleOnDay, timelineRange, type BarDragMode, type DateEnds } from "./date-span";
import { conflictNotes, connectorPaths, ganttEdges, monthSpans, weekSpans } from "./gantt-scale";
import { useTodayScroll } from "./gantt-scroll";
import { GroupFooter } from "./GroupFooter";
import { isOptimisticId } from "./optimistic";
import { UNGROUPED_KEY } from "./paging";
import { DateControl } from "./properties/DateControl";
import { stateGroupLabel, stateGroupVariant } from "./properties/StateControl";
import { useProject } from "./project-provider";
import { useBundles } from "./row-project";
import type { LayoutProps } from "./types";

function cssVars(vars: Record<string, string | number>): CSSProperties {
  return vars as CSSProperties;
}

export function GanttLayout({ result, display, onUpdate, onOpen, readOnly = false, onLoadMoreUngrouped, isLoadingMore }: LayoutProps) {
  const { bundle } = useProject();
  const today = bundle.today;
  const weekStartsOn = useWeekStart(bundle.week_start);
  const zoom = display.gantt.zoom;
  const showRelations = display.gantt.show_relations;
  const range = timelineRange(
    result.date_range?.start || result.date_range?.end
      ? [result.date_range.start, result.date_range.end]
      : result.items.flatMap((item) => [item.start_date, item.target_date]),
    today,
  );
  const days = eachDay(range.start, range.end);
  const todayOffset = daysBetween(range.start, today);
  const dayRef = useRef<HTMLElement | null>(null);
  const dayWidth = useCallback(() => dayRef.current?.getBoundingClientRect().width ?? 0, []);

  const { preview, onPointerDown, onClickCapture } = useTimelineDrag({
    dayWidth,
    enabled: !readOnly,
    onCommit: (id, mode, delta) => {
      const item = result.items.find((candidate) => candidate.id === id);
      if (!item || isOptimisticId(item.id)) return;
      const patch = applyDayDelta(item, mode, delta);
      if (patch) onUpdate(id, patch);
    },
  });

  // The today line (not the sticky head cell) is what scrolls into the middle of the bar area, in every zoom.
  const { rootRef, scrollToday } = useTodayScroll(zoom, result.items.length > 0);
  useHotkeys([{ keys: "t", onPress: scrollToday }]);

  const schedule = (item: WorkItem, event: ReactMouseEvent<HTMLElement>) => {
    if (readOnly || isOptimisticId(item.id) || barSpan(item)) return;
    const width = dayWidth();
    if (width <= 0) return;
    const offset = Math.floor((event.clientX - event.currentTarget.getBoundingClientRect().left) / width);
    if (offset < 0 || offset >= days.length) return;
    onUpdate(item.id, scheduleOnDay(days[offset]));
  };

  const byId = new Map<string, DateEnds>();
  for (const item of result.items) {
    const ends: DateEnds = preview?.id === item.id && preview.delta !== 0 ? previewEnds(item, preview.mode, preview.delta) : item;
    byId.set(item.id, ends);
  }
  const rowIndex = new Map(result.items.map((item, index) => [item.id, index]));
  const edges = showRelations ? ganttEdges(result.relations) : [];
  const paths = edges.length === 0 ? [] : connectorPaths(edges, rowIndex, byId, range.start, days.length);
  const notes = conflictNotes(paths, byId, new Map(result.items.map((item) => [item.id, item.key])));
  const topSpans = zoom === "month" ? weekSpans(days, weekStartsOn, weekBandLabel) : monthSpans(days, monthLabel);

  if (result.items.length === 0) {
    return <EmptyState isCompact title="No work items yet" description="Items with a start or target date show a bar here." />;
  }

  return (
    <VStack
      ref={rootRef}
      gap={0}
      className="tessera-gantt"
      data-zoom={zoom}
      style={cssVars({
        "--tessera-gantt-days": days.length,
        "--tessera-gantt-today": todayOffset,
        "--tessera-gantt-weekend-shift": weekendShift(range.start),
      })}
    >
      <HStack gap={2} vAlign="center" padding={2} className="tessera-gantt-tools">
        <Button label="Today" size="sm" variant="ghost" icon={<CalendarDotsIcon />} onClick={scrollToday} />
      </HStack>
      <HStack gap={0} vAlign="end" className="tessera-gantt-head">
        <HStack className="tessera-gantt-label" vAlign="center" paddingInline={2}>
          <Text type="supporting">Work item</Text>
        </HStack>
        <VStack gap={0} className="tessera-gantt-scale">
          <HStack gap={0}>
            {topSpans.map((span) => (
              <Text key={span.key} type="supporting" maxLines={1} className="tessera-gantt-month" style={cssVars({ width: `calc(${span.span} * var(--tessera-gantt-day))` })}>
                {span.label}
              </Text>
            ))}
          </HStack>
          <HStack gap={0} className="tessera-gantt-days" data-zoom-days={zoom}>
            {days.map((day, index) => (
              <Text
                key={day}
                ref={(element) => {
                  if (index === 0) dayRef.current = element;
                }}
                type="supporting"
                hasTabularNumbers
                weight={day === today ? "medium" : "normal"}
                className="tessera-gantt-head-day"
                data-weekend={isWeekend(day) ? "" : undefined}
                data-today={day === today ? "" : undefined}
                aria-hidden={zoom === "week" ? undefined : true}
              >
                {zoom === "week" ? Number(day.slice(8, 10)) : "\u00a0"}
              </Text>
            ))}
          </HStack>
        </VStack>
      </HStack>
      <VStack gap={0} className="tessera-gantt-body">
        <VStack className="tessera-gantt-today" aria-hidden />
        {paths.length > 0 ? (
          <svg className="tessera-gantt-connectors" viewBox={`0 0 ${days.length} ${result.items.length}`} preserveAspectRatio="none" aria-hidden>
            {paths.map((path) => (
              <path key={path.key} d={path.d} className="tessera-gantt-edge" data-conflict={path.conflict ? "" : undefined} />
            ))}
          </svg>
        ) : null}
        {result.items.map((item) => (
          <GanttRow
            key={item.id}
            item={item}
            ends={byId.get(item.id) ?? item}
            rangeStart={range.start}
            readOnly={readOnly}
            conflictText={notes.get(item.id)?.join("; ")}
            onOpen={onOpen}
            onUpdate={onUpdate}
            onSchedule={schedule}
            onPointerDown={onPointerDown}
            onClickCapture={onClickCapture}
          />
        ))}
      </VStack>
      {result.has_more && onLoadMoreUngrouped ? (
        <GroupFooter display={display} loaded={result.items.length} total={result.total} isLoading={isLoadingMore?.(UNGROUPED_KEY)} onLoadMore={onLoadMoreUngrouped} />
      ) : null}
    </VStack>
  );
}

function GanttRow({
  item,
  ends,
  rangeStart,
  readOnly,
  conflictText,
  onOpen,
  onUpdate,
  onSchedule,
  onPointerDown,
  onClickCapture,
}: {
  item: WorkItem;
  ends: DateEnds;
  rangeStart: string;
  readOnly: boolean;
  /** What this bar clashes with, naming the other items (decision 92); undefined when it has no conflict. */
  conflictText?: string;
  onOpen: LayoutProps["onOpen"];
  onUpdate: LayoutProps["onUpdate"];
  onSchedule: (item: WorkItem, event: ReactMouseEvent<HTMLElement>) => void;
  onPointerDown: (id: string, mode: BarDragMode, event: ReactPointerEvent<HTMLElement>) => void;
  onClickCapture: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
  const bundles = useBundles();
  const { statesById } = useProject();
  const state = bundles?.[item.project_id]?.states.find((entry) => entry.id === item.state_id) ?? statesById.get(item.state_id);
  const placement = barPlacement(ends, rangeStart);
  const canDrag = !readOnly && !isOptimisticId(item.id);
  const open = () => {
    if (!isOptimisticId(item.id)) onOpen(item.id);
  };
  const conflict = conflictText !== undefined;
  const barRef = useRef<HTMLElement | null>(null);
  const barLabel = placement
    ? `${item.key} ${item.name}, ${ends.start_date ?? "open"} to ${ends.target_date ?? "open"}${conflict ? ", date conflict" : ""}`
    : `${item.key} ${item.name}, no dates`;

  return (
    <HStack gap={0} vAlign="stretch" className="tessera-gantt-row">
      <HStack gap={1} vAlign="center" paddingInline={2} className="tessera-gantt-label">
        {state ? <StatusDot variant={stateGroupVariant(state.state_group)} label={stateGroupLabel(state.state_group)} /> : null}
        <HStack
          gap={1}
          vAlign="center"
          className="tessera-gantt-open"
          role="button"
          tabIndex={0}
          aria-label={`Open ${item.key}`}
          onClick={open}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              open();
            }
          }}
        >
          <Text type="supporting" hasTabularNumbers className="tessera-gantt-key">
            {item.key}
          </Text>
          <Text maxLines={1} className="tessera-gantt-name">
            {item.name}
          </Text>
        </HStack>
        {canDrag ? <GanttDates item={item} onUpdate={onUpdate} /> : null}
      </HStack>
      <HStack className="tessera-gantt-track" onClick={(event) => onSchedule(item, event)}>
        {placement ? (
          <>
            <HStack
              ref={barRef}
              role="button"
              tabIndex={0}
              className="tessera-gantt-bar"
              aria-label={barLabel}
              data-open-start={placement.openStart ? "" : undefined}
              data-open-end={placement.openEnd ? "" : undefined}
              data-conflict={conflict ? "" : undefined}
              data-readonly={canDrag ? undefined : ""}
              style={cssVars({ "--tessera-gantt-offset": placement.offset, "--tessera-gantt-span": placement.span })}
              onClick={(event) => {
                event.stopPropagation();
                open();
              }}
              onClickCapture={onClickCapture}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  open();
                }
              }}
              onPointerDown={canDrag ? (event) => onPointerDown(item.id, "move", event) : undefined}
            >
              <Text type="supporting" maxLines={1}>
                {item.key}
              </Text>
              {canDrag ? (
                <HStack
                  className="tessera-gantt-handle"
                  data-edge="start"
                  aria-hidden
                  onPointerDown={(event) => onPointerDown(item.id, "start", event)}
                  onClick={(event) => event.stopPropagation()}
                />
              ) : null}
              {canDrag ? (
                <HStack
                  className="tessera-gantt-handle"
                  data-edge="end"
                  aria-hidden
                  onPointerDown={(event) => onPointerDown(item.id, "end", event)}
                  onClick={(event) => event.stopPropagation()}
                />
              ) : null}
            </HStack>
            {conflictText ? (
              // Sibling mode: a conflict that appears mid-drag mounts the tooltip next to the bar instead of wrapping it, so the bar keeps its pointer capture.
              // Astryx puts the tooltip's id in the bar's aria-describedby, and the tooltip layer holds the same text while closed.
              <Tooltip anchorRef={barRef} content={conflictText} focusTrigger="always" touchTrigger="none" placement="above" />
            ) : null}
          </>
        ) : null}
      </HStack>
    </HStack>
  );
}

function GanttDates({ item, onUpdate }: { item: WorkItem; onUpdate: LayoutProps["onUpdate"] }) {
  const [isOpen, setOpen] = useState(false);
  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={setOpen}
      label={`Set dates for ${item.key}`}
      placement="below"
      alignment="end"
      hasAutoFocus
      content={
        <VStack gap={2} padding={3} className="tessera-gantt-dates">
          <DateControl label="Start date" value={item.start_date} max={item.target_date} onChange={(start_date) => onUpdate(item.id, { start_date })} />
          <DateControl label="Target date" value={item.target_date} min={item.start_date} onChange={(target_date) => onUpdate(item.id, { target_date })} />
          <Button
            variant="ghost"
            size="sm"
            label="Clear dates"
            onClick={() => {
              onUpdate(item.id, { start_date: null, target_date: null });
              setOpen(false);
            }}
          />
        </VStack>
      }
    >
      <IconButton label={`Set dates for ${item.key}`} size="sm" variant="ghost" icon={<CalendarIcon />} />
    </Popover>
  );
}
