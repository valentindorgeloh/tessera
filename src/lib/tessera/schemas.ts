/**
 * Tessera enums and small value schemas (zod 4). Client-safe: no database imports.
 *
 * Enums live here, never as SQL CHECK constraints (plan decision 5), so a new
 * value is a code change plus, where needed, a data migration.
 */
import { z } from "zod";

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
export const IsoTimestampSchema = z.string().datetime({ offset: false });

/** UUIDv7 text id used by every entity table. */
export const IdSchema = z.uuid();
