"use client";

/**
 * Modules list timeline (decision 108): the gantt chart over modules
 * (`start_date`..`target_date`) with the same drag rules writing
 * `update_module`. No dependency connectors.
 */
import { useCallback, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { useHotkeys } from "@astryxdesign/core/hooks";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Popover } from "@astryxdesign/core/Popover";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { updateModuleAction } from "@/app/actions/modules";
import { useTimelineDrag } from "@/components/dnd/use-timeline-drag";
import { isWeekend, monthLabel, weekendShift } from "@/components/work-items/calendar-math";
import {
  applyDayDelta,
  barPlacement,
  barSpan,
  eachDay,
  previewEnds,
  scheduleOnDay,
  timelineRange,
  type BarDragMode,
  type DateEnds,
} from "@/components/work-items/date-span";
import { monthSpans } from "@/components/work-items/gantt-scale";
import { DateControl } from "@/components/work-items/properties/DateControl";
import { daysBetween } from "@/lib/tessera/core/time";
import type { Module } from "@/lib/tessera/types";
import { CalendarDotsIcon, CalendarIcon, ModuleIcon } from "@/themes/catppuccin/icons";
import { MODULE_STATUS_LABEL, moduleStatusVariant } from "./module-format";

/** Date fields `update_module` accepts; null clears. */
type ModuleDatePatch = { start_date?: string | null; target_date?: string | null };

function cssVars(vars: Record<string, string | number>): CSSProperties {
  return vars as CSSProperties;
}

export type ModulesTimelineProps = {
  projectId: string;
  modules: Module[];
  today: string;
  readOnly?: boolean;
};

export function ModulesTimeline({ projectId, modules, today, readOnly = false }: ModulesTimelineProps) {
  const router = useRouter();
  const toast = useToast();
  const [local, setLocal] = useState<Record<string, DateEnds>>({});
  const range = timelineRange(
    modules.flatMap((module) => {
      const ends = local[module.id] ?? module;
      return [ends.start_date, ends.target_date];
    }),
    today,
  );
  const days = eachDay(range.start, range.end);
  const todayOffset = daysBetween(range.start, today);
  const dayRef = useRef<HTMLElement | null>(null);
  const todayRef = useRef<HTMLElement | null>(null);
  const dayWidth = useCallback(() => dayRef.current?.getBoundingClientRect().width ?? 0, []);

  const writeDates = useCallback(
    async (id: string, patch: ModuleDatePatch) => {
      const row = modules.find((entry) => entry.id === id);
      if (!row) return;
      const before: DateEnds = local[id] ?? row;
      const next: DateEnds = {
        start_date: patch.start_date !== undefined ? patch.start_date : before.start_date,
        target_date: patch.target_date !== undefined ? patch.target_date : before.target_date,
      };
      setLocal((current) => ({ ...current, [id]: next }));
      const result = await updateModuleAction({ module_id: id, ...patch });
      if (!result.ok) {
        setLocal((current) => {
          const copy = { ...current };
          delete copy[id];
          return copy;
        });
        toast({ type: "error", body: result.message });
      }
    },
    [local, modules, toast],
  );

  const { preview, onPointerDown, onClickCapture } = useTimelineDrag({
    dayWidth,
    enabled: !readOnly,
    onCommit: (id, mode, delta) => {
      const row = modules.find((entry) => entry.id === id);
      if (!row) return;
      const ends = local[id] ?? row;
      const patch = applyDayDelta(ends, mode, delta);
      if (patch) void writeDates(id, patch);
    },
  });

  const scrollToday = () => todayRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  useHotkeys([{ keys: "t", onPress: scrollToday }]);

  const schedule = (module: Module, event: ReactMouseEvent<HTMLElement>) => {
    if (readOnly || barSpan(local[module.id] ?? module)) return;
    const width = dayWidth();
    if (width <= 0) return;
    const offset = Math.floor((event.clientX - event.currentTarget.getBoundingClientRect().left) / width);
    if (offset < 0 || offset >= days.length) return;
    void writeDates(module.id, scheduleOnDay(days[offset]));
  };

  if (modules.length === 0) {
    return (
      <VStack padding={8} hAlign="center">
        <EmptyState
          icon={<Icon icon={ModuleIcon} size="lg" color="secondary" />}
          title="No modules yet"
          description="Modules with a start or target date show a bar here."
        />
      </VStack>
    );
  }

  const topSpans = monthSpans(days, monthLabel);

  return (
    <VStack
      gap={0}
      className="tessera-gantt"
      data-zoom="month"
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
          <Text type="supporting">Module</Text>
        </HStack>
        <VStack gap={0} className="tessera-gantt-scale">
          <HStack gap={0}>
            {topSpans.map((span) => (
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
        {modules.map((module) => {
          const base = local[module.id] ?? module;
          const ends = preview?.id === module.id && preview.delta !== 0 ? previewEnds(base, preview.mode, preview.delta) : base;
          return (
            <ModuleTimelineRow
              key={module.id}
              module={module}
              ends={ends}
              rangeStart={range.start}
              readOnly={readOnly}
              onOpen={() => router.push(`/projects/${projectId}/modules/${module.id}`)}
              onUpdate={(patch) => void writeDates(module.id, patch)}
              onSchedule={schedule}
              onPointerDown={onPointerDown}
              onClickCapture={onClickCapture}
            />
          );
        })}
      </VStack>
    </VStack>
  );
}

function ModuleTimelineRow({
  module,
  ends,
  rangeStart,
  readOnly,
  onOpen,
  onUpdate,
  onSchedule,
  onPointerDown,
  onClickCapture,
}: {
  module: Module;
  ends: DateEnds;
  rangeStart: string;
  readOnly: boolean;
  onOpen: () => void;
  onUpdate: (patch: ModuleDatePatch) => void;
  onSchedule: (module: Module, event: ReactMouseEvent<HTMLElement>) => void;
  onPointerDown: (id: string, mode: BarDragMode, event: ReactPointerEvent<HTMLElement>) => void;
  onClickCapture: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
  const statusLabel = MODULE_STATUS_LABEL[module.status];
  const placement = barPlacement(ends, rangeStart);
  const barLabel = placement
    ? `${module.name}, ${ends.start_date ?? "open"} to ${ends.target_date ?? "open"}`
    : `${module.name}, no dates`;

  return (
    <HStack gap={0} vAlign="stretch" className="tessera-gantt-row">
      <HStack gap={1} vAlign="center" paddingInline={2} className="tessera-gantt-label">
        <StatusDot variant={moduleStatusVariant(module.status)} label={statusLabel} />
        <HStack
          gap={1}
          vAlign="center"
          className="tessera-gantt-open"
          role="button"
          tabIndex={0}
          aria-label={`Open ${module.name}`}
          onClick={onOpen}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onOpen();
            }
          }}
        >
          <Text maxLines={1} className="tessera-gantt-name">
            {module.name}
          </Text>
        </HStack>
        {readOnly ? null : <ModuleDates module={module} ends={ends} onUpdate={onUpdate} />}
      </HStack>
      <HStack className="tessera-gantt-track" onClick={(event) => onSchedule(module, event)}>
        {placement ? (
          <HStack
            role="button"
            tabIndex={0}
            className="tessera-gantt-bar"
            aria-label={barLabel}
            data-open-start={placement.openStart ? "" : undefined}
            data-open-end={placement.openEnd ? "" : undefined}
            data-readonly={readOnly ? "" : undefined}
            style={cssVars({ "--tessera-gantt-offset": placement.offset, "--tessera-gantt-span": placement.span })}
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
            onClickCapture={onClickCapture}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onOpen();
              }
            }}
            onPointerDown={readOnly ? undefined : (event) => onPointerDown(module.id, "move", event)}
          >
            <Text type="supporting" maxLines={1}>
              {module.name}
            </Text>
            {readOnly ? null : (
              <>
                <HStack
                  className="tessera-gantt-handle"
                  data-edge="start"
                  aria-hidden
                  onPointerDown={(event) => onPointerDown(module.id, "start", event)}
                  onClick={(event) => event.stopPropagation()}
                />
                <HStack
                  className="tessera-gantt-handle"
                  data-edge="end"
                  aria-hidden
                  onPointerDown={(event) => onPointerDown(module.id, "end", event)}
                  onClick={(event) => event.stopPropagation()}
                />
              </>
            )}
          </HStack>
        ) : null}
      </HStack>
    </HStack>
  );
}

function ModuleDates({ module, ends, onUpdate }: { module: Module; ends: DateEnds; onUpdate: (patch: ModuleDatePatch) => void }) {
  const [isOpen, setOpen] = useState(false);
  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={setOpen}
      label={`Set dates for ${module.name}`}
      placement="below"
      alignment="end"
      hasAutoFocus
      content={
        <VStack gap={2} padding={3} className="tessera-gantt-dates">
          <DateControl label="Start date" value={ends.start_date} max={ends.target_date} onChange={(start_date) => onUpdate({ start_date })} />
          <DateControl label="Target date" value={ends.target_date} min={ends.start_date} onChange={(target_date) => onUpdate({ target_date })} />
          <Button
            variant="ghost"
            size="sm"
            label="Clear dates"
            onClick={() => {
              onUpdate({ start_date: null, target_date: null });
              setOpen(false);
            }}
          />
        </VStack>
      }
    >
      <IconButton label={`Set dates for ${module.name}`} size="sm" variant="ghost" icon={<CalendarIcon />} />
    </Popover>
  );
}
