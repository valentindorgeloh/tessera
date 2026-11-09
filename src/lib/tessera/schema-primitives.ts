/**
 * Enums and primitive value schemas, moved verbatim out of schemas.ts for the file budget.
 * schemas.ts re-exports everything, so imports do not change. Client-safe: zod only.
 */
import { z } from "zod";

export const ActorKindSchema = z.enum(["user", "assistant", "agent", "system"]);

/** Workspace-wide write permission for agents. Other actor kinds are always `write`. */
export const ActorAccessSchema = z.enum(["write", "intake", "read"]);

/** Intake screen tabs. Open includes pending items and snoozed items whose time has passed. */
export const IntakeTabSchema = z.enum(["open", "snoozed", "closed"]);

/** Plane-compatible state groups; `triage` is hidden and exists only when Intake is enabled. */
export const StateGroupSchema = z.enum(["backlog", "unstarted", "started", "completed", "cancelled", "triage"]);

export const PrioritySchema = z.enum(["urgent", "high", "medium", "low", "none"]);

/** Inbox notification kinds in rank order, highest first (decision 51). */
export const NotificationKindSchema = z.enum(["mentioned", "assigned", "commented", "state_changed", "updated", "intake_received", "automation"]);
export type NotificationKind = z.infer<typeof NotificationKindSchema>;

export const ModuleStatusSchema = z.enum(["backlog", "planned", "in_progress", "paused", "completed", "cancelled"]);

/** Derived from dates; never stored. */
export const CycleStatusSchema = z.enum(["current", "upcoming", "completed", "draft"]);

export const RelationTypeSchema = z.enum(["blocked_by", "relates_to", "duplicate", "start_before", "finish_before", "implemented_by"]);

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

/** Home widget ids, in the default order. */
export const HomeWidgetIdSchema = z.enum(["since_last_visit", "quick_links", "recents", "your_work", "stickies"]);

export const HOME_WIDGET_IDS = HomeWidgetIdSchema.options;

/** Virtual workspace views. They are not rows and cannot be favourited. */
export const StaticViewKeySchema = z.enum(["all", "assigned", "created", "subscribed"]);

export const STATIC_WORKSPACE_VIEWS = [
  { key: "all", name: "All work items", description: "Every work item in live projects." },
  { key: "assigned", name: "Assigned", description: "Work items assigned to you." },
  { key: "created", name: "Created", description: "Work items you created." },
  { key: "subscribed", name: "Subscribed", description: "Work items you are subscribed to." },
] as const satisfies readonly { key: z.infer<typeof StaticViewKeySchema>; name: string; description: string }[];

export const ProfileTabSchema = z.enum(["summary", "assigned", "created", "subscribed", "activity"]);

/** Profile counts and list tabs that select work items. `summary` and `activity` are not counts. */
export const ProfileCountsTabSchema = z.enum(["assigned", "created", "subscribed"]);

export const AnalyticsTabSchema = z.enum(["overview", "work-items", "cycles", "modules"]);

export const AnalyticsRangeSchema = z.enum(["7d", "30d", "90d", "365d"]);

export const AnalyticsDimensionSchema = z.enum(["state_group", "state", "priority", "assignee", "label", "cycle", "module", "project", "created_by", "target_week"]);

export const AnalyticsMeasureSchema = z.enum(["count", "points"]);

/** `http(s)://…` or an in-app path. Anything else, including `javascript:`, is rejected. */
export const QuickLinkUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine((value) => /^https?:\/\/\S+$/i.test(value) || (value.startsWith("/") && !value.startsWith("//")), "Use an http(s) URL or an app path starting with /.");

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
