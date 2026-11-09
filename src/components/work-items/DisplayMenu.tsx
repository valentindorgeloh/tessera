"use client";

/**
 * Display menu and layout switch (docs/contracts/ui.md "Work items screen"):
 * the switch in the sub-header picks the layout; the menu holds grouping,
 * ordering, toggles and visible properties. Every change is written twice:
 * to the URL (`q`, display half) so the page re-renders with it, and to the
 * list's view settings (the project's, or a cycle's or module's in a scoped
 * list, decision 23) through `saveViewSettingsAction` so it survives a plain
 * navigation. Properties are always written as the full object; the engine
 * merges nested objects one level deep.
 *
 * A saved view's page passes `settingsScope={null}` (decision 32): its changes
 * live in the URL alone until "Update view", nothing is saved here and the
 * menu's reset reads "Reset to view" and only drops the URL's display half.
 * The option lists and the Group by patch come from ./display-options.ts.
 */
import { startTransition, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxList, CheckboxListItem } from "@astryxdesign/core/CheckboxList";
import { Popover } from "@astryxdesign/core/Popover";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Selector, type SelectorOptionData } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Switch } from "@astryxdesign/core/Switch";
import { useToast } from "@astryxdesign/core/Toast";
import { resetViewSettingsAction, saveViewSettingsAction } from "@/app/actions/views";
import { withSearchParam } from "@/components/detail/peek-url";
import { GROUPABLE_FIELDS, ORDER_BY_VALUES } from "@/lib/tessera/core/group";
import { CalendarLayoutSchema, GanttZoomSchema, LayoutSchema, SubGroupBySchema } from "@/lib/tessera/schemas";
import type { Display, DisplayProperties, GroupBy, Layout, OrderBy, SubGroupBy } from "@/lib/tessera/types";
import { CalendarIcon, GanttIcon, KanbanIcon, RowsIcon, SlidersIcon, TableIcon } from "@/themes/catppuccin/icons";
import type { CalendarView } from "./calendar-math";
import { groupByChoices, groupByPatch, orderByChoices, orderBySelectValue, subGroupChoices } from "./display-options";
import { useProject } from "./project-provider";
import type { SettingsScope, UrlState } from "./types";
import { encodeUrlState } from "./url-state";

export type LayoutSwitchProps = {
  /** Effective display (defaults, saved settings and URL merged). */
  display: Display;
  /** Decoded `q` param; the switch and the menu rewrite its `display` half. */
  urlState: UrlState;
  /**
   * View settings row that save and reset write: the project's, or the cycle's
   * or module's of a scoped list (decision 23). Never derived from the project
   * id here, so a cycle's or module's layout never lands on the project.
   * `null`: URL only (a saved view's page, decision 32); nothing is saved.
   */
  settingsScope: SettingsScope | null;
};

export type DisplayMenuProps = LayoutSwitchProps & {
  /** Fields left out of the group and sub-group options (a cycle list cannot group by cycle). */
  hiddenGroupFields?: readonly GroupBy[];
  /** A workspace or profile list can group by project. A project list cannot. */
  includeProject?: boolean;
};

const NO_HIDDEN_FIELDS: readonly GroupBy[] = [];

const NONE = "__none__";

/** Popover width: the selectors and the property list at a comfortable reading width. */
const MENU_WIDTH = 320;

const PROPERTY_LABELS: Record<keyof DisplayProperties, string> = {
  key: "Key",
  state: "State",
  priority: "Priority",
  labels: "Labels",
  cycle: "Cycle",
  modules: "Modules",
  assignees: "Assignees",
  estimate: "Estimate",
  start_date: "Start date",
  target_date: "Target date",
  sub_items_count: "Sub-items",
  links: "Links",
  created_at: "Created",
  updated_at: "Updated",
};

const PROPERTY_KEYS = Object.keys(PROPERTY_LABELS) as (keyof DisplayProperties)[];

function isGroupBy(value: string): value is GroupBy {
  return (GROUPABLE_FIELDS as readonly string[]).includes(value);
}
function isSubGroupBy(value: string): value is SubGroupBy {
  return (SubGroupBySchema.options as readonly string[]).includes(value);
}
function isOrderBy(value: string): value is OrderBy {
  return (ORDER_BY_VALUES as readonly string[]).includes(value);
}
function isLayout(value: string): value is Layout {
  return (LayoutSchema.options as readonly string[]).includes(value);
}
function isCalendarView(value: string): value is CalendarView {
  return (CalendarLayoutSchema.options as readonly string[]).includes(value);
}
function isGanttZoom(value: string): value is "week" | "month" | "quarter" {
  return (GanttZoomSchema.options as readonly string[]).includes(value);
}

/**
 * Writes a display patch to the URL and the saved view settings of
 * `settingsScope` (`apply`), or drops both back to the defaults (`reset`).
 * With a null scope only the URL changes. Shared by the layout switch and the
 * display menu.
 */
export function useDisplayWriter(settingsScope: SettingsScope | null, urlState: UrlState) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toast = useToast();

  const writeUrl = (nextDisplay: Partial<Display> | undefined) => {
    const state: UrlState = {};
    if (urlState.filters) state.filters = urlState.filters;
    if (urlState.rich_filters !== undefined) state.rich_filters = urlState.rich_filters;
    if (nextDisplay && Object.keys(nextDisplay).length > 0) state.display = nextDisplay;
    // Only `q` changes: the other params (an open `peek`) stay.
    router.replace(withSearchParam(pathname, searchParams, "q", encodeUrlState(state) || null), { scroll: false });
  };

  const apply = (patch: Partial<Display>) => {
    writeUrl({ ...(urlState.display ?? {}), ...patch });
    if (settingsScope === null) return;
    startTransition(async () => {
      const result = await saveViewSettingsAction({ ...settingsScope, display: patch });
      if (!result.ok) toast({ type: "error", body: `Could not save the view settings: ${result.message}` });
    });
  };

  const reset = () => {
    writeUrl(undefined);
    if (settingsScope === null) return;
    startTransition(async () => {
      const result = await resetViewSettingsAction(settingsScope);
      if (!result.ok) toast({ type: "error", body: `Could not reset the view settings: ${result.message}` });
    });
  };

  return { apply, reset };
}

/**
 * The layout switch of the work items sub-header: list, board, table,
 * calendar and gantt as icon segments. Workspace views do not mount it
 * (decision 18: those views stay table-only).
 */
export function LayoutSwitch({ display, urlState, settingsScope }: LayoutSwitchProps) {
  const { apply } = useDisplayWriter(settingsScope, urlState);
  return (
    <SegmentedControl label="Layout" size="sm" value={display.layout} onChange={(value) => isLayout(value) && apply({ layout: value })}>
      <SegmentedControlItem value="list" label="List" isLabelHidden icon={<RowsIcon />} />
      <SegmentedControlItem value="board" label="Board" isLabelHidden icon={<KanbanIcon />} />
      <SegmentedControlItem value="table" label="Table" isLabelHidden icon={<TableIcon />} />
      <SegmentedControlItem value="calendar" label="Calendar" isLabelHidden icon={<CalendarIcon />} />
      <SegmentedControlItem value="gantt" label="Gantt" isLabelHidden icon={<GanttIcon />} />
    </SegmentedControl>
  );
}

export function DisplayMenu({ display, urlState, settingsScope, hiddenGroupFields = NO_HIDDEN_FIELDS, includeProject = false }: DisplayMenuProps) {
  const { bundle } = useProject();
  const [isOpen, setOpen] = useState(false);
  const { apply, reset } = useDisplayWriter(settingsScope, urlState);

  const toOption = (choice: { value: string | null; label: string }): SelectorOptionData => ({ value: choice.value ?? NONE, label: choice.label });
  const groupOptions = groupByChoices(bundle.project, hiddenGroupFields, includeProject).map(toOption);
  const subGroupOptions = subGroupChoices(display, bundle.project, hiddenGroupFields).map(toOption);
  const orderOptions: SelectorOptionData[] = orderByChoices().filter((choice) => bundle.project.estimates_enabled || !choice.value.endsWith("estimate"));

  const visibleProperties = PROPERTY_KEYS.filter((key) => {
    if (key === "cycle") return bundle.project.cycles_enabled;
    if (key === "modules") return bundle.project.modules_enabled;
    if (key === "estimate") return bundle.project.estimates_enabled;
    return true;
  });
  const checkedProperties = visibleProperties.filter((key) => display.properties[key]);

  const changeGroup = (value: string) => {
    const { group_by, sub_group_by } = groupByPatch(display, isGroupBy(value) ? value : null);
    apply(sub_group_by === undefined ? { group_by } : { group_by, sub_group_by });
  };

  const hidesGrouping = display.layout === "calendar" || display.layout === "gantt";
  const content = (
    <VStack gap={4} padding={4} className="tessera-wi-display">
      {display.layout === "calendar" ? (
        <>
          <SegmentedControl
            label="Zoom"
            size="sm"
            value={display.calendar.layout}
            onChange={(value) => isCalendarView(value) && apply({ calendar: { ...display.calendar, layout: value } })}
          >
            <SegmentedControlItem value="week" label="Week" />
            <SegmentedControlItem value="month" label="Month" />
            <SegmentedControlItem value="quarter" label="Quarter" />
          </SegmentedControl>
          <Switch label="Show weekends" size="sm" value={display.calendar.show_weekends} onChange={(checked) => apply({ calendar: { ...display.calendar, show_weekends: checked } })} />
        </>
      ) : null}
      {display.layout === "gantt" ? (
        <>
          <SegmentedControl
            label="Zoom"
            size="sm"
            value={display.gantt.zoom}
            onChange={(value) => isGanttZoom(value) && apply({ gantt: { ...display.gantt, zoom: value } })}
          >
            <SegmentedControlItem value="week" label="Week" />
            <SegmentedControlItem value="month" label="Month" />
            <SegmentedControlItem value="quarter" label="Quarter" />
          </SegmentedControl>
          <Switch
            label="Show dependencies"
            size="sm"
            value={display.gantt.show_relations}
            onChange={(checked) => apply({ gantt: { ...display.gantt, show_relations: checked } })}
          />
        </>
      ) : null}
      {hidesGrouping ? null : <Selector label="Group by" size="sm" options={groupOptions} value={display.group_by ?? NONE} onChange={changeGroup} />}
      {display.layout === "board" ? (
        <Selector
          label="Sub-group by"
          size="sm"
          options={subGroupOptions}
          value={display.sub_group_by ?? NONE}
          onChange={(value) => apply({ sub_group_by: isSubGroupBy(value) ? value : null })}
        />
      ) : null}
      <Selector
        label="Order by"
        size="sm"
        options={orderOptions}
        value={orderBySelectValue(display.order_by)}
        onChange={(value) => isOrderBy(value) && apply({ order_by: value })}
      />
      {hidesGrouping ? null : <Switch label="Show empty groups" size="sm" value={display.show_empty_groups} onChange={(checked) => apply({ show_empty_groups: checked })} />}
      <Switch label="Show sub-items" size="sm" value={display.sub_items} onChange={(checked) => apply({ sub_items: checked })} />
      <CheckboxList
        label="Properties"
        density="compact"
        value={checkedProperties}
        onChange={(values) => {
          const properties = { ...display.properties };
          for (const key of visibleProperties) properties[key] = values.includes(key);
          apply({ properties });
        }}
      >
        {visibleProperties.map((key) => (
          <CheckboxListItem key={key} value={key} label={PROPERTY_LABELS[key]} />
        ))}
      </CheckboxList>
      <HStack hAlign="end">
        <Button variant="ghost" size="sm" label={settingsScope === null ? "Reset to view" : "Reset to defaults"} onClick={reset} />
      </HStack>
    </VStack>
  );

  return (
    <Popover isOpen={isOpen} onOpenChange={setOpen} content={content} label="Display options" placement="below" alignment="end" width={MENU_WIDTH} hasAutoFocus>
      <Button variant="secondary" size="sm" label="Display" icon={<SlidersIcon />} />
    </Popover>
  );
}
