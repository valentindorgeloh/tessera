"use client";

/**
 * The gantt body: the today line, the dependency connectors and one row per work item, behind a virtual window above
 * `VIRTUAL_GANTT_MIN` rows (decisions 135-137). Moved out of GanttLayout.tsx with `GanttRow` and `GanttDates`.
 *
 * Rows have one fixed height: GanttLayout's `useGanttMetrics` measures it (44 px on a coarse pointer or a phone) and
 * passes it in, so rows are not measured one by one. The connector SVG keeps its full size (`rows × row`), so its
 * coordinates still match; only the paths that meet the rendered rows are drawn (`pathsInRows`). The row of the bar
 * being dragged is always rendered (`keepIndexes`): the bar holds pointer capture (`use-timeline-drag.ts`), which an
 * unmounted row would lose. A row outside the window sits absolutely at its offset (`.tessera-virtual-kept`).
 */
import { memo, useCallback, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Popover } from "@astryxdesign/core/Popover";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { cssVars } from "@/components/shared/css-vars";
import { keptRowStyle, useVirtualRows } from "@/components/virtual/use-virtual-rows";
import { ESTIMATE, OVERSCAN, START } from "@/components/virtual/virtual-config";
import type { WorkItem } from "@/lib/tessera/types";
import { CalendarIcon } from "@/themes/catppuccin/icons";
import { barPlacement, type BarDragMode, type DateEnds } from "./date-span";
import type { GanttMetrics } from "./gantt-metrics";
import { barColorToken, pathsInRows, type ConnectorGeom } from "./gantt-scale";
import { isOptimisticId } from "./optimistic";
import { OneLineText } from "./OneLineText";
import { DateControl } from "./properties/DateControl";
import { stateGroupLabel, stateGroupVariant } from "./properties/StateControl";
import { useProjectRow } from "./project-provider";
import { useBundles } from "./row-project";
import type { LayoutProps } from "./types";

const NO_KEEP: readonly number[] = [];

export type GanttRowsProps = {
  items: readonly WorkItem[];
  /** Each item's ends, the dragged one's previewed (`previewEnds`); an item that is not previewed maps to itself. */
  endsById: ReadonlyMap<string, DateEnds>;
  rowIndex: ReadonlyMap<string, number>;
  rangeStart: string;
  dayCount: number;
  readOnly: boolean;
  /** What each bar clashes with (decision 92), by item id. */
  notes: ReadonlyMap<string, string[]>;
  paths: readonly ConnectorGeom[];
  /** GanttLayout's `useGanttMetrics`: the connector scale and the row height; null until measured. */
  metrics: GanttMetrics | null;
  markerId: string;
  /** The threshold result (GanttLayout). */
  isVirtual: boolean;
  /** The id of the bar being dragged (`useTimelineDrag().preview`), else null. */
  draggedId: string | null;
  onOpen: LayoutProps["onOpen"];
  onUpdate: LayoutProps["onUpdate"];
  /** Stable (GanttLayout's `useStableCallback`). */
  onSchedule: (item: WorkItem, event: ReactMouseEvent<HTMLElement>) => void;
  onPointerDown: (id: string, mode: BarDragMode, event: ReactPointerEvent<HTMLElement>) => void;
  onClickCapture: (event: ReactMouseEvent<HTMLElement>) => void;
};

export function GanttRows({
  items,
  endsById,
  rowIndex,
  rangeStart,
  dayCount,
  readOnly,
  notes,
  paths,
  metrics,
  markerId,
  isVirtual,
  draggedId,
  onOpen,
  onUpdate,
  onSchedule,
  onPointerDown,
  onClickCapture,
}: GanttRowsProps) {
  const rowHeight = metrics?.row ?? ESTIMATE.gantt;
  // The key function also changes with the row height: TanStack rebuilds its measurements only when the key function,
  // the count or the margins change (virtual-core `getMeasurementOptions`), not when the estimate does.
  const getKey = useCallback((i: number) => (rowHeight > 0 ? items[i].id : items[i].id), [items, rowHeight]);
  const draggedIndex = draggedId === null ? undefined : rowIndex.get(draggedId);
  const keepIndexes = useMemo(() => (draggedIndex === undefined ? NO_KEEP : [draggedIndex]), [draggedIndex]);
  const { isEnabled, anchorRef, anchorClassName, anchorStyle, rendered, window: windowRows, onFocusCapture } = useVirtualRows({
    anchorId: "gantt",
    kind: "gantt",
    count: items.length,
    getKey,
    fixedSize: rowHeight,
    keepIndexes,
    isEnabled: isVirtual,
    estimateStart: START.ganttBody,
  });
  const first = windowRows[0]?.index;
  const last = windowRows.at(-1)?.index;
  const shownPaths = !isEnabled ? paths : first === undefined || last === undefined ? [] : pathsInRows(paths, rowIndex, first - OVERSCAN.gantt, last + OVERSCAN.gantt);

  return (
    <VStack
      ref={anchorRef}
      gap={0}
      className={anchorClassName ? `tessera-gantt-body ${anchorClassName}` : "tessera-gantt-body"}
      style={anchorStyle}
      onFocusCapture={isEnabled ? onFocusCapture : undefined}
    >
      <VStack className="tessera-gantt-today" aria-hidden />
      {shownPaths.length > 0 && metrics ? (
        <svg className="tessera-gantt-connectors" viewBox={`0 0 ${dayCount * metrics.day} ${items.length * metrics.row}`} aria-hidden>
          <defs>
            <ArrowMarker id={`${markerId}-edge`} />
            <ArrowMarker id={`${markerId}-conflict`} isConflict />
          </defs>
          {shownPaths.map((path) => (
            <path
              key={path.key}
              d={path.d}
              className="tessera-gantt-edge"
              data-conflict={path.conflict ? "" : undefined}
              markerEnd={`url(#${markerId}-${path.conflict ? "conflict" : "edge"})`}
            />
          ))}
        </svg>
      ) : null}
      {/* One array (keptBefore, window, keptAfter): a row moving between them keeps its key, so it stays mounted. */}
      {rendered.map((r) => {
        const item = items[r.index];
        return (
          <GanttRow
            key={item.id}
            item={item}
            ends={endsById.get(item.id) ?? item}
            rangeStart={rangeStart}
            readOnly={readOnly}
            conflictText={notes.get(item.id)?.join("; ")}
            onOpen={onOpen}
            onUpdate={onUpdate}
            onSchedule={onSchedule}
            onPointerDown={onPointerDown}
            onClickCapture={onClickCapture}
            virtualIndex={isEnabled ? r.index : undefined}
            keptTop={r.keptTop}
          />
        );
      })}
    </VStack>
  );
}

/** The arrowhead at the end of a connector: `currentColor`, which the stylesheet sets (the error colour for a conflict). */
function ArrowMarker({ id, isConflict = false }: { id: string; isConflict?: boolean }) {
  return (
    <marker id={id} className="tessera-gantt-arrow" data-conflict={isConflict ? "" : undefined} markerWidth={7} markerHeight={8} refX={7} refY={4} orient="auto" markerUnits="userSpaceOnUse">
      <path d="M 0 0 L 7 4 L 0 8 z" fill="currentColor" />
    </marker>
  );
}

/** The row's window attributes: `data-index`, and for a kept row its class and offset (virtual.css). */
function rowWindowProps(virtualIndex: number | undefined, keptTop: number | undefined): { className: string; "data-index"?: string; style?: CSSProperties } {
  if (virtualIndex === undefined) return { className: "tessera-gantt-row" };
  if (keptTop === undefined) return { className: "tessera-gantt-row", "data-index": String(virtualIndex) };
  return { className: "tessera-gantt-row tessera-virtual-kept", "data-index": String(virtualIndex), style: keptRowStyle(keptTop) };
}

/**
 * Memoised (decision 136): the item, its ends (the item itself unless its bar is previewed), primitives and the stable
 * handlers, so a range change or a drag preview re-renders only the rows that changed. Its states come from the lean
 * row context (or the row's own project in a cross-project list).
 */
const GanttRow = memo(function GanttRow({
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
  virtualIndex,
  keptTop,
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
  virtualIndex?: number;
  keptTop?: number;
}) {
  const bundles = useBundles();
  const { statesById } = useProjectRow();
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
    <HStack gap={0} vAlign="stretch" {...rowWindowProps(virtualIndex, keptTop)}>
      <HStack gap={1} vAlign="center" paddingInline={4} className="tessera-gantt-label">
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
          <OneLineText className="tessera-gantt-name">{item.name}</OneLineText>
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
              data-state-group={state?.state_group}
              style={cssVars({
                "--tessera-gantt-offset": placement.offset,
                "--tessera-gantt-span": placement.span,
                "--tessera-bar-color": barColorToken(state ? stateGroupVariant(state.state_group) : "neutral"),
              })}
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
              <OneLineText type="supporting" className="tessera-gantt-bar-label">
                {item.key}
              </OneLineText>
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
});

/** The row's date button. Exported for tests/ui/gantt-dates-lazy.test.ts. */
export function GanttDates({ item, onUpdate }: { item: WorkItem; onUpdate: LayoutProps["onUpdate"] }) {
  const [isOpen, setOpen] = useState(false);
  // Astryx 0.6.8 Popover has no lazy prop and keeps closed content mounted: every draggable row carried two full
  // DateInput calendars. The pickers mount only while the popover is open (as in the compact DateControl).
  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={setOpen}
      label={`Set dates for ${item.key}`}
      placement="below"
      alignment="end"
      hasAutoFocus
      content={
        isOpen ? (
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
        ) : null
      }
    >
      <IconButton label={`Set dates for ${item.key}`} size="sm" variant="ghost" icon={<CalendarIcon />} />
    </Popover>
  );
}
