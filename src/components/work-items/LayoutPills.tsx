"use client";

/**
 * The layout switch of the work items bar (docs/contracts/ui.md "Work items
 * screen"): List, Board, Table, Calendar and Gantt as labelled pills. An Astryx
 * SegmentedControl keeps the radio group, the arrow keys and the accessible
 * names; wi-bar.css draws it as quiet pills (a soft fill on the active one) and
 * hides the label text of the inactive ones, kept for screen readers, once the
 * bar is under 56rem wide or a phone. In that compact state the inactive pills
 * carry a tooltip with their name. Workspace views do not mount it (decision
 * 18: those views stay table-only). Writes go through `useDisplayWriter`.
 */
import { useEffect, useRef, useState } from "react";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { LayoutSchema } from "@/lib/tessera/schemas";
import type { Display, Layout } from "@/lib/tessera/types";
import { CalendarIcon, GanttIcon, KanbanIcon, RowsIcon, TableIcon } from "@/themes/catppuccin/icons";
import { useDisplayWriter, type LayoutSwitchProps } from "./DisplayMenu";

/** The bar width under which the inactive pills are icon-only. Keep equal to the `@container tessera-wi-bar` width in wi-bar.css (56rem). */
const COMPACT_BAR_PX = 896;
/** The bar that is the size container; the pills only read its width. */
const BAR_SELECTOR = ".tessera-wi-bar";

const PILLS: ReadonlyArray<{ value: Layout; label: string; icon: React.ReactNode }> = [
  { value: "list", label: "List", icon: <RowsIcon /> },
  { value: "board", label: "Board", icon: <KanbanIcon /> },
  { value: "table", label: "Table", icon: <TableIcon /> },
  { value: "calendar", label: "Calendar", icon: <CalendarIcon /> },
  { value: "gantt", label: "Gantt", icon: <GanttIcon /> },
];

function isLayout(value: string): value is Layout {
  return (LayoutSchema.options as readonly string[]).includes(value);
}

/** True while the bar around `ref` is narrower than the compact width. False until measured, so the server and the first paint agree. */
function useCompactBar(ref: React.RefObject<HTMLElement | null>): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const bar = ref.current?.closest(BAR_SELECTOR);
    if (!bar || typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(() => setCompact(bar.clientWidth < COMPACT_BAR_PX));
    observer.observe(bar);
    return () => observer.disconnect();
  }, [ref]);
  return compact;
}

/**
 * One pill. In the compact state an inactive pill gets a tooltip with its name in Astryx's sibling mode (no wrapper, so the
 * radio stays a direct child of the group); it is mounted only then, so a wide bar draws no duplicate of the visible label.
 */
function Pill({ pill, hint }: { pill: (typeof PILLS)[number]; hint: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <SegmentedControlItem ref={ref} value={pill.value} label={pill.label} icon={pill.icon} />
      {hint ? <Tooltip anchorRef={ref} content={pill.label} placement="below" touchTrigger="none" /> : null}
    </>
  );
}

export function LayoutPills({ display, urlState, settingsScope }: LayoutSwitchProps & { display: Display }) {
  const { apply } = useDisplayWriter(settingsScope, urlState);
  const ref = useRef<HTMLDivElement>(null);
  const compact = useCompactBar(ref);
  return (
    <SegmentedControl ref={ref} className="tessera-wi-layouts" label="Layout" size="sm" value={display.layout} onChange={(value) => isLayout(value) && apply({ layout: value })}>
      {PILLS.map((pill) => (
        <Pill key={pill.value} pill={pill} hint={compact && display.layout !== pill.value} />
      ))}
    </SegmentedControl>
  );
}
