"use client";

/**
 * Month and week calendar. Items sit on their target date, in list order.
 * A drop on another day sets that target and, when the item has a start
 * date, shifts the start by the same number of days in one update.
 * The shown period is `?cal=YYYY-MM-DD` (any day inside it).
 */
import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { DateInput } from "@astryxdesign/core/DateInput";
import { Grid } from "@astryxdesign/core/Grid";
import { useHotkeys } from "@astryxdesign/core/hooks";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Popover } from "@astryxdesign/core/Popover";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Heading, Text } from "@astryxdesign/core/Text";
import { withSearchParam } from "@/components/detail/peek-url";
import { usePointerDrag, type ItemDragHandlers } from "@/components/dnd/use-pointer-drag";
import { PanelBar } from "@/components/shell/PanelHeader";
import { isIsoDate } from "@/lib/tessera/core/time";
import type { WorkItem } from "@/lib/tessera/types";
import { CalendarDotsIcon, CalendarIcon, CaretLeftIcon, CaretRightIcon, PlusIcon } from "@/themes/catppuccin/icons";
import { calendarDropPatch } from "./date-span";
import { useWeekStart } from "@/components/workspace-settings/workspace-settings-store";
import {
  calendarWeeks,
  isOutsideMonth,
  itemsByDay,
  periodLabel,
  shiftPeriod,
  weekdayLabels,
} from "./calendar-math";
import { isOptimisticId } from "./optimistic";
import { stateGroupLabel, stateGroupVariant } from "./properties/StateControl";
import { useProject } from "./project-provider";
import { QuickAdd } from "./QuickAdd";
import { useBundles } from "./row-project";
import type { LayoutProps } from "./types";

const MAX_IN_CELL = 4;

type IsoDate = Parameters<typeof DateInput>[0]["value"];

function asIsoDate(value: string | null): IsoDate {
  return value && isIsoDate(value) ? (value as NonNullable<IsoDate>) : undefined;
}

function dayNumber(date: string): string {
  return String(Number(date.slice(8, 10)));
}

export function CalendarLayout({ result, display, onUpdate, onOpen, onQuickAdd, canQuickAdd, readOnly = false }: LayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { bundle } = useProject();
  const view = display.calendar.layout;
  const showWeekends = display.calendar.show_weekends;
  const param = searchParams.get("cal");
  const anchor = param && isIsoDate(param) ? param : bundle.today;
  
  // Server bundle covers HTML and first paint; the settings store wins once published.
  const weekStartsOn = useWeekStart(bundle.week_start);

  const weeks = calendarWeeks(anchor, view, weekStartsOn, showWeekends);
  const columns = weeks[0]?.length ?? (showWeekends ? 7 : 5);
  const labels = weekdayLabels(weekStartsOn, showWeekends);
  const { byDay, unscheduled } = itemsByDay(result.items);
  const [adding, setAdding] = useState<string | null>(null);
  const [unscheduledOpen, setUnscheduledOpen] = useState(false);

  const go = (next: string) => {
    router.replace(withSearchParam(pathname, searchParams, "cal", next === bundle.today ? null : next), { scroll: false });
  };

  useHotkeys([
    { keys: "t", onPress: () => go(bundle.today) },
    { keys: "[", onPress: () => go(shiftPeriod(anchor, view, -1)) },
    { keys: "]", onPress: () => go(shiftPeriod(anchor, view, 1)) },
  ]);

  const drag = usePointerDrag({
    axis: "y",
    itemsOf: (container) => (byDay.get(container) ?? []).map((item) => item.id),
    onDrop: (event) => {
      if (readOnly || event.fromContainer === event.toContainer) return;
      const item = result.items.find((candidate) => candidate.id === event.id);
      if (!item || isOptimisticId(item.id)) return;
      const patch = calendarDropPatch(item, event.toContainer);
      if (patch) onUpdate(item.id, patch);
    },
  });

  const period = view === "month" ? "month" : "week";

  return (
    <VStack gap={2} className="tessera-cal">
      {result.has_more ? (
        <Banner
          status="info"
          title={`Showing the first ${result.items.length} of ${result.total} work items`}
          description="The calendar loads at most 1000 work items of the shown period, plus the unscheduled ones. Narrow the filters to see the rest."
        />
      ) : null}
      <PanelBar
        size="filters"
        canWrap
        start={
          <>
            <IconButton label={`Previous ${period}`} size="sm" variant="ghost" icon={<CaretLeftIcon />} onClick={() => go(shiftPeriod(anchor, view, -1))} />
            <IconButton label={`Next ${period}`} size="sm" variant="ghost" icon={<CaretRightIcon />} onClick={() => go(shiftPeriod(anchor, view, 1))} />
            <Button label="Today" size="sm" variant="ghost" icon={<CalendarDotsIcon />} onClick={() => go(bundle.today)} />
            <Heading level={3}>{periodLabel(anchor, view, weekStartsOn)}</Heading>
          </>
        }
        end={
          unscheduled.length > 0 ? (
            <Popover
              isOpen={unscheduledOpen}
              onOpenChange={setUnscheduledOpen}
              label="Unscheduled"
              placement="below"
              alignment="end"
              content={
                <VStack gap={1} padding={2} className="tessera-cal-more">
                  {unscheduled.map((item) => (
                    <CalendarItem key={item.id} item={item} readOnly={readOnly} onOpen={onOpen} onUpdate={onUpdate} />
                  ))}
                </VStack>
              }
            >
              <Button variant="ghost" size="sm" label={`${unscheduled.length} unscheduled`} />
            </Popover>
          ) : null
        }
      />
      <Grid columns={columns} gap={1}>
        {labels.map((label) => (
          <Text key={label} type="supporting" className="tessera-cal-head">
            {label}
          </Text>
        ))}
      </Grid>
      {weeks.map((week) => (
        <Grid key={week[0]} columns={columns} gap={1}>
          {week.map((day) => (
            <DayCell
              key={day}
              day={day}
              anchor={anchor}
              today={bundle.today}
              items={byDay.get(day) ?? []}
              isDrop={drag.drag?.target?.container === day}
              isAdding={adding === day}
              readOnly={readOnly}
              registerContainer={drag.registerContainer(day)}
              registerItem={drag.registerItem}
              itemHandlers={drag.itemHandlers}
              onOpen={onOpen}
              onUpdate={onUpdate}
              onQuickAdd={
                onQuickAdd && !readOnly && (canQuickAdd?.({ field: "target_date", value: day }) ?? true)
                  ? (name) => onQuickAdd({ field: "target_date", value: day }, name)
                  : undefined
              }
              onStartAdd={() => setAdding(day)}
            />
          ))}
        </Grid>
      ))}
    </VStack>
  );
}

function DayCell({
  day,
  anchor,
  today,
  items,
  isDrop,
  isAdding,
  readOnly,
  registerContainer,
  registerItem,
  itemHandlers,
  onOpen,
  onUpdate,
  onQuickAdd,
  onStartAdd,
}: {
  day: string;
  anchor: string;
  today: string;
  items: WorkItem[];
  isDrop: boolean;
  isAdding: boolean;
  readOnly: boolean;
  registerContainer: (el: HTMLElement | null) => void;
  registerItem: (id: string) => (el: HTMLElement | null) => void;
  itemHandlers: ReturnType<typeof usePointerDrag>["itemHandlers"];
  onOpen: LayoutProps["onOpen"];
  onUpdate: LayoutProps["onUpdate"];
  onQuickAdd?: (name: string) => void;
  onStartAdd: () => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const shown = items.slice(0, MAX_IN_CELL);
  const hidden = items.length - shown.length;
  return (
    <VStack
      ref={registerContainer}
      gap={1}
      className="tessera-cal-day"
      data-today={day === today ? "" : undefined}
      data-outside={isOutsideMonth(day, anchor) ? "" : undefined}
      data-drop={isDrop ? "" : undefined}
    >
      <HStack hAlign="between" vAlign="center">
        <Text type="supporting" weight={day === today ? "medium" : "normal"} hasTabularNumbers>
          {dayNumber(day)}
        </Text>
        {onQuickAdd ? <IconButton className="tessera-cal-add" label={`Add on ${day}`} size="sm" variant="ghost" icon={<PlusIcon />} onClick={onStartAdd} /> : null}
      </HStack>
      {shown.map((item) => (
        <CalendarItem
          key={item.id}
          item={item}
          readOnly={readOnly}
          itemRef={isOptimisticId(item.id) || readOnly ? undefined : registerItem(item.id)}
          handlers={isOptimisticId(item.id) || readOnly ? undefined : itemHandlers(item.id, day)}
          onOpen={onOpen}
          onUpdate={onUpdate}
        />
      ))}
      {hidden > 0 ? (
        <Popover
          isOpen={moreOpen}
          onOpenChange={setMoreOpen}
          label={`More items on ${day}`}
          placement="below"
          content={
            <VStack gap={1} padding={2} className="tessera-cal-more">
              {items.slice(MAX_IN_CELL).map((item) => (
                <CalendarItem key={item.id} item={item} readOnly={readOnly} onOpen={onOpen} onUpdate={onUpdate} />
              ))}
            </VStack>
          }
        >
          <Button variant="ghost" size="sm" label={`+${hidden} more`} />
        </Popover>
      ) : null}
      {isAdding && onQuickAdd ? <QuickAdd defaultIsActive label={`Add on ${day}`} onSubmit={onQuickAdd} /> : null}
    </VStack>
  );
}

function CalendarItem({
  item,
  readOnly,
  itemRef,
  handlers,
  onOpen,
  onUpdate,
}: {
  item: WorkItem;
  readOnly: boolean;
  itemRef?: (el: HTMLElement | null) => void;
  handlers?: ItemDragHandlers;
  onOpen: LayoutProps["onOpen"];
  onUpdate: LayoutProps["onUpdate"];
}) {
  const bundles = useBundles();
  const { bundle, statesById } = useProject();
  const weekStartsOn = useWeekStart(bundle.week_start);
  const state = bundles?.[item.project_id]?.states.find((entry) => entry.id === item.state_id) ?? statesById.get(item.state_id);
  const [moveOpen, setMoveOpen] = useState(false);
  const open = () => {
    if (!isOptimisticId(item.id)) onOpen(item.id);
  };
  return (
    <HStack gap={1} vAlign="center" className="tessera-cal-item">
      <HStack
        ref={itemRef}
        gap={1}
        vAlign="center"
        className="tessera-cal-open"
        role="button"
        tabIndex={0}
        aria-label={`${item.key} ${item.name}`}
        onClick={open}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            open();
          }
        }}
        onPointerDown={handlers?.onPointerDown}
        onClickCapture={handlers?.onClickCapture}
      >
        {state ? <StatusDot variant={stateGroupVariant(state.state_group)} label={stateGroupLabel(state.state_group)} /> : null}
        <Text type="supporting" hasTabularNumbers>
          {item.key}
        </Text>
        <Text maxLines={1} className="tessera-cal-name">
          {item.name}
        </Text>
      </HStack>
      {readOnly || isOptimisticId(item.id) ? null : (
        <Popover
          isOpen={moveOpen}
          onOpenChange={setMoveOpen}
          label={`Move ${item.key} to date`}
          placement="below"
          hasAutoFocus
          content={
            <VStack padding={3}>
              <DateInput
                label="Move to date"
                format="date"
                hasClear
                value={asIsoDate(item.target_date)}
                weekStartsOn={weekStartsOn}
                presentation="popover"
                onChange={(next) => {
                  setMoveOpen(false);
                  if (!next) {
                    onUpdate(item.id, { target_date: null });
                    return;
                  }
                  const patch = calendarDropPatch(item, next);
                  if (patch) onUpdate(item.id, patch);
                }}
              />
            </VStack>
          }
        >
          <IconButton className="tessera-cal-move" label={`Move ${item.key} to date`} size="sm" variant="ghost" icon={<CalendarIcon />} />
        </Popover>
      )}
    </HStack>
  );
}
