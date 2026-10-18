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
export const PageEmbedTypeSchema = z.enum(["work_item", "page", "cycle", "module"]);
export const PageTabSchema = z.enum(["public", "private", "archived"]);

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

/** The `ProgressCounts` keys summed in estimate points; estimate values may be fractional. */
export const PointsCountsSchema = z.object({
  total: z.number().nonnegative().describe("All points counted."),
  completed: z.number().nonnegative().describe("Points in the completed group."),
  cancelled: z.number().nonnegative().describe("Points in the cancelled group."),
  started: z.number().nonnegative().describe("Points in the started group."),
  unstarted: z.number().nonnegative().describe("Points in the unstarted group."),
  backlog: z.number().nonnegative().describe("Points in the backlog group."),
});

/** Unit of a progress series: items (issues) or estimate points. */
export const ProgressModeSchema = z.enum(["issues", "points"]);

/** One row of an assignee or label breakdown; `id: null` collects the items without an assignee or without labels. */
export const ProgressBreakdownRowSchema = z.object({
  id: IdSchema.nullable().describe("Assignee actor id or label id; null for items without one."),
  total: z.number().int().nonnegative().describe("Items counted in this row."),
  completed: z.number().int().nonnegative().describe("Items of this row in the completed group."),
});

/** Progress of a cycle, by count and optionally by estimate points; frozen as `progress_snapshot` on transfer. */
export const CycleProgressSchema = ProgressCountsSchema.extend({
  by_state: z.record(z.string(), z.number().int()).describe("Item count per state id."),
  by_label: z.record(z.string(), z.number().int()).describe("Item count per label id."),
  by_assignee: z.record(z.string(), z.number().int()).describe("Item count per assignee actor id."),
  assignees: z.array(ProgressBreakdownRowSchema).optional().describe("Items and completed items per assignee, the null row last."),
  labels: z.array(ProgressBreakdownRowSchema).optional().describe("Items and completed items per label, the null row last."),
  points: PointsCountsSchema.optional().describe("Same counts in estimate points when the project has an active estimate."),
  chart_mode: ProgressModeSchema.optional().describe("Unit of completion_chart: issues (items) or points."),
  completion_chart: z.record(IsoDateSchema, z.number().nonnegative()).describe("Pending amount per day for the burndown and burnup charts."),
  completion_chart_points: z
    .record(IsoDateSchema, z.number().nonnegative())
    .optional()
    .describe("Pending points per day; stored in frozen snapshots only, never part of a returned progress."),
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

// ---------------------------------------------------------------------------
// AI (P5, docs/drafts/p5-plan.md §3–§5). Client-safe wire shapes shared by the
// routes, the assistant panel and the engine. No Anthropic SDK and no
// `@/lib/tessera/ai` import here: `"use client"` code imports this file.
// ---------------------------------------------------------------------------

/** `pending → applying → applied | failed`, or `pending → discarded`. */
export const ProposalStatusSchema = z.enum(["pending", "applying", "applied", "failed", "discarded"]);

/** Where a proposal came from: the chat (`assistant`) or the Describe a view dialog. */
export const ProposalSourceSchema = z.enum(["assistant", "view_from_prompt"]);

/** Digest subjects. P9 adds `home` and `analytics`. */
export const DigestKindSchema = z.enum(["cycle", "module", "inbox"]);

/** The route on screen that the assistant answers about. Every key is optional. */
export const AssistantScopeSchema = z.object({
  project_id: IdSchema.optional().describe("Project on screen."),
  work_item_id: IdSchema.optional().describe("Work item open in the detail screen or the peek."),
  page_id: IdSchema.optional().describe("Page on screen; accepted from P5 and used from P6."),
  cycle_id: IdSchema.optional().describe("Cycle on screen."),
  module_id: IdSchema.optional().describe("Module on screen."),
});

/** One text turn of the transcript; tool calls and thinking blocks are never replayed. */
export const AssistMessageSchema = z.object({
  role: z.enum(["user", "assistant"]).describe("Who wrote the turn."),
  content: z.string().min(1).max(20000).describe("Text of the turn."),
});

/** Body of `POST /api/ai/assist`. */
export const AssistRequestSchema = z.object({
  conversation_id: z.uuid().describe("Client-made id of the conversation (crypto.randomUUID), links proposals to it."),
  scope: AssistantScopeSchema.default({}).describe("Route on screen."),
  messages: z.array(AssistMessageSchema).min(1).max(50).describe("Text history, oldest first; the last turn is the question."),
  toolset: z.enum(["core", "all"]).default("all").describe("Which registry tools the assistant may use."),
});

/** Error shape of a failed proposal or apply: a tracker code, or INTERNAL for anything else. */
export const ProposalErrorSchema = z.object({
  code: z
    .enum(["NOT_FOUND", "VALIDATION", "CONFLICT", "RULE", "ARCHIVED", "LOCKED", "BUSY", "INTERNAL"])
    .describe("TrackerErrorCode, or INTERNAL."),
  message: z.string().describe("Reason shown to the person."),
});

/** Entity a proposal acts on, with its display label. */
export const ProposalTargetSchema = z.object({
  type: z
    .enum(["project", "work_item", "state", "label", "cycle", "module", "view", "actor", "link"])
    .describe("Kind of entity."),
  id: IdSchema.nullable().describe("Entity id, or null when it does not exist yet."),
  label: z.string().describe("Name or `KEY title` of the entity."),
});

/** Human-readable before and after of one changed field. */
export const ProposalFieldSchema = z.object({
  field: z.string().describe("Input key, e.g. priority."),
  label: z.string().describe("Field name in UI words."),
  before: z.string().nullable().describe("Current value, or null for a create."),
  after: z.string().nullable().describe("Proposed value, or null when cleared."),
});

/** What Apply would do, with ids resolved to names (docs/drafts/p5-plan.md §4). */
export const ProposalPreviewSchema = z.object({
  title: z.string().describe("`<tool title> · <target label>`, e.g. Update work item · WEB-12 Fix login."),
  target: ProposalTargetSchema.nullable().describe("Entity the proposal acts on, or null."),
  fields: z.array(ProposalFieldSchema).describe("Changed fields, before and after."),
  note: z.string().optional().describe("Extra line such as Expected key WEB-13 or Deletes 1 work item."),
});

/** A stored assistant proposal as the client sees it. */
export const ProposalViewSchema = z.object({
  id: IdSchema.describe("Proposal id."),
  conversation_id: z.uuid().describe("Conversation the proposal belongs to."),
  source: ProposalSourceSchema.describe("Chat or view from prompt."),
  tool: z.string().min(1).describe("Registry name of the mutating tool Apply runs."),
  title: z.string().describe("Same as preview.title."),
  input: z.unknown().describe("The validated tool input Apply runs."),
  preview: ProposalPreviewSchema.describe("Resolved before and after."),
  destructive: z.boolean().describe("Whether Apply needs an explicit confirmation."),
  status: ProposalStatusSchema.describe("Lifecycle state."),
  error: ProposalErrorSchema.nullable().describe("Why it failed, or null."),
  created_at: IsoTimestampSchema.describe("When the model proposed it."),
  decided_at: IsoTimestampSchema.nullable().describe("When it was applied, failed or discarded."),
});

/** A stored digest of a cycle, a module, or one actor's inbox. */
export const DigestViewSchema = z.object({
  kind: DigestKindSchema.describe("Cycle, module or inbox."),
  entity_id: IdSchema.describe("Cycle id, module id, or the recipient actor id for an inbox digest."),
  body_md: z.string().describe("Digest text in markdown."),
  input_seq: z.number().int().nonnegative().describe("Highest activity seq the digest summarised."),
  model: z.string().describe("Model id that wrote it."),
  created_at: IsoTimestampSchema.describe("When it was generated."),
  is_stale: z.boolean().describe("Newer activity exists since it was generated."),
});

/** Answer of `GET /api/ai/status`; every AI entry point hides unless `available` is true. */
export const AiStatusSchema = z.discriminatedUnion("available", [
  z.object({ available: z.literal(true), model: z.string().describe("Model id in use.") }),
  z.object({
    available: z.literal(false),
    reason: z.enum(["no_credential", "model_unavailable", "offline"]).describe("Why the assistant is off."),
  }),
]);

/** Server-sent events of `POST /api/ai/assist`; `type` doubles as the SSE event name. */
export const AssistantEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text_delta"), text: z.string().describe("Next piece of answer text.") }),
  z.object({
    type: z.literal("tool_use"),
    id: z.string().describe("The model's tool_use id."),
    name: z.string().describe("Tool name; mutating tools carry the propose_ prefix."),
  }),
  z.object({
    type: z.literal("tool_result"),
    id: z.string().describe("The tool_use id this result answers."),
    ok: z.boolean().describe("False when the tool returned an error."),
    summary: z.string().describe("One line for the tool calls row."),
  }),
  z.object({ type: z.literal("proposal"), proposal: ProposalViewSchema.describe("The pending proposal the model made.") }),
  z.object({ type: z.literal("notice"), text: z.string().describe("System note, e.g. Answered by <model>.") }),
  z.object({
    type: z.literal("error"),
    kind: z.enum(["auth", "rate_limit", "unavailable"]).describe("How the client should present the failure."),
    message: z.string().describe("Text for the composer status or a toast."),
  }),
  z.object({
    type: z.literal("done"),
    stop_reason: z.string().describe("end_turn, max_tokens, refusal, aborted or another API stop reason."),
    continue: z.boolean().optional().describe("True when the turn was cut at max_tokens and the client may offer Continue."),
  }),
]);

export type AssistantEvent = z.infer<typeof AssistantEventSchema>;
