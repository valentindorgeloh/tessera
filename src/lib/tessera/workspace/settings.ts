/**
 * The workspace singleton: name, home widgets, AI overrides, the Home seen
 * cursor and the superagent settings. ensureWorkspaceSettings inserts the row
 * at startup.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { TesseraContext } from "../core/context";
import { rule, validateInput, validation } from "../core/errors";
import { nowIso } from "../core/time";
import { withTx } from "../core/tx";
import type { TesseraDb } from "../db/client";
import { workspace_settings } from "../db/schema";
import { getProjectRow } from "../projects";
import {
  AGENT_RUNNER_DEFAULT_URL,
  AgentProjectSchema,
  AgentRunnerUrlSchema,
  AiEffortSchema,
  HOME_WIDGET_IDS,
  HomeWidgetIdSchema,
  HomeWidgetsSchema,
  WorkspaceAiSettingsSchema,
} from "../schemas";
import type { AgentProject, AgentSettings, HomeWidgetId, HomeWidgets, WorkspaceAiSettings, WorkspaceSettingsView } from "../types";

export { AGENT_RUNNER_DEFAULT_URL };

export const WORKSPACE_ID = "workspace";

const DEFAULT_AI: WorkspaceAiSettings = { model: null, effort: null, digest_enabled: true };

export function defaultHomeWidgets(): HomeWidgets {
  return HOME_WIDGET_IDS.map((widget) => ({ widget, enabled: true }));
}

/** Drops unknown ids and appends any missing id, enabled, in the default order. */
export function normalizeHomeWidgets(raw: unknown): HomeWidgets {
  const list = z.array(z.unknown()).catch([]).parse(raw);
  const seen = new Set<HomeWidgetId>();
  const widgets: HomeWidgets = [];
  const item = z.object({ widget: HomeWidgetIdSchema, enabled: z.boolean().optional() });
  for (const entry of list) {
    const parsed = item.safeParse(entry);
    if (!parsed.success || seen.has(parsed.data.widget)) continue;
    seen.add(parsed.data.widget);
    widgets.push({ widget: parsed.data.widget, enabled: parsed.data.enabled ?? true });
  }
  for (const widget of HOME_WIDGET_IDS) {
    if (!seen.has(widget)) widgets.push({ widget, enabled: true });
  }
  return widgets;
}

/**
 * Superagent settings as stored (decision 144). Null stays null (never set);
 * otherwise a bad runner URL becomes the default and bad or repeated project
 * entries are dropped. The URL is returned without a trailing "/". Pure.
 */
export function normalizeAgentSettings(raw: unknown): AgentSettings | null {
  if (raw === null || raw === undefined) return null;
  const record = typeof raw === "object" ? (raw as { runner_url?: unknown; projects?: unknown }) : {};
  const url = AgentRunnerUrlSchema.safeParse(record.runner_url);
  const seen = new Set<string>();
  const projects: AgentProject[] = [];
  for (const entry of Array.isArray(record.projects) ? record.projects : []) {
    const parsed = AgentProjectSchema.safeParse(entry);
    if (!parsed.success || seen.has(parsed.data.project_id)) continue;
    seen.add(parsed.data.project_id);
    projects.push(parsed.data);
  }
  return { runner_url: url.success ? url.data.replace(/\/$/, "") : AGENT_RUNNER_DEFAULT_URL, projects };
}

/** The repository mapped to a project, or null when the project is not mapped. */
export function agentRepoFor(agents: AgentSettings | null, projectId: string): string | null {
  return agents?.projects.find((entry) => entry.project_id === projectId)?.repo ?? null;
}

/**
 * Inserts the singleton row when missing. Insert-or-ignore, not check-then-insert:
 * several processes may open one fresh database file at once, and the losers of the
 * race must not crash on the primary key (docs/improvements.md "first-open race").
 */
export function ensureWorkspaceSettings(db: TesseraDb): void {
  // The read keeps the common case (row exists) free of a write lock; the insert still ignores a lost race.
  const existing = db.select({ id: workspace_settings.id }).from(workspace_settings).where(eq(workspace_settings.id, WORKSPACE_ID)).get();
  if (existing) return;
  const now = nowIso();
  db.insert(workspace_settings)
    .values({
      id: WORKSPACE_ID,
      name: "Tessera",
      home_widgets: defaultHomeWidgets(),
      ai: DEFAULT_AI,
      last_seen_seq: null,
      last_seen_at: null,
      auto_backup: true,
      week_start: 1, // Default to Monday
      created_at: now,
      updated_at: now,
    })
    .onConflictDoNothing()
    .run();
}

function readRow(ctx: TesseraContext) {
  ensureWorkspaceSettings(ctx.db);
  const row = ctx.db.select().from(workspace_settings).where(eq(workspace_settings.id, WORKSPACE_ID)).get();
  if (!row) throw new Error("workspace settings row is missing");
  return row;
}

function toView(row: typeof workspace_settings.$inferSelect): WorkspaceSettingsView {
  const ai = WorkspaceAiSettingsSchema.safeParse(row.ai ?? {});
  return {
    name: row.name,
    home_widgets: normalizeHomeWidgets(row.home_widgets),
    ai: ai.success ? ai.data : DEFAULT_AI,
    agents: normalizeAgentSettings(row.agents),
    last_seen_seq: row.last_seen_seq,
    last_seen_at: row.last_seen_at,
    auto_backup: row.auto_backup !== false,
    week_start: row.week_start ?? 1, // Default to Monday if not set
  };
}

export function getWorkspaceSettings(ctx: TesseraContext): WorkspaceSettingsView {
  return toView(readRow(ctx));
}

export const UpdateWorkspaceSettingsInput = z
  .object({
    name: z.string().trim().min(1).max(80).optional().describe("Workspace name shown in the top bar."),
    home_widgets: HomeWidgetsSchema.optional().describe("Home widget order and which widgets are shown."),
    auto_backup: z.boolean().optional().describe("When true, the maintenance job writes a daily auto backup."),
    week_start: z.number().int().min(0).max(6).optional().describe("Week start day: 0 = Sunday, 1 = Monday, ..., 6 = Saturday."),
    ai: z
      .object({
        model: z.string().nullable().optional().describe("Model id override, or null to use the environment default."),
        effort: AiEffortSchema.nullable().optional().describe("Effort override, or null to use the environment default."),
        digest_enabled: z.boolean().optional().describe("Whether digests and summaries are offered."),
      })
      .strict()
      .optional()
      .describe("AI overrides. Omitted keys keep their stored value."),
  })
  .strict();

export type UpdateWorkspaceSettingsInputType = z.input<typeof UpdateWorkspaceSettingsInput>;

export function updateWorkspaceSettings(ctx: TesseraContext, input: UpdateWorkspaceSettingsInputType): WorkspaceSettingsView {
  const data = validateInput(UpdateWorkspaceSettingsInput, input);
  return withTx(ctx, () => {
    const before = readRow(ctx);
    const currentAi = WorkspaceAiSettingsSchema.parse(before.ai ?? {});
    const ai = data.ai === undefined ? currentAi : WorkspaceAiSettingsSchema.parse({ ...currentAi, ...data.ai });
    const now = ctx.now();
    const row = ctx.db
      .update(workspace_settings)
      .set({
        name: data.name ?? before.name,
        home_widgets: data.home_widgets === undefined ? normalizeHomeWidgets(before.home_widgets) : normalizeHomeWidgets(data.home_widgets),
        auto_backup: data.auto_backup ?? before.auto_backup,
        week_start: data.week_start ?? before.week_start,
        ai,
        updated_at: now,
      })
      .where(eq(workspace_settings.id, WORKSPACE_ID))
      .returning()
      .get();
    return toView(row);
  });
}

export const SetAgentSettingsInput = z
  .object({
    runner_url: AgentRunnerUrlSchema.optional().describe("Runner URL, http://127.0.0.1:<port> or http://localhost:<port>. Omitted keeps the stored one (the default when none is stored)."),
    projects: z.array(AgentProjectSchema).max(50).describe("The whole project to repository map, at most 50 entries, each project once. [] maps nothing."),
  })
  .strict();

/** Replaces the superagent project map and, when given, the runner URL. User only (decision 144); no activity row, like updateWorkspaceSettings. */
export function setAgentSettings(ctx: TesseraContext, input: z.input<typeof SetAgentSettingsInput>): WorkspaceSettingsView {
  // Apply runs proposals as the assistant without assertToolAllowed, so the service refuses every non-user actor itself.
  if (ctx.actor.kind !== "user") throw rule("user_only", "Only the user can change the superagent settings");
  const data = validateInput(SetAgentSettingsInput, input);
  return withTx(ctx, () => {
    const mapped = new Set<string>();
    for (const entry of data.projects) {
      if (mapped.has(entry.project_id)) throw validation({ projects: data.projects }, "A project can be mapped once");
      mapped.add(entry.project_id);
    }
    // Live projects only (NOT_FOUND otherwise); an archived project may stay mapped.
    for (const entry of data.projects) getProjectRow(ctx, entry.project_id);
    const before = readRow(ctx);
    const runnerUrl = (data.runner_url ?? normalizeAgentSettings(before.agents)?.runner_url ?? AGENT_RUNNER_DEFAULT_URL).replace(/\/$/, "");
    const row = ctx.db
      .update(workspace_settings)
      .set({ agents: { runner_url: runnerUrl, projects: data.projects }, updated_at: ctx.now() })
      .where(eq(workspace_settings.id, WORKSPACE_ID))
      .returning()
      .get();
    return toView(row);
  });
}
