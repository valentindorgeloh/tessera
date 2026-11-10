"use client";

/**
 * The column furniture of the work items table (TableLayout.tsx): the header with the property's icon (`Head`), the
 * editable column keys and the cell click that opens a cell's editor (`openCellEditor`). The cells themselves and
 * `buildColumns` live in ./table-cells.tsx (memo cells, decision 136). At rest a cell is its value (a dot and a name, a
 * tinted pill, avatars, plain text); the property controls draw as chips until the row arms (./properties/arming.tsx)
 * and then swap in the real Astryx controls, in the same box. The whole cell is the click target of an editable
 * property; labels, assignees and modules have no patch field and are plain values.
 */
import type { MouseEvent, ReactNode } from "react";
import { Icon, type IconType } from "@astryxdesign/core/Icon";
import { Text } from "@astryxdesign/core/Text";

type ColumnKey = "key" | "name" | "project" | "state" | "priority" | "assignees" | "labels" | "cycle" | "modules" | "estimate" | "start_date" | "target_date" | "created_at" | "updated_at";

/** Columns whose cell holds an editor: a click anywhere in the cell opens it and does not open the row. */
export const EDITABLE: ReadonlySet<string> = new Set<ColumnKey>(["state", "priority", "cycle", "estimate", "start_date", "target_date"]);

/** A column header: the property's small icon before its label (the registry's, never a new one). */
export function Head({ icon, children }: { icon?: IconType; children: string }): ReactNode {
  return (
    <Text type="inherit" className="tessera-table-head">
      {icon ? <Icon icon={icon} size="sm" color="inherit" /> : null}
      {children}
    </Text>
  );
}

/** What can take a click inside a cell: the cell's own click must not reach it twice. */
const OWN_CLICK = "button, a, input, [role='combobox'], [role='option'], [role='listbox'], [role='dialog'], [popover]";
/** The control a cell opens: its chip, the armed selector's trigger or the date button. */
const EDITOR = "button:not([disabled]):not([aria-disabled='true']):not(.astryx-input-clear-button), [role='combobox']:not([aria-disabled='true'])";

/**
 * A click on an editable cell that did not land on its control (the padding, the empty part of the cell) opens the
 * editor all the same: the control's own trigger is clicked for the pointer. The click never opens the row. A click on
 * the control itself, or in a layer it opened (a React portal bubbles here too), is the control's own.
 */
export function openCellEditor(event: MouseEvent<HTMLElement>): void {
  event.stopPropagation();
  const cell = event.currentTarget;
  const target = event.target;
  if (!(target instanceof Element) || !cell.contains(target)) return;
  const own = target.closest(OWN_CLICK);
  if (own !== null && cell.contains(own)) return;
  cell.querySelector<HTMLElement>(EDITOR)?.click();
}
