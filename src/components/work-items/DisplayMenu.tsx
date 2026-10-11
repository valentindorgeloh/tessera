"use client";

/**
 * Display menu (docs/contracts/ui.md "Work items screen"): layout, grouping,
 * ordering, toggles and visible properties. Every change is written twice:
 * to the URL (`q`, display half) so the page re-renders with it, and to the
 * project's view settings through `saveViewSettingsAction` so it survives a
 * plain navigation. Properties are always written as the full object; the
 * engine merges nested objects one level deep.
 */
import { startTransition, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxList, CheckboxListItem } from "@astryxdesign/core/CheckboxList";
import { Popover } from "@astryxdesign/core/Popover";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Selector, type SelectorOptionData } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { resetViewSettingsAction, saveViewSettingsAction } from "@/app/actions/views";
import { GROUPABLE_FIELDS, ORDER_BY_VALUES, type OrderableField } from "@/lib/tessera/core/group";
import { LayoutSchema, SubGroupBySchema } from "@/lib/tessera/schemas";
import type { Display, DisplayProperties, GroupBy, Layout, OrderBy, SubGroupBy } from "@/lib/tessera/types";
import { CalendarIcon, GanttIcon, KanbanIcon, RowsIcon, SlidersIcon, TableIcon } from "@/themes/paper/icons";
import { useProject } from "./project-provider";
import type { UrlState } from "./types";
import { encodeUrlState } from "./url-state";

export type DisplayMenuProps = {
  projectId: string;
  /** Effective display (defaults, saved settings and URL merged). */
  display: Display;
  /** Decoded `q` param; the menu rewrites its `display` half. */
  urlState: UrlState;
};

const NONE = "__none__";

const FIELD_LABELS: Record<GroupBy, string> = {
  state: "State",
  state_group: "State group",
  priority: "Priority",
  labels: "Labels",
  cycle: "Cycle",
  module: "Module",
  assignees: "Assignees",
  created_by: "Created by",
  start_date: "Start date",
  target_date: "Target date",
  created_at: "Created",
  project: "Project",
};

const ORDER_LABELS: Record<OrderableField, string> = {
  sort_order: "Manual",
  created_at: "Created",
  updated_at: "Updated",
  priority: "Priority",
  start_date: "Start date",
  target_date: "Target date",
  name: "Name",
  sequence_id: "Key",
  estimate: "Estimate",
};

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

function orderLabel(value: OrderBy): string {
  const descending = value.startsWith("-");
  const field = (descending ? value.slice(1) : value) as OrderableField;
  if (field === "sort_order") return ORDER_LABELS[field];
  return `${ORDER_LABELS[field]} (${descending ? "newest first" : "oldest first"})`;
}

export function DisplayMenu({ projectId, display, urlState }: DisplayMenuProps) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const { bundle } = useProject();
  const [isOpen, setOpen] = useState(false);

  const writeUrl = (nextDisplay: Partial<Display> | undefined) => {
    const state: UrlState = {};
    if (urlState.filters) state.filters = urlState.filters;
    if (nextDisplay && Object.keys(nextDisplay).length > 0) state.display = nextDisplay;
    const q = encodeUrlState(state);
    router.replace(q ? `${pathname}?q=${q}` : pathname, { scroll: false });
  };

  const apply = (patch: Partial<Display>) => {
    writeUrl({ ...(urlState.display ?? {}), ...patch });
    startTransition(async () => {
      const result = await saveViewSettingsAction({ scope_type: "project", scope_id: projectId, display: patch });
      if (!result.ok) toast({ type: "error", body: `Could not save the view settings: ${result.message}` });
    });
  };

  const reset = () => {
    writeUrl(undefined);
    startTransition(async () => {
      const result = await resetViewSettingsAction({ scope_type: "project", scope_id: projectId });
      if (!result.ok) toast({ type: "error", body: `Could not reset the view settings: ${result.message}` });
    });
  };

  const groupOptions: SelectorOptionData[] = [
    { value: NONE, label: "None" },
    ...GROUPABLE_FIELDS.filter((field) => field !== "project")
      .filter((field) => (field === "cycle" ? bundle.project.cycles_enabled : field === "module" ? bundle.project.modules_enabled : true))
      .map((field) => ({ value: field, label: FIELD_LABELS[field] })),
  ];
  const subGroupOptions: SelectorOptionData[] = [
    { value: NONE, label: "None" },
    ...SubGroupBySchema.options
      .filter((field) => (field === "cycle" ? bundle.project.cycles_enabled : field === "module" ? bundle.project.modules_enabled : true))
      .map((field) => ({ value: field, label: FIELD_LABELS[field] })),
  ];
  const orderOptions: SelectorOptionData[] = ORDER_BY_VALUES.filter((value) => bundle.project.estimates_enabled || !value.endsWith("estimate")).map(
    (value) => ({ value, label: orderLabel(value) }),
  );

  const visibleProperties = PROPERTY_KEYS.filter((key) => {
    if (key === "cycle") return bundle.project.cycles_enabled;
    if (key === "modules") return bundle.project.modules_enabled;
    if (key === "estimate") return bundle.project.estimates_enabled;
    return true;
  });
  const checkedProperties = visibleProperties.filter((key) => display.properties[key]);

  const content = (
    <VStack gap={4} padding={4} className="tessera-wi-display">
      <VStack gap={1}>
        <SegmentedControl label="Layout" size="sm" layout="fill" value={display.layout} onChange={(value) => isLayout(value) && apply({ layout: value })}>
          <SegmentedControlItem value="list" label="List" icon={<RowsIcon />} />
          <SegmentedControlItem value="board" label="Board" icon={<KanbanIcon />} />
          <SegmentedControlItem value="table" label="Table" icon={<TableIcon />} />
          <SegmentedControlItem value="calendar" label="Calendar" icon={<CalendarIcon />} isDisabled />
          <SegmentedControlItem value="gantt" label="Gantt" icon={<GanttIcon />} isDisabled />
        </SegmentedControl>
        <Text type="supporting" color="secondary">
          Calendar and Gantt arrive in P10.
        </Text>
      </VStack>
      <Selector
        label="Group by"
        size="sm"
        options={groupOptions}
        value={display.group_by ?? NONE}
        onChange={(value) => apply({ group_by: isGroupBy(value) ? value : null })}
      />
      {display.layout === "board" ? (
        <Selector
          label="Sub-group by"
          size="sm"
          options={subGroupOptions}
          value={display.sub_group_by ?? NONE}
          onChange={(value) => apply({ sub_group_by: isSubGroupBy(value) ? value : null })}
        />
      ) : null}
      <Selector label="Order by" size="sm" options={orderOptions} value={display.order_by} onChange={(value) => isOrderBy(value) && apply({ order_by: value })} />
      <Switch label="Show empty groups" size="sm" value={display.show_empty_groups} onChange={(checked) => apply({ show_empty_groups: checked })} />
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
        <Button variant="ghost" size="sm" label="Reset to defaults" onClick={reset} />
      </HStack>
    </VStack>
  );

  return (
    <Popover isOpen={isOpen} onOpenChange={setOpen} content={content} label="Display options" placement="below" alignment="end" hasAutoFocus>
      <Button variant="secondary" size="sm" label="Display" icon={<SlidersIcon />} />
    </Popover>
  );
}
