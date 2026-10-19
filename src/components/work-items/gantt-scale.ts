/**
 * Gantt header scale and dependency connectors (decisions 90–92). Pure and
 * client-safe: dates stay `YYYY-MM-DD`, no clock is read.
 */
import { compareDates } from "@/lib/tessera/core/time";
import type { RelationType } from "@/lib/tessera/types";
import { startOfWeek, type WeekStart } from "./calendar-math";
import { barPlacement, barSpan, type DateEnds } from "./date-span";

export type GanttZoom = "week" | "month" | "quarter";

/** Relation types the gantt draws as connectors (decision 92). */
export const GANTT_EDGE_TYPES = ["blocked_by", "start_before", "finish_before"] as const;
export type GanttEdgeType = (typeof GANTT_EDGE_TYPES)[number];

export type GanttEdge = { from_id: string; to_id: string; type: GanttEdgeType };

export type ScaleSpan = { key: string; label: string; span: number };

/** Consecutive month bands over `days` (labels like "Oct 2026"). */
export function monthSpans(days: readonly string[], monthLabel: (day: string) => string): ScaleSpan[] {
  const spans: ScaleSpan[] = [];
  for (const day of days) {
    const key = day.slice(0, 7);
    const last = spans[spans.length - 1];
    if (last && last.key === key) last.span += 1;
    else spans.push({ key, label: monthLabel(day), span: 1 });
  }
  return spans;
}

/** Consecutive week bands; each label is the week's first day (`D MMM`). */
export function weekSpans(days: readonly string[], weekStartsOn: WeekStart, weekLabel: (day: string) => string): ScaleSpan[] {
  const spans: ScaleSpan[] = [];
  for (const day of days) {
    const key = startOfWeek(day, weekStartsOn);
    const last = spans[spans.length - 1];
    if (last && last.key === key) last.span += 1;
    else spans.push({ key, label: weekLabel(key), span: 1 });
  }
  return spans;
}

export function isGanttEdgeType(type: RelationType): type is GanttEdgeType {
  return (GANTT_EDGE_TYPES as readonly string[]).includes(type);
}

/** Keep only connector types that both ends can draw (decision 92). */
export function ganttEdges(relations: readonly { from_id: string; to_id: string; type: RelationType }[] | undefined): GanttEdge[] {
  if (!relations) return [];
  return relations.filter((edge): edge is GanttEdge => isGanttEdgeType(edge.type));
}

type Anchor = "start" | "end";

/** Source and target bar ends for one connector (decision 92). */
export function connectorAnchors(type: GanttEdgeType): {
  sourceId: "from_id" | "to_id";
  targetId: "from_id" | "to_id";
  source: Anchor;
  target: Anchor;
} {
  if (type === "blocked_by") return { sourceId: "to_id", targetId: "from_id", source: "end", target: "start" };
  if (type === "start_before") return { sourceId: "from_id", targetId: "to_id", source: "start", target: "start" };
  return { sourceId: "from_id", targetId: "to_id", source: "end", target: "end" };
}

/**
 * Conflict when the dependency dates are violated (decision 92). Same-day
 * finish for `blocked_by` is fine; later is not.
 */
export function edgeConflict(edge: GanttEdge, byId: ReadonlyMap<string, DateEnds>): boolean {
  const from = byId.get(edge.from_id);
  const to = byId.get(edge.to_id);
  if (!from || !to) return false;
  if (edge.type === "blocked_by") {
    if (to.target_date === null || from.start_date === null) return false;
    return compareDates(to.target_date, from.start_date) > 0;
  }
  if (edge.type === "start_before") {
    if (from.start_date === null || to.start_date === null) return false;
    return compareDates(from.start_date, to.start_date) > 0;
  }
  if (from.target_date === null || to.target_date === null) return false;
  return compareDates(from.target_date, to.target_date) > 0;
}

export type ConnectorGeom = {
  key: string;
  d: string;
  conflict: boolean;
  fromId: string;
  toId: string;
};

/**
 * SVG paths in a viewBox of `days` columns by `rows` rows. Column 0 is the
 * first day; row centres sit at `index + 0.5`.
 */
export function connectorPaths(
  edges: readonly GanttEdge[],
  rowIndex: ReadonlyMap<string, number>,
  byId: ReadonlyMap<string, DateEnds>,
  rangeStart: string,
  dayCount: number,
): ConnectorGeom[] {
  const paths: ConnectorGeom[] = [];
  for (const edge of edges) {
    const anchors = connectorAnchors(edge.type);
    const sourceItem = byId.get(edge[anchors.sourceId]);
    const targetItem = byId.get(edge[anchors.targetId]);
    const sourceRow = rowIndex.get(edge[anchors.sourceId]);
    const targetRow = rowIndex.get(edge[anchors.targetId]);
    if (!sourceItem || !targetItem || sourceRow === undefined || targetRow === undefined) continue;
    if (!barSpan(sourceItem) || !barSpan(targetItem)) continue;
    const sourcePlace = barPlacement(sourceItem, rangeStart);
    const targetPlace = barPlacement(targetItem, rangeStart);
    if (!sourcePlace || !targetPlace) continue;
    const x1 = anchors.source === "start" ? sourcePlace.offset : sourcePlace.offset + sourcePlace.span;
    const x2 = anchors.target === "start" ? targetPlace.offset : targetPlace.offset + targetPlace.span;
    if (x1 < 0 || x2 < 0 || x1 > dayCount || x2 > dayCount) continue;
    const y1 = sourceRow + 0.5;
    const y2 = targetRow + 0.5;
    const dx = Math.max(0.75, Math.abs(x2 - x1) / 2);
    const d = `M ${x1} ${y1} C ${x1 + (x2 >= x1 ? dx : -dx)} ${y1}, ${x2 + (x2 >= x1 ? -dx : dx)} ${y2}, ${x2} ${y2}`;
    paths.push({
      key: `${edge.from_id}:${edge.type}:${edge.to_id}`,
      d,
      conflict: edgeConflict(edge, byId),
      fromId: edge.from_id,
      toId: edge.to_id,
    });
  }
  return paths;
}

/** Item ids whose bar should show a conflict outline. */
export function conflictItemIds(paths: readonly ConnectorGeom[]): Set<string> {
  const ids = new Set<string>();
  for (const path of paths) {
    if (!path.conflict) continue;
    ids.add(path.fromId);
    ids.add(path.toId);
  }
  return ids;
}
