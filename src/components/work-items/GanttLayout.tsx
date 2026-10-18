"use client";

/**
 * One row per work item. A bar runs from start_date to target_date inclusive.
 * One date is a one-day bar with the missing end drawn dashed. Dragging the
 * bar writes both dates in one update; dragging an edge writes only that end,
 * clamped so the start never passes the target.
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
import { useTimelineDrag } from "@/components/dnd/use-timeline-drag";
import { daysBetween } from "@/lib/tessera/core/time";
import type { WorkItem } from "@/lib/tessera/types";
import { CalendarDotsIcon, CalendarIcon } from "@/themes/catppuccin/icons";
import { isWeekend, monthLabel, weekendShift } from "./calendar-math";
import { applyDayDelta, barPlacement, barSpan, eachDay, previewEnds, scheduleOnDay, timelineRange, type BarDragMode, type DateEnds } from "./date-span";
import { isOptimisticId } from "./optimistic";
import { DateControl } from "./properties/DateControl";
import { stateGroupLabel, stateGroupVariant } from "./properties/StateControl";
import { useProject } from "./project-provider";
import { useBundles } from "./row-project";
import type { LayoutProps } from "./types";

function cssVars(vars: Record<string, string | number>): CSSProperties {
  return vars as CSSProperties;
}

function monthSpans(days: readonly string[]): { key: string; label: string; span: number }[] {
  const spans: { key: string; label: string; span: number }[] = [];
  for (const day of days) {
    const key = day.slice(0, 7);
    const last = spans[spans.length - 1];
    if (last && last.key === key) last.span += 1;
    else spans.push({ key, label: monthLabel(day), span: 1 });
  }
  return spans;
}

export function GanttLayout({ result, onUpdate, onOpen, readOnly = false }: LayoutProps) {
  const { bundle } = useProject();
  const today = bundle.today;
  const range = timelineRange(
    result.items.flatMap((item) => [item.start_date, item.target_date]),
    today,
  );
  const days = eachDay(range.start, range.end);
  const todayOffset = daysBetween(range.start, today);
  const dayRef = useRef<HTMLElement | null>(null);
  const todayRef = useRef<HTMLElement | null>(null);
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

  const scrollToday = () => todayRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  useHotkeys([{ keys: "t", onPress: scrollToday }]);

  const schedule = (item: WorkItem, event: ReactMouseEvent<HTMLElement>) => {
    if (readOnly || isOptimisticId(item.id) || barSpan(item)) return;
    const width = dayWidth();
    if (width <= 0) return;
    const offset = Math.floor((event.clientX - event.currentTarget.getBoundingClientRect().left) / width);
    if (offset < 0 || offset >= days.length) return;
    onUpdate(item.id, scheduleOnDay(days[offset]));
  };

  if (result.items.length === 0) {
    return <EmptyState isCompact title="No work items yet" description="Items with a start or target date show a bar here." />;
  }

  return (
    <VStack
      gap={0}
      className="tessera-gantt"
      style={cssVars({
        "--tessera-gantt-days": days.length,
        "--tessera-gantt-today": todayOffset,
        "--tessera-gantt-weekend-shift": weekendShift(range.start),
      })}
    >
      <HStack gap={2} vAlign="center" padding={2}>
        <Button label="Today" size="sm" variant="ghost" icon={<CalendarDotsIcon />} onClick={scrollToday} />
      </HStack>
      <HStack gap={0} vAlign="end" className="tessera-gantt-head">
        <HStack className="tessera-gantt-label" vAlign="center" paddingInline={2}>
          <Text type="supporting">Work item</Text>
        </HStack>
        <VStack gap={0} className="tessera-gantt-scale">
          <HStack gap={0}>
            {monthSpans(days).map((span) => (
              <Text key={span.key} type="supporting" maxLines={1} className="tessera-gantt-month" style={cssVars({ width: `calc(${span.span} * var(--tessera-gantt-day))` })}>
                {span.label}
              </Text>
            ))}
          </HStack>
          <HStack gap={0}>
            {days.map((day, index) => (
              <Text
                key={day}
                ref={(element) => {
                  if (index === 0) dayRef.current = element;
                  if (day === today) todayRef.current = element;
                }}
                type="supporting"
                hasTabularNumbers
                weight={day === today ? "medium" : "normal"}
                className="tessera-gantt-head-day"
                data-weekend={isWeekend(day) ? "" : undefined}
                data-today={day === today ? "" : undefined}
              >
                {Number(day.slice(8, 10))}
              </Text>
            ))}
          </HStack>
        </VStack>
      </HStack>
      <VStack gap={0} className="tessera-gantt-body">
      <VStack className="tessera-gantt-today" aria-hidden />
      {result.items.map((item) => (
        <GanttRow
          key={item.id}
          item={item}
          rangeStart={range.start}
          readOnly={readOnly}
          preview={preview?.id === item.id ? preview : null}
          onOpen={onOpen}
          onUpdate={onUpdate}
          onSchedule={schedule}
          onPointerDown={onPointerDown}
          onClickCapture={onClickCapture}
        />
      ))}
      </VStack>
    </VStack>
  );
}

function GanttRow({
  item,
  rangeStart,
  readOnly,
  preview,
  onOpen,
  onUpdate,
  onSchedule,
  onPointerDown,
  onClickCapture,
}: {
  item: WorkItem;
  rangeStart: string;
  readOnly: boolean;
  preview: { mode: BarDragMode; delta: number } | null;
  onOpen: LayoutProps["onOpen"];
  onUpdate: LayoutProps["onUpdate"];
  onSchedule: (item: WorkItem, event: ReactMouseEvent<HTMLElement>) => void;
  onPointerDown: (id: string, mode: BarDragMode, event: ReactPointerEvent<HTMLElement>) => void;
  onClickCapture: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
  const bundles = useBundles();
  const { statesById } = useProject();
  const state = bundles?.[item.project_id]?.states.find((entry) => entry.id === item.state_id) ?? statesById.get(item.state_id);
  const ends: DateEnds = preview && preview.delta !== 0 ? previewEnds(item, preview.mode, preview.delta) : item;
  const placement = barPlacement(ends, rangeStart);
  const canDrag = !readOnly && !isOptimisticId(item.id);
  const open = () => {
    if (!isOptimisticId(item.id)) onOpen(item.id);
  };
  const barLabel = placement
    ? `${item.key} ${item.name}, ${ends.start_date ?? "open"} to ${ends.target_date ?? "open"}`
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
          <Text type="supporting" hasTabularNumbers>
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
          <HStack
            role="button"
            tabIndex={0}
            className="tessera-gantt-bar"
            aria-label={barLabel}
            data-open-start={placement.openStart ? "" : undefined}
            data-open-end={placement.openEnd ? "" : undefined}
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
