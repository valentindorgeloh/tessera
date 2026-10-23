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

const BAR_COLOR: Record<string, string> = {
  accent: "var(--color-accent)",
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  error: "var(--color-error)",
  neutral: "var(--color-border-emphasized)",
};

/**
 * The colour token a bar takes from a StatusDot variant (the state group's, or
 * a module status's): the stylesheet mixes it into the fill and uses it as the
 * border (`--tessera-bar-color`). An unknown variant reads as neutral.
 */
export function barColorToken(variant: string | undefined): string {
  return BAR_COLOR[variant ?? "neutral"] ?? BAR_COLOR.neutral;
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
  type: GanttEdgeType;
  fromId: string;
  toId: string;
};

/**
 * Pixel scale of the connector layer: one day column, one row and the inset
 * between a bar and its day boundary. The default (1, 1, 0) keeps the unit
 * space (`days` by `rows`) the pure tests read.
 */
export type ConnectorScale = { day: number; row: number; inset: number };

const UNIT_SCALE: ConnectorScale = { day: 1, row: 1, inset: 0 };

/**
 * SVG paths for the connector layer. With a measured `scale` they are in CSS
 * pixels, so the layer needs no scaled viewBox and an arrowhead keeps its
 * shape (decision 92). Row centres sit at `(index + 0.5) * row`. A path ends
 * on the bar's own edge: the day boundary pulled in by `inset` (bars are inset
 * from their day), and it leaves and arrives on the side the anchor faces, so
 * an arrowhead at the end points into the bar it blocks.
 */
export function connectorPaths(
  edges: readonly GanttEdge[],
  rowIndex: ReadonlyMap<string, number>,
  byId: ReadonlyMap<string, DateEnds>,
  rangeStart: string,
  dayCount: number,
  scale: ConnectorScale = UNIT_SCALE,
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
    const c1 = anchors.source === "start" ? sourcePlace.offset : sourcePlace.offset + sourcePlace.span;
    const c2 = anchors.target === "start" ? targetPlace.offset : targetPlace.offset + targetPlace.span;
    if (c1 < 0 || c2 < 0 || c1 > dayCount || c2 > dayCount) continue;
    const x1 = c1 * scale.day + (anchors.source === "start" ? scale.inset : -scale.inset);
    const x2 = c2 * scale.day + (anchors.target === "start" ? scale.inset : -scale.inset);
    const y1 = (sourceRow + 0.5) * scale.row;
    const y2 = (targetRow + 0.5) * scale.row;
    const dx = Math.max(0.75 * scale.day, Math.abs(x2 - x1) / 2);
    const leave = anchors.source === "end" ? dx : -dx;
    const arrive = anchors.target === "start" ? -dx : dx;
    const d = `M ${x1} ${y1} C ${x1 + leave} ${y1}, ${x2 + arrive} ${y2}, ${x2} ${y2}`;
    paths.push({
      key: `${edge.from_id}:${edge.type}:${edge.to_id}`,
      d,
      conflict: edgeConflict(edge, byId),
      type: edge.type,
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

/**
 * Plain-text notes per item for the conflict tooltip (decision 92): each
 * conflicting connector tells both of its bars which item it clashes with, by
 * key, and the date that breaks the rule. `blocked_by` names the blocker and
 * its end date on the blocked bar. The same text is the bar's description for
 * assistive technology.
 */
export function conflictNotes(
  paths: readonly ConnectorGeom[],
  byId: ReadonlyMap<string, DateEnds>,
  keyById: ReadonlyMap<string, string>,
): Map<string, string[]> {
  const notes = new Map<string, string[]>();
  const add = (id: string, note: string) => {
    const list = notes.get(id);
    if (list) {
      if (!list.includes(note)) list.push(note);
    } else notes.set(id, [note]);
  };
  for (const path of paths) {
    if (!path.conflict) continue;
    const from = byId.get(path.fromId);
    const to = byId.get(path.toId);
    const fromKey = keyById.get(path.fromId);
    const toKey = keyById.get(path.toId);
    if (!from || !to || !fromKey || !toKey) continue;
    if (path.type === "blocked_by") {
      add(path.fromId, `Blocked by ${toKey}, which ends ${to.target_date}`);
      add(path.toId, `Blocks ${fromKey}, which starts ${from.start_date}`);
    } else if (path.type === "start_before") {
      add(path.fromId, `Should start before ${toKey}, which starts ${to.start_date}`);
      add(path.toId, `Should start after ${fromKey}, which starts ${from.start_date}`);
    } else {
      add(path.fromId, `Should finish before ${toKey}, which ends ${to.target_date}`);
      add(path.toId, `Should finish after ${fromKey}, which ends ${from.target_date}`);
    }
  }
  return notes;
}
