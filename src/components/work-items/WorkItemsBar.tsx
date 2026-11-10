"use client";

/**
 * The work items screen's panel header content (docs/contracts/ui.md "Work items
 * screen"): ONE quiet row, then the filters row only when it is in use.
 * The row: the view's name and a quiet count, the layout pills (./LayoutPills.tsx),
 * and at the end the "Filter work items" toggle, the Display menu (which also holds
 * "Export…") and the primary "New work item". The filters row (the filter field and
 * "Advanced", ./FilterBar.tsx) is drawn while a filter, a search text or an
 * Advanced tree applies (it cannot be hidden then, the toggle shows pressed with an
 * accent dot), while a saved view's own bar needs it, or after the toggle (focus
 * goes into the field; closing, or Escape in the empty field, returns it to the
 * toggle). The toggle is not persisted and not in the URL: it is state here.
 */
import { useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Text } from "@astryxdesign/core/Text";
import { PanelBar } from "@/components/shell/PanelHeader";
import type { Display, Filters, GroupBy, RichFilters } from "@/lib/tessera/types";
import { AdvancedFilterIcon, PlusIcon } from "@/themes/catppuccin/icons";
import { hasActiveFilters } from "./clear-filters";
import { DisplayMenu } from "./DisplayMenu";
import { FilterBar } from "./FilterBar";
import { filterRowForced, filterRowShown } from "./filter-row";
import { LayoutPills } from "./LayoutPills";
import type { SettingsScope, UrlState } from "./types";

export type WorkItemsBarProps = {
  title: string;
  /** The count after the title; null hides it. */
  count: number | null;
  /** After the count (a view's lock icon). */
  titleAdornment?: ReactNode;
  /** Last item of the row's end, after "New work item" (a view's menu). */
  rowEnd?: ReactNode;
  /** Before the Filter toggle (the project list's "Save view"). */
  saveView?: ReactNode;
  /** The filters row's end slot (a saved view's own bar). It lives in the row, so the row stays drawn. */
  filtersEnd?: ReactNode;
  display: Display;
  urlState: UrlState;
  settingsScope: SettingsScope | null;
  hiddenGroupFields: readonly GroupBy[];
  crossProject: boolean;
  showLayoutSwitch: boolean;
  /** Null hides "New work item". */
  onCreate: (() => void) | null;
  onExport: () => void;
  filters: Filters;
  richFilters?: RichFilters | null;
  /** The list's total after filters, for the field's "N results". */
  resultCount: number;
};

export function WorkItemsBar({
  title,
  count,
  titleAdornment,
  rowEnd,
  saveView,
  filtersEnd,
  display,
  urlState,
  settingsScope,
  hiddenGroupFields,
  crossProject,
  showLayoutSwitch,
  onCreate,
  onExport,
  filters,
  richFilters,
  resultCount,
}: WorkItemsBarProps) {
  const rowId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [toggledOpen, setToggledOpen] = useState(false);
  const effectiveRich = richFilters === undefined ? (urlState.rich_filters ?? null) : richFilters;
  const filtersApply = hasActiveFilters(filters, effectiveRich);
  const pinnedByBar = filtersEnd !== undefined;
  const forced = filterRowForced(filters, effectiveRich, pinnedByBar);
  const shown = filterRowShown(forced, toggledOpen);

  const closeRow = () => {
    setToggledOpen(false);
    // The row unmounts with the field focused: hand the focus to the toggle first.
    toggleRef.current?.focus();
  };
  const onToggle = () => {
    if (forced) {
      // Filters apply (or a view's bar needs the row): it cannot hide, so the button takes the person to the field.
      document.getElementById(rowId)?.querySelector("input")?.focus();
      return;
    }
    if (toggledOpen) closeRow();
    else setToggledOpen(true);
  };

  return (
    <>
      <PanelBar
        size="subheader"
        canWrap
        className="tessera-wi-bar"
        start={
          <>
            <Text weight="medium" maxLines={1}>
              {title}
            </Text>
            {count === null ? null : (
              <Text color="secondary" className="tessera-wi-count">
                {String(count)}
              </Text>
            )}
            {titleAdornment}
            {showLayoutSwitch ? <LayoutPills display={display} urlState={urlState} settingsScope={settingsScope} /> : null}
          </>
        }
        end={
          <>
            {saveView}
            {pinnedByBar ? null : (
              <IconButton
                ref={toggleRef}
                variant={shown ? "secondary" : "ghost"}
                size="sm"
                label="Filter work items"
                icon={<AdvancedFilterIcon />}
                className="tessera-wi-filter-toggle"
                data-filters-active={filtersApply ? "true" : undefined}
                aria-expanded={shown}
                aria-controls={rowId}
                onClick={onToggle}
              />
            )}
            <DisplayMenu display={display} urlState={urlState} settingsScope={settingsScope} hiddenGroupFields={hiddenGroupFields} includeProject={crossProject} onExport={onExport} />
            {onCreate ? <Button variant="primary" size="sm" label="New work item" icon={<PlusIcon />} onClick={onCreate} tooltip="Press c" /> : null}
            {rowEnd}
          </>
        }
      />
      {shown ? (
        <PanelBar
          size="filters"
          canWrap
          hasDivider
          start={
            <FilterBar
              id={rowId}
              filters={filters}
              urlState={urlState}
              resultCount={resultCount}
              showProject={crossProject}
              richFilters={richFilters}
              hasAutoFocus={toggledOpen}
              animate={toggledOpen}
              onEscapeEmpty={forced ? undefined : closeRow}
            />
          }
          end={filtersEnd}
        />
      ) : null}
    </>
  );
}
