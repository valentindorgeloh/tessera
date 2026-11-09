"use client";

/**
 * One row per work item. A bar runs from start_date to target_date inclusive.
 * One date is a one-day bar with the missing end drawn dashed. Dragging the
 * bar writes both dates in one update; dragging an edge writes only that end,
 * clamped so the start never passes the target. Zoom and dependency
 * connectors follow decisions 90–92. The body (today line, connectors, rows)
 * is GanttRows.tsx, windowed above `VIRTUAL_GANTT_MIN` rows.
 */
import { useCallback, useId, useRef, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { useHotkeys } from "@astryxdesign/core/hooks";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useTimelineDrag } from "@/components/dnd/use-timeline-drag";
import { VIRTUAL_GANTT_MIN } from "@/components/virtual/virtual-config";
import { shouldVirtualize } from "@/components/virtual/virtual-math";
import { useWeekStart } from "@/components/workspace-settings/workspace-settings-store";
import { daysBetween } from "@/lib/tessera/core/time";
import type { WorkItem } from "@/lib/tessera/types";
import { CalendarDotsIcon } from "@/themes/catppuccin/icons";
import { isWeekend, monthLabel, weekBandLabel, weekendShift } from "./calendar-math";
import { applyDayDelta, barSpan, eachDay, previewEnds, scheduleOnDay, timelineRange, type DateEnds } from "./date-span";
import { useGanttMetrics } from "./gantt-metrics";
import { conflictNotes, connectorPaths, ganttEdges, monthSpans, weekSpans } from "./gantt-scale";
import { useTodayScroll } from "./gantt-scroll";
import { GanttRows } from "./GanttRows";
import { GroupFooter } from "./GroupFooter";
import { isOptimisticId } from "./optimistic";
import { OneLineText } from "./OneLineText";
import { UNGROUPED_KEY } from "./paging";
import { useProject } from "./project-provider";
import { useStableCallback } from "./stable";
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

  // Stable, so the memo rows (GanttRows.tsx) do not re-render when the range or the items change.
  const schedule = useStableCallback((item: WorkItem, event: ReactMouseEvent<HTMLElement>) => {
    if (readOnly || isOptimisticId(item.id) || barSpan(item)) return;
    const width = dayWidth();
    if (width <= 0) return;
    const offset = Math.floor((event.clientX - event.currentTarget.getBoundingClientRect().left) / width);
    if (offset < 0 || offset >= days.length) return;
    onUpdate(item.id, scheduleOnDay(days[offset]));
  });

  const byId = new Map<string, DateEnds>();
  for (const item of result.items) {
    const ends: DateEnds = preview?.id === item.id && preview.delta !== 0 ? previewEnds(item, preview.mode, preview.delta) : item;
    byId.set(item.id, ends);
  }
  const rowIndex = new Map(result.items.map((item, index) => [item.id, index]));
  const edges = showRelations ? ganttEdges(result.relations) : [];
  const isVirtual = shouldVirtualize(result.items.length, VIRTUAL_GANTT_MIN);
  // The connector layer is drawn in CSS pixels: its day column, row height and bar inset are measured (gantt-metrics.ts).
  // The window uses the same row height (GanttRows.tsx), so the metrics are also measured whenever it is on.
  const metrics = useGanttMetrics(rootRef, (edges.length > 0 || isVirtual) && result.items.length > 0);
  const markerId = useId().replace(/:/g, "");
  const paths = edges.length === 0 ? [] : connectorPaths(edges, rowIndex, byId, range.start, days.length, metrics ?? undefined);
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
        "--tessera-gantt-rows": result.items.length,
        "--tessera-gantt-today": todayOffset,
        "--tessera-gantt-weekend-shift": weekendShift(range.start),
      })}
    >
      <HStack gap={2} vAlign="center" padding={4} className="tessera-gantt-tools">
        <Button label="Today" size="sm" variant="ghost" icon={<CalendarDotsIcon />} onClick={scrollToday} />
      </HStack>
      <HStack gap={0} vAlign="end" className="tessera-gantt-head">
        <HStack className="tessera-gantt-label" vAlign="center" paddingInline={4}>
          <Text type="supporting">Work item</Text>
        </HStack>
        <VStack gap={0} className="tessera-gantt-scale">
          <HStack gap={0}>
            {topSpans.map((span) => (
              <HStack key={span.key} className="tessera-gantt-month" style={cssVars({ width: `calc(${span.span} * var(--tessera-gantt-day))` })}>
                <OneLineText type="supporting" className="tessera-gantt-month-label">
                  {span.label}
                </OneLineText>
              </HStack>
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
      <GanttRows
        items={result.items}
        endsById={byId}
        rowIndex={rowIndex}
        rangeStart={range.start}
        dayCount={days.length}
        readOnly={readOnly}
        notes={notes}
        paths={paths}
        metrics={metrics}
        markerId={markerId}
        isVirtual={isVirtual}
        draggedId={preview?.id ?? null}
        onOpen={onOpen}
        onUpdate={onUpdate}
        onSchedule={schedule}
        onPointerDown={onPointerDown}
        onClickCapture={onClickCapture}
      />
      {result.has_more && onLoadMoreUngrouped ? (
        <GroupFooter display={display} loaded={result.items.length} total={result.total} isLoading={isLoadingMore?.(UNGROUPED_KEY)} onLoadMore={onLoadMoreUngrouped} />
      ) : null}
    </VStack>
  );
}
