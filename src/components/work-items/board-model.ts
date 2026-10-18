/**
 * Board model: the columns, swimlanes and drop containers derived from a
 * grouped list result (docs/contracts/ui.md "Work items screen"). Split out of
 * BoardLayout.tsx. A column or lane cell also carries its full `count` and
 * `hasMore`, so a paged board can show "Show more" (decision 112) and tell
 * that its loaded cards are only the start of the column (decision 114).
 */
import { useMemo } from "react";
import type { Display, Group, GroupBy, PaletteColor } from "@/lib/tessera/types";
import type { LayoutProps } from "./types";

/** Id of the synthetic "no value" group (`NONE_GROUP_ID` in the engine's filters.ts). */
export const NONE_GROUP = "none";

/** The engine's group id for a move: the none group becomes null, except for priority where "none" is a real value. */
export function groupValue(id: string, field: GroupBy): string | null {
  return id === NONE_GROUP && field !== "priority" ? null : id;
}

export type Column = { id: string; name: string; color: PaletteColor | null; count: number; itemIds: string[]; hasMore: boolean; points?: number };
/** One lane cell: the loaded ids of a column inside a lane, with the cell's full count. */
export type Cell = { itemIds: string[]; count: number; hasMore: boolean };
export type Lane = { id: string; name: string; color: PaletteColor | null; count: number; cells: Map<string, Cell> };
export type Container = { columnId: string; laneId: string | null; itemIds: string[]; count: number; hasMore: boolean };

export function containerId(columnId: string, laneId: string | null): string {
  return laneId === null ? `col:${columnId}` : `cell:${laneId}::${columnId}`;
}

function toColumn(group: Group): Column {
  return { id: group.id, name: group.name, color: group.color, count: group.count, itemIds: group.item_ids, hasMore: group.has_more, points: group.estimate_points };
}

/** Empty-column text for a column no item may join (an archived module, a completed or archived cycle). */
export function closedColumnText(field: GroupBy | null): string {
  return field === "module" ? "This module is archived, so work items cannot join it." : "This cycle is completed or archived, so work items cannot join it.";
}

/** Columns, swimlanes and drop containers derived from the grouped list result. */
export function useBoardModel(result: LayoutProps["result"], display: Display) {
  return useMemo(() => {
    const groups = result.groups ?? [];
    const grouped = display.group_by !== null && groups.length > 0;
    const columns: Column[] = grouped
      ? groups.filter((group) => display.show_empty_groups || group.count > 0).map(toColumn)
      : [{ id: "all", name: "All work items", color: null, count: result.total, itemIds: result.items.map((item) => item.id), hasMore: result.has_more === true }];

    let lanes: Lane[] | null = null;
    if (grouped && display.sub_group_by !== null) {
      const laneMap = new Map<string, Lane>();
      for (const group of groups) {
        for (const sub of group.sub_groups ?? []) {
          let lane = laneMap.get(sub.id);
          if (!lane) {
            lane = { id: sub.id, name: sub.name, color: sub.color, count: 0, cells: new Map() };
            laneMap.set(sub.id, lane);
          }
          lane.count += sub.count;
          lane.cells.set(group.id, { itemIds: sub.item_ids, count: sub.count, hasMore: sub.has_more });
        }
      }
      lanes = [...laneMap.values()].filter((lane) => display.show_empty_groups || lane.count > 0);
    }

    const containers = new Map<string, Container>();
    if (lanes === null) {
      for (const column of columns) {
        containers.set(containerId(column.id, null), { columnId: column.id, laneId: null, itemIds: column.itemIds, count: column.count, hasMore: column.hasMore });
      }
    } else {
      for (const lane of lanes) {
        for (const column of columns) {
          const cell = lane.cells.get(column.id);
          containers.set(containerId(column.id, lane.id), {
            columnId: column.id,
            laneId: lane.id,
            itemIds: cell?.itemIds ?? [],
            count: cell?.count ?? 0,
            hasMore: cell?.hasMore ?? false,
          });
        }
      }
    }
    const byId = new Map(result.items.map((item) => [item.id, item]));
    return { columns, lanes, containers, byId };
  }, [display.group_by, display.show_empty_groups, display.sub_group_by, result.groups, result.has_more, result.items, result.total]);
}
