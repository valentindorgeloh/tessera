/**
 * Pure maths of the virtual windows (decisions 135-137; tests/ui/virtual-math.test.ts). No DOM, no React.
 *
 * TanStack's item `start`/`end` include `scrollMargin` (the anchor's offset in the scroller), while `getTotalSize()`
 * already excludes it (`@tanstack/virtual-core` 3.19.4 `index.js:736, 1202-1205`). The helpers below subtract it
 * exactly once.
 */
import { ESTIMATE, START } from "./virtual-config";

export function shouldVirtualize(count: number, min: number): boolean {
  return count > min;
}

/** The anchor's offset in the scroller's content, from two `getBoundingClientRect()` reads. */
export function offsetWithin(anchorTop: number, scrollerTop: number, scrollTop: number, scrollerClientTop: number): number {
  return anchorTop - scrollerTop + scrollTop - scrollerClientTop;
}

export type EstimateSection = { rows: number; isOpen: boolean; hasBand: boolean; hasFooter: boolean; hasQuickAdd: boolean };

/**
 * Each section's row-list start in the scroller content, from `START` and `ESTIMATE`. List: the block padding,
 * then per section its band (when it has one), its rows while open, its footer and quick-add row (the caller
 * passes false for a collapsed group, whose body is hidden), and the gap between sections. Table: one section that
 * starts below the head.
 */
export function estimateStarts(sections: readonly EstimateSection[], kind: "list" | "table"): number[] {
  if (kind === "table") return sections.map(() => START.tableHead);
  const starts: number[] = [];
  let y = START.listPadding;
  sections.forEach((section, i) => {
    if (i > 0) y += START.groupGap;
    if (section.hasBand) y += START.groupBand;
    starts.push(y);
    if (section.isOpen) y += section.rows * ESTIMATE.list;
    if (section.hasFooter) y += START.listFooter;
    if (section.hasQuickAdd) y += START.quickAdd;
  });
  return starts;
}

export type IndexRange = { first: number; last: number };

/**
 * The rows of `[0, viewport)` at scroll top 0 plus `overscan` after them: the deterministic window the server and
 * the first client render draw. Null when the anchor starts at or below the viewport, or has no rows.
 */
export function initialRange(input: { start: number; count: number; size: number; gap: number; viewport: number; overscan: number }): IndexRange | null {
  const { start, count, size, gap, viewport, overscan } = input;
  if (count <= 0 || start >= viewport) return null;
  const fit = Math.ceil((viewport - start) / (size + gap));
  return { first: 0, last: Math.min(count - 1, fit - 1 + overscan) };
}

/** Whether the anchor `[start, start + size]` meets `[scrollTop − margin, scrollTop + viewport + margin]`. */
export function isNearViewport(input: { start: number; size: number; scrollTop: number; viewport: number; margin: number }): boolean {
  const { start, size, scrollTop, viewport, margin } = input;
  return start + size >= scrollTop - margin && start <= scrollTop + viewport + margin;
}

/** The sorted, de-duplicated union of `base` and `keep`, limited to `0 … count − 1` (the `rangeExtractor` result). */
export function withKept(base: readonly number[], keep: readonly number[], count: number): number[] {
  const all = new Set<number>();
  for (const i of [...base, ...keep]) if (Number.isInteger(i) && i >= 0 && i < count) all.add(i);
  return [...all].sort((a, b) => a - b);
}

/** Splits rendered indexes by TanStack's default range bounds: kept rows before it, the window, kept rows after. */
export function partitionKept(indexes: readonly number[], first: number, last: number): { before: number[]; window: number[]; after: number[] } {
  const before: number[] = [];
  const window: number[] = [];
  const after: number[] = [];
  for (const i of indexes) {
    if (i < first) before.push(i);
    else if (i > last) after.push(i);
    else window.push(i);
  }
  return { before, window, after };
}

type Span = { start: number; end: number };

/** The anchor's padding around the window. Item spans include `scrollMargin`, `totalSize` does not. */
export function paddings(window: readonly Span[], totalSize: number, scrollMargin: number): { before: number; after: number } {
  if (window.length === 0) return { before: 0, after: Math.max(0, totalSize) };
  const first = window[0];
  const last = window[window.length - 1];
  return { before: Math.max(0, first.start - scrollMargin), after: Math.max(0, totalSize - (last.end - scrollMargin)) };
}

export type TableSegment = { kind: "row"; index: number } | { kind: "spacer"; id: string; height: number };

/** Spacers shorter than this are left out (sub-pixel rounding between measured rows). */
const MIN_SPACER = 0.5;

/**
 * The virtual table body in order: the rendered rows (window and kept, in index order, spans including
 * `scrollMargin`) with a spacer before the first (`virtual:top`), between rows whose indexes are not adjacent
 * (`virtual:gap-1`, `virtual:gap-2`, …) and after the last (`virtual:bottom`). A spacer is the uncovered distance.
 * No rows: one `virtual:top` spacer of the whole size.
 */
export function tableSegments(rows: readonly { index: number; start: number; end: number }[], totalSize: number, scrollMargin: number): TableSegment[] {
  const out: TableSegment[] = [];
  const spacer = (id: string, height: number) => {
    if (height >= MIN_SPACER) out.push({ kind: "spacer", id, height });
  };
  if (rows.length === 0) {
    spacer("virtual:top", totalSize);
    return out;
  }
  spacer("virtual:top", rows[0].start - scrollMargin);
  let gaps = 0;
  rows.forEach((row, i) => {
    const previous = rows[i - 1];
    if (previous && row.index !== previous.index + 1) {
      gaps += 1;
      spacer(`virtual:gap-${gaps}`, row.start - previous.end);
    }
    out.push({ kind: "row", index: row.index });
  });
  spacer("virtual:bottom", totalSize - (rows[rows.length - 1].end - scrollMargin));
  return out;
}

/** True when rows after the last rendered one exist (`data-virtual-open-end`, virtual.css divider rule). */
export function isOpenEnd(lastRenderedIndex: number, count: number): boolean {
  return lastRenderedIndex < count - 1;
}

export const NAV_KEYS = ["ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"] as const;

/** A navigation key without a modifier (decision 136's kept-row rule). */
export function isNavKey(event: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  return (NAV_KEYS as readonly string[]).includes(event.key);
}

/** A CSS pixel length, rounded and never negative. */
export function cssPx(n: number): string {
  return `${Math.max(0, Math.round(n))}px`;
}
