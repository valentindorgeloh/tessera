/**
 * `describe_filters` payload (docs/contracts/ai.md): the enums, the type of
 * every `Filters` field, the allowed values of every `Display` key and three
 * worked examples, so an agent can build filters and display settings without
 * reading the schema. Everything is derived from the zod schemas in
 * schemas.ts at first use, so a new enum value or filter field shows up here
 * without a second edit.
 */
import { z } from "zod";
import { USER_ACTOR_ID } from "../actors";
import {
  CalendarLayoutSchema,
  DEFAULT_DISPLAY,
  DisplaySchema,
  FiltersSchema,
  GroupBySchema,
  IntakeStatusSchema,
  LayoutSchema,
  ModuleStatusSchema,
  OrderBySchema,
  PaletteColorSchema,
  PrioritySchema,
  RelationTypeSchema,
  StateGroupSchema,
  SubGroupBySchema,
  WorkItemTypeFilterSchema,
} from "../schemas";
import type { CalendarDisplay, Display, Filters, GroupBy, Layout, OrderBy, SubGroupBy, WorkItemTypeFilter } from "../types";
import { DISPLAY_PROPERTY_KEYS, DisplayPatchSchema, type DisplayPatchInput, type DisplayPropertyKey } from "../view-settings";

export type FilterFieldType = "ids" | "enum" | "date" | "text" | "boolean";

/** Which entity an `ids` filter refers to. */
export type FilterEntityType = "state" | "label" | "actor" | "cycle" | "module" | "project";

export type FilterFieldInfo = {
  type: FilterFieldType;
  of?: FilterEntityType;
  description: string;
};

export type DescribeEnums = {
  state_group: string[];
  priority: string[];
  module_status: string[];
  relation_type: string[];
  intake_status: string[];
  layout: string[];
  palette_color: string[];
};

/** Allowed values per `Display` key (null and booleans listed where the schema accepts them). */
export type DescribeDisplay = {
  layout: Layout[];
  group_by: GroupBy[];
  sub_group_by: SubGroupBy[];
  order_by: OrderBy[];
  type: WorkItemTypeFilter[];
  show_empty_groups: boolean[];
  sub_items: boolean[];
  calendar: { layout: CalendarDisplay["layout"][]; show_weekends: boolean[] };
  properties: DisplayPropertyKey[];
};

export type FilterExample = {
  title: string;
  filters: Filters;
  display: DisplayPatchInput;
};

export type DescribeFiltersPayload = {
  enums: DescribeEnums;
  filters: Record<keyof Filters, FilterFieldInfo>;
  display: DescribeDisplay;
  /** What a list shows when nothing is saved; a display patch merges over it. */
  default_display: Display;
  examples: FilterExample[];
};

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/** Entity behind each id-list filter; `parent` holds work item ids, which the contract's `of` vocabulary does not name. */
const ID_FILTER_ENTITY: Partial<Record<keyof Filters, FilterEntityType>> = {
  state: "state",
  labels: "label",
  cycle: "cycle",
  module: "module",
  assignees: "actor",
  created_by: "actor",
  subscriber: "actor",
  mentions: "actor",
  project: "project",
};

/** Any schema; the wrappers' `unwrap()` is typed with the core schema type, so the walk uses it too. */
type AnySchema = z.core.$ZodType;

/** Strips optional / nullable / default wrappers so the inner schema can be classified. */
function unwrap(schema: AnySchema): AnySchema {
  let current = schema;
  for (;;) {
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable || current instanceof z.ZodDefault) {
      current = current.unwrap();
    } else {
      return current;
    }
  }
}

function classify(field: string, schema: AnySchema): FilterFieldType {
  const inner = unwrap(schema);
  if (inner instanceof z.ZodArray) return unwrap(inner.element) instanceof z.ZodEnum ? "enum" : "ids";
  if (inner instanceof z.ZodEnum) return "enum";
  if (inner instanceof z.ZodBoolean) return "boolean";
  if (inner instanceof z.ZodString) return "text";
  // DateFilterSchema is the only object-valued filter.
  if (inner instanceof z.ZodObject) return "date";
  throw new Error(`describe_filters: cannot classify filter field ${field}`);
}

function describeFilterFields(): Record<keyof Filters, FilterFieldInfo> {
  const out: Partial<Record<keyof Filters, FilterFieldInfo>> = {};
  for (const [name, schema] of Object.entries(FiltersSchema.shape)) {
    const key = name as keyof Filters;
    const info: FilterFieldInfo = { type: classify(key, schema), description: schema.description ?? "" };
    const of = ID_FILTER_ENTITY[key];
    if (info.type === "ids" && of !== undefined) info.of = of;
    out[key] = info;
  }
  return out as Record<keyof Filters, FilterFieldInfo>;
}

// ---------------------------------------------------------------------------
// Display and enums
// ---------------------------------------------------------------------------

/** Every key of DisplaySchema must appear; the intersection makes a missing key a type error. */
function describeDisplay(): DescribeDisplay {
  const display: DescribeDisplay & Record<keyof Display, unknown> = {
    layout: [...LayoutSchema.options],
    group_by: [...GroupBySchema.options],
    sub_group_by: [...SubGroupBySchema.options],
    order_by: [...OrderBySchema.options],
    type: [null, ...WorkItemTypeFilterSchema.unwrap().options],
    show_empty_groups: [true, false],
    sub_items: [true, false],
    calendar: { layout: [...CalendarLayoutSchema.options], show_weekends: [true, false] },
    properties: [...DISPLAY_PROPERTY_KEYS],
  };
  return display;
}

function describeEnums(): DescribeEnums {
  return {
    state_group: [...StateGroupSchema.options],
    priority: [...PrioritySchema.options],
    module_status: [...ModuleStatusSchema.options],
    relation_type: [...RelationTypeSchema.options],
    intake_status: [...IntakeStatusSchema.options],
    layout: [...LayoutSchema.options],
    palette_color: [...PaletteColorSchema.options],
  };
}

// ---------------------------------------------------------------------------
// Examples (checked against the schemas when the payload is built)
// ---------------------------------------------------------------------------

const OPEN_GROUPS: Filters["state_group"] = ["backlog", "unstarted", "started"];

const EXAMPLES: FilterExample[] = [
  {
    title: "Open high-priority items assigned to me",
    filters: { priority: ["urgent", "high"], state_group: OPEN_GROUPS, assignees: [USER_ACTOR_ID] },
    display: { layout: "list", order_by: "priority" },
  },
  {
    title: "Overdue work on a board by state",
    filters: { target_date: { op: "before", relative: "today" }, state_group: OPEN_GROUPS },
    display: { layout: "board", group_by: "state", order_by: "target_date" },
  },
  {
    title: "Due in the next two weeks, grouped by assignee, top-level items only",
    filters: { target_date: { op: "between", relative: "2w" }, sub_items: false },
    display: { layout: "table", group_by: "assignees", order_by: "target_date", properties: { estimate: false, links: false } },
  },
];

function checkedExamples(): FilterExample[] {
  return EXAMPLES.map((example) => ({
    title: example.title,
    filters: FiltersSchema.parse(example.filters),
    display: DisplayPatchSchema.parse(example.display),
  }));
}

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

let cached: DescribeFiltersPayload | null = null;

/** The payload the `describe_filters` tool returns; built once per process. */
export function describeFilters(): DescribeFiltersPayload {
  if (cached === null) {
    cached = {
      enums: describeEnums(),
      filters: describeFilterFields(),
      display: describeDisplay(),
      default_display: DisplaySchema.parse(DEFAULT_DISPLAY),
      examples: checkedExamples(),
    };
  }
  return cached;
}
