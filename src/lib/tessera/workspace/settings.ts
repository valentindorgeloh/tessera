/**
 * The workspace singleton: name, home widgets, AI overrides and the Home
 * seen cursor. ensureWorkspaceSettings inserts the row at startup.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { TesseraContext } from "../core/context";
import { validateInput } from "../core/errors";
import { nowIso } from "../core/time";
import { withTx } from "../core/tx";
import type { TesseraDb } from "../db/client";
import { workspace_settings } from "../db/schema";
import { AiEffortSchema, HOME_WIDGET_IDS, HomeWidgetIdSchema, HomeWidgetsSchema, WorkspaceAiSettingsSchema } from "../schemas";
import type { HomeWidgetId, HomeWidgets, WorkspaceAiSettings, WorkspaceSettingsView } from "../types";

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

export function ensureWorkspaceSettings(db: TesseraDb): void {
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
      created_at: now,
      updated_at: now,
    })
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
    last_seen_seq: row.last_seen_seq,
    last_seen_at: row.last_seen_at,
  };
}

export function getWorkspaceSettings(ctx: TesseraContext): WorkspaceSettingsView {
  return toView(readRow(ctx));
}

export const UpdateWorkspaceSettingsInput = z
  .object({
    name: z.string().trim().min(1).max(80).optional().describe("Workspace name shown in the top bar."),
    home_widgets: HomeWidgetsSchema.optional().describe("Home widget order and which widgets are shown."),
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
        ai,
        updated_at: now,
      })
      .where(eq(workspace_settings.id, WORKSPACE_ID))
      .returning()
      .get();
    return toView(row);
  });
}
