/**
 * Tessera enums and small value schemas (zod 4). Client-safe: no database imports.
 *
 * Enums live here, never as SQL CHECK constraints (plan decision 5), so a new
 * value is a code change plus, where needed, a data migration.
 */
import { z } from "zod";
import { GROUPABLE_FIELDS, ORDER_BY_VALUES } from "./core/group";

export const ActorKindSchema = z.enum(["user", "assistant", "agent", "system"]);

/** Plane-compatible state groups; `triage` is hidden and exists only when Intake is enabled. */
export const StateGroupSchema = z.enum(["backlog", "unstarted", "started", "completed", "cancelled", "triage"]);

export const PrioritySchema = z.enum(["urgent", "high", "medium", "low", "none"]);

export const ModuleStatusSchema = z.enum(["backlog", "planned", "in_progress", "paused", "completed", "cancelled"]);

/** Derived from dates; never stored. */
export const CycleStatusSchema = z.enum(["current", "upcoming", "completed", "draft"]);

/** Canonical relation types; inverses (blocking, start_after, ...) are computed at read time. */
export const RelationTypeSchema = z.enum([
  "blocked_by",
  "relates_to",
  "duplicate",
  "start_before",
  "finish_before",
  "implemented_by",
]);

export const IntakeStatusSchema = z.enum(["pending", "declined", "snoozed", "accepted", "duplicate"]);
export const IntakeSourceSchema = z.enum(["in_app", "assistant", "mcp"]);

export const EstimateTypeSchema = z.enum(["points", "categories", "time"]);

/** Colours are palette keys rendered through theme tokens, never hex (decision 22). */
export const PaletteColorSchema = z.enum(["red", "orange", "yellow", "green", "teal", "cyan", "blue", "purple", "pink", "gray"]);

export const LayoutSchema = z.enum(["list", "board", "table", "calendar", "gantt"]);

export const PageAccessSchema = z.enum(["public", "private"]);

export const ViewSettingsScopeSchema = z.enum(["project", "cycle", "module", "workspace", "profile", "archived", "draft"]);

export const FavoriteEntityTypeSchema = z.enum(["project", "cycle", "module", "view", "page"]);

/** `^[A-Z][A-Z0-9]{1,11}$`, uppercased by the service before validation (decision 3). */
export const PROJECT_IDENTIFIER_PATTERN = /^[A-Z][A-Z0-9]{1,11}$/;
export const ProjectIdentifierSchema = z.string().regex(PROJECT_IDENTIFIER_PATTERN, "2 to 12 characters, A-Z and 0-9, starting with a letter");

/** Human key `<identifier>-<sequence>` such as WEB-12; computed, never stored. */
export const WORK_ITEM_KEY_PATTERN = /^([A-Z][A-Z0-9]{1,11})-(\d+)$/;

/** Calendar date `YYYY-MM-DD` (decision 6). */
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

/** ISO-8601 UTC timestamp as stored in every *_at column. */
export const IsoTimestampSchema = z.iso.datetime({ offset: false });

/** UUIDv7 text id used by every entity table. */
export const IdSchema = z.uuid();

// ---------------------------------------------------------------------------
// JSON column shapes (docs/contracts/schema.md "JSON shapes"). Every field is
// described in one sentence because the assistant and MCP clients read them.
// ---------------------------------------------------------------------------
export const IdListSchema = z.array(IdSchema).describe("List of entity ids.");

/** `{ icon, color }` shown next to projects, views and pages. */
export const LogoSchema = z.object({
  icon: z.string().min(1).describe("Phosphor icon name, e.g. Rocket."),
  color: PaletteColorSchema.describe("Palette colour key for the icon."),
});

export const DateFilterOpSchema = z.enum(["before", "after", "between"]);
export const DateFilterRelativeSchema = z.enum(["today", "1w", "2w", "1m"]);

/** A date condition on one column: absolute bounds, or a relative window from today. */
export const DateFilterSchema = z.object({
  op: DateFilterOpSchema.describe("before, after or between."),
  from: IsoDateSchema.optional().describe("Lower bound YYYY-MM-DD (after, between)."),
  to: IsoDateSchema.optional().describe("Upper bound YYYY-MM-DD (before, between)."),
  relative: DateFilterRelativeSchema.optional().describe("Window relative to today; overrides from/to when set."),
});

/** `null` = all items, `active` = unstarted/started, `backlog` = backlog group only. */
export const WorkItemTypeFilterSchema = z.enum(["active", "backlog"]).nullable();

/** Plane-shaped list filters; every key is optional and keys combine with AND. */
export const FiltersSchema = z.object({
  state: IdListSchema.optional().describe("State ids."),
  state_group: z.array(StateGroupSchema).optional().describe("State groups."),
  priority: z.array(PrioritySchema).optional().describe("Priorities."),
  labels: IdListSchema.optional().describe("Label ids; an item matches when it carries any of them."),
  cycle: IdListSchema.optional().describe("Cycle ids."),
  module: IdListSchema.optional().describe("Module ids."),
  parent: IdListSchema.optional().describe("Parent work item ids."),
  assignees: IdListSchema.optional().describe("Assignee actor ids."),
  created_by: IdListSchema.optional().describe("Creator actor ids."),
  subscriber: IdListSchema.optional().describe("Subscriber actor ids."),
  mentions: IdListSchema.optional().describe("Mentioned actor ids."),
  project: IdListSchema.optional().describe("Project ids; only meaningful for workspace views."),
  search: z.string().optional().describe("Full-text search over name and description."),
  start_date: DateFilterSchema.optional().describe("Condition on start_date."),
  target_date: DateFilterSchema.optional().describe("Condition on target_date."),
  created_at: DateFilterSchema.optional().describe("Condition on created_at."),
  updated_at: DateFilterSchema.optional().describe("Condition on updated_at."),
  completed_at: DateFilterSchema.optional().describe("Condition on completed_at."),
  type: WorkItemTypeFilterSchema.optional().describe("null for all, active or backlog."),
  sub_items: z.boolean().optional().describe("Include sub-items (items with a parent)."),
  archived: z.boolean().optional().describe("Include archived items."),
  start_target_date: z.boolean().optional().describe("Only items with both dates (gantt)."),
});

export const RichFilterFieldSchema = z.enum([
  "state",
  "state_group",
  "priority",
  "labels",
  "cycle",
  "module",
  "parent",
  "assignees",
  "created_by",
  "subscriber",
  "mentions",
  "project",
  "name",
  "start_date",
  "target_date",
  "created_at",
  "updated_at",
  "completed_at",
  "estimate_point",
]);

export const RichFilterOpSchema = z.enum(["eq", "neq", "in", "not_in", "is_null", "is_not_null", "contains", "before", "after", "between"]);

export const RichFilterValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string()), DateFilterSchema]);

/** Leaf of the rich filter tree: one field, one operator, one value. */
export const RichFilterConditionSchema = z.object({
  field: RichFilterFieldSchema.describe("Field the condition applies to."),
  op: RichFilterOpSchema.describe("Comparison operator."),
  value: RichFilterValueSchema.optional().describe("Comparison value; omitted for is_null and is_not_null."),
});

export type RichFilterCondition = z.infer<typeof RichFilterConditionSchema>;

/** Recursive AND / OR / NOT tree over conditions (P10). */
export type RichFilters = { and: RichFilters[] } | { or: RichFilters[] } | { not: RichFilters } | RichFilterCondition;

/**
 * The recursive reference. Its getter returns the one hoisted node union
 * below, so `z.toJSONSchema` meets the same instances on every visit and
 * emits a `$ref` instead of recursing forever (with `io: "input"` zod walks
 * the getter result first, so a getter that rebuilt the union would never
 * hit its seen-set). Descriptions sit on the node objects and the leaf
 * fields, never on this reference: `.describe()` clones a schema and a clone
 * breaks the cycle.
 */
export const RichFiltersSchema: z.ZodType<RichFilters> = z.lazy(() => RichFilterNodeSchema);

const RichFilterAndSchema = z.object({ and: z.array(RichFiltersSchema).describe("All nodes must match.") });
const RichFilterOrSchema = z.object({ or: z.array(RichFiltersSchema).describe("Any node may match.") });
const RichFilterNotSchema = z.object({ not: RichFiltersSchema }).describe("The node must not match.");

const RichFilterNodeSchema = z.union([RichFilterAndSchema, RichFilterOrSchema, RichFilterNotSchema, RichFilterConditionSchema]);

export const GroupBySchema = z.enum(GROUPABLE_FIELDS);
export const SubGroupBySchema = z.enum(["state", "state_group", "priority", "labels", "cycle", "module", "assignees", "created_by", "created_at", "target_date"]);
export const OrderBySchema = z.enum(ORDER_BY_VALUES);
export const CalendarLayoutSchema = z.enum(["month", "week"]);

/** Which columns and badges a layout shows. */
export const DisplayPropertiesSchema = z.object({
  key: z.boolean().default(true).describe("Show the WEB-12 key."),
  state: z.boolean().default(true).describe("Show the state."),
  priority: z.boolean().default(true).describe("Show the priority."),
  labels: z.boolean().default(true).describe("Show labels."),
  cycle: z.boolean().default(true).describe("Show the cycle."),
  modules: z.boolean().default(true).describe("Show modules."),
  assignees: z.boolean().default(true).describe("Show assignees."),
  estimate: z.boolean().default(true).describe("Show the estimate point."),
  start_date: z.boolean().default(true).describe("Show the start date."),
  target_date: z.boolean().default(true).describe("Show the target date."),
  sub_items_count: z.boolean().default(true).describe("Show the number of sub-items."),
  links: z.boolean().default(true).describe("Show the number of links."),
  created_at: z.boolean().default(false).describe("Show the creation time."),
  updated_at: z.boolean().default(false).describe("Show the last update time."),
});

export const CalendarDisplaySchema = z.object({
  layout: CalendarLayoutSchema.default("month").describe("Month or week grid."),
  show_weekends: z.boolean().default(true).describe("Show Saturday and Sunday columns."),
});

/** Layout, grouping, ordering and visible properties of a list (saved per view and per scope). */
export const DisplaySchema = z.object({
  layout: LayoutSchema.default("list").describe("list, board, table, calendar or gantt."),
  group_by: GroupBySchema.nullable().default(null).describe("Field to group by, or null for a flat list."),
  sub_group_by: SubGroupBySchema.nullable().default(null).describe("Second grouping axis on the board, or null."),
  order_by: OrderBySchema.default("sort_order").describe("Sort field; prefix - for descending."),
  type: WorkItemTypeFilterSchema.default(null).describe("null for all, active or backlog."),
  show_empty_groups: z.boolean().default(true).describe("Keep groups with no items visible."),
  sub_items: z.boolean().default(true).describe("Show sub-items in the list."),
  calendar: CalendarDisplaySchema.default({ layout: "month", show_weekends: true }).describe("Calendar layout options."),
  properties: DisplayPropertiesSchema.default(() => DisplayPropertiesSchema.parse({})).describe("Which properties each item shows."),
});

export const DEFAULT_DISPLAY_PROPERTIES = DisplayPropertiesSchema.parse({});
export const DEFAULT_DISPLAY = DisplaySchema.parse({});

export const ProgressCountsSchema = z.object({
  total: z.number().int().nonnegative().describe("All items counted."),
  completed: z.number().int().nonnegative().describe("Items in the completed group."),
  cancelled: z.number().int().nonnegative().describe("Items in the cancelled group."),
  started: z.number().int().nonnegative().describe("Items in the started group."),
  unstarted: z.number().int().nonnegative().describe("Items in the unstarted group."),
  backlog: z.number().int().nonnegative().describe("Items in the backlog group."),
});

/** Progress of a cycle, by count and optionally by estimate points; frozen as `progress_snapshot` on transfer. */
export const CycleProgressSchema = ProgressCountsSchema.extend({
  by_state: z.record(z.string(), z.number().int()).describe("Item count per state id."),
  by_label: z.record(z.string(), z.number().int()).describe("Item count per label id."),
  by_assignee: z.record(z.string(), z.number().int()).describe("Item count per assignee actor id."),
  points: ProgressCountsSchema.optional().describe("Same counts in estimate points when an estimate system is active."),
  completion_chart: z.record(IsoDateSchema, z.number().int()).describe("Pending items per day for the burndown chart."),
});

/** Free-form metadata stored next to a link (favicon, title fetched later, ...). */
export const LinkMetadataSchema = z.record(z.string(), z.unknown());

/** Widgets shown on the home screen, in order. */
export const HomeWidgetsSchema = z.array(
  z.object({
    widget: z.string().min(1).describe("Widget id, e.g. quick_links, recents, assigned, created, stickies."),
    enabled: z.boolean().default(true).describe("Whether the widget is shown."),
  }),
);

export const AiEffortSchema = z.enum(["low", "medium", "high", "xhigh"]);

/** Assistant settings stored on the workspace. */
export const WorkspaceAiSettingsSchema = z.object({
  model: z.string().nullable().default(null).describe("Model id override, or null for the TESSERA_AI_MODEL default."),
  effort: AiEffortSchema.nullable().default(null).describe("Effort override, or null for the TESSERA_AI_EFFORT default."),
  digest_enabled: z.boolean().default(true).describe("Whether the home digest is generated."),
});

/** What an export covers. */
export const ExportScopeSchema = z.object({
  project_id: IdSchema.nullable().default(null).describe("Project to export, or null for the whole workspace."),
  cycle_id: IdSchema.optional().describe("Restrict to one cycle."),
  module_id: IdSchema.optional().describe("Restrict to one module."),
  filters: FiltersSchema.optional().describe("Extra list filters."),
});

export const ExportFormatSchema = z.enum(["csv", "json"]);
export const ExportStatusSchema = z.enum(["pending", "running", "done", "failed"]);

/** Activity verbs a webhook subscribes to, e.g. work_item.created. */
export const WebhookEventsSchema = z.array(z.string().min(1));
