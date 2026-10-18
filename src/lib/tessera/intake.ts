/**
 * Intake items: one live row per work item, hidden in the triage state until
 * accepted. A snoozed item whose time has passed counts as open at read time.
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { latestSeq, logActivity } from "./activity";
import type { TesseraContext } from "./core/context";
import { notFound, rule, validateInput, validation } from "./core/errors";
import { formatKey } from "./core/keys";
import { withTx } from "./core/tx";
import { actor, intake, intake_item, project, work_item, work_item_label } from "./db/schema";
import { addRelation } from "./relations";
import { IdListSchema, IdSchema, IntakeSourceSchema, IntakeTabSchema, IsoDateSchema, PrioritySchema } from "./schemas";
import { ensureTriageState } from "./states";
import type { ActorKind, IntakeSource, IntakeStatus, IntakeTab, Priority } from "./types";
import { deleteWorkItem } from "./work-items/lifecycle";
import { applyPatch } from "./work-items/update";
import {
  DESCRIPTION,
  MAX_IDS,
  WORK_ITEM_NAME,
  assertNotTriage,
  checkDates,
  defaultState,
  itemKey,
  loadWritableProject,
  loadWritableWorkItem,
  resolveActors,
  resolveLabels,
  resolveState,
} from "./work-items/model";
import { insertWorkItem } from "./work-items/create";
import { intakeSourceFor, recordIntakeItem } from "./intake-policy";
import type { ProjectRow, WorkItemRow } from "./types";

export type IntakeItemView = {
  id: string;
  work_item_id: string;
  key: string;
  name: string;
  priority: Priority;
  label_ids: string[];
  status: IntakeStatus;
  is_open: boolean;
  snoozed_till: string | null;
  duplicate_to: { id: string; key: string; name: string } | null;
  source: IntakeSource;
  created_by: { id: string; name: string; kind: ActorKind };
  created_at: string;
  updated_at: string;
};

export type IntakeCounts = { open: number; snoozed: number; closed: number };

export type IntakeListResult = { items: IntakeItemView[]; total: number; cursor: number; counts: IntakeCounts };

type Raw = {
  id: string;
  work_item_id: string;
  status: IntakeStatus;
  snoozed_till: string | null;
  duplicate_to_id: string | null;
  source: IntakeSource;
  created_at: string;
  updated_at: string;
  name: string;
  priority: Priority;
  sequence_id: number;
  identifier: string;
  actor_id: string;
  actor_name: string;
  actor_kind: ActorKind;
};

export const ListIntakeItemsInput = z
  .object({
    project_id: IdSchema.describe("Project whose intake to list."),
    tab: IntakeTabSchema.default("open").describe("open, snoozed or closed."),
    search: z.string().trim().max(200).optional().describe("Matches the title or the key."),
    source: IntakeSourceSchema.optional().describe("Only items from this source."),
    limit: z.number().int().min(1).max(500).default(200).describe("How many items to return, newest first."),
  })
  .strict();

export function listIntakeItems(ctx: TesseraContext, input: z.input<typeof ListIntakeItemsInput>): IntakeListResult {
  const data = validateInput(ListIntakeItemsInput, input);
  const rows = loadRows(ctx, data.project_id);
  const now = ctx.now();
  const counts = countTabs(rows, now);
  const needle = data.search?.toLowerCase() ?? "";
  const matched = rows.filter((row) => {
    if (tabOf(row, now) !== data.tab) return false;
    if (data.source !== undefined && row.source !== data.source) return false;
    if (needle === "") return true;
    const key = formatKey(row.identifier, row.sequence_id).toLowerCase();
    return row.name.toLowerCase().includes(needle) || key.includes(needle);
  });
  return { items: toViews(ctx, matched.slice(0, data.limit), now), total: matched.length, cursor: latestSeq(ctx), counts };
}

export function getIntakeItem(ctx: TesseraContext, id: string): IntakeItemView {
  const row = loadRows(ctx).find((candidate) => candidate.id === id);
  if (!row) throw notFound("intake_item", id);
  return toViews(ctx, [row], ctx.now())[0];
}

export function getIntakeItemForWorkItem(ctx: TesseraContext, workItemId: string): IntakeItemView | null {
  const row = loadRows(ctx).find((candidate) => candidate.work_item_id === workItemId);
  if (!row) return null;
  return toViews(ctx, [row], ctx.now())[0];
}

/** Open-tab count for the project tab badge. Zero when Intake is off. */
export function countOpenIntake(ctx: TesseraContext, projectId: string): number {
  const projectRow = ctx.db.select({ intake_enabled: project.intake_enabled }).from(project).where(eq(project.id, projectId)).get();
  if (!projectRow?.intake_enabled) return 0;
  return countTabs(loadRows(ctx, projectId), ctx.now()).open;
}

export const CreateIntakeItemInput = z
  .object({
    project_id: IdSchema.describe("Project the item belongs to. Intake must be on."),
    name: WORK_ITEM_NAME.describe("Title."),
    description_md: DESCRIPTION.optional().describe("Markdown body."),
    priority: PrioritySchema.optional().describe("urgent, high, medium, low or none (default)."),
    label_ids: IdListSchema.max(MAX_IDS).optional().describe("Labels of the project."),
    assignee_ids: IdListSchema.max(MAX_IDS).optional().describe("Actors to assign."),
    start_date: IsoDateSchema.optional().describe("YYYY-MM-DD."),
    target_date: IsoDateSchema.optional().describe("YYYY-MM-DD, not before start_date."),
  })
  .strict();

/** Puts a work item straight into Intake for any actor. Intake off is RULE feature_disabled. */
export function createIntakeItem(ctx: TesseraContext, input: z.input<typeof CreateIntakeItemInput>): IntakeItemView {
  const data = validateInput(CreateIntakeItemInput, input);
  return withTx(ctx, () => {
    const projectRow = loadWritableProject(ctx, data.project_id);
    if (!projectRow.intake_enabled) throw rule("feature_disabled", "Intake is turned off in this project");
    const stateRow = ensureTriageState(ctx, projectRow.id);
    const labelIds = [...new Set(data.label_ids ?? [])];
    resolveLabels(ctx, projectRow.id, labelIds);
    let assigneeIds = [...new Set(data.assignee_ids ?? [])];
    if (assigneeIds.length === 0 && projectRow.default_assignee_id !== null) assigneeIds = [projectRow.default_assignee_id];
    resolveActors(ctx, assigneeIds);
    checkDates(data.start_date ?? null, data.target_date ?? null);
    const row = insertWorkItem(ctx, projectRow, {
      name: data.name,
      description_md: data.description_md ?? "",
      state: stateRow,
      priority: data.priority ?? "none",
      parent_id: null,
      cycle_id: null,
      estimate_point_id: null,
      start_date: data.start_date ?? null,
      target_date: data.target_date ?? null,
      label_ids: labelIds,
      module_ids: [],
      assignee_ids: assigneeIds,
    });
    recordIntakeItem(ctx, projectRow, row, intakeSourceFor(ctx));
    return mustView(ctx, row.id);
  });
}

const AcceptInput = z
  .object({
    state_id: IdSchema.optional().describe("State to accept into. The project default when omitted. The triage state is refused."),
  })
  .strict();

/** Moves the work item out of triage. Accepted items stay accepted. */
export function acceptIntakeItem(ctx: TesseraContext, id: string, input: z.input<typeof AcceptInput> = {}): IntakeItemView {
  const data = validateInput(AcceptInput, input);
  return withTx(ctx, () => {
    const current = loadLive(ctx, id);
    if (current.status === "accepted") throw rule("intake_closed", "This intake item is already accepted");
    const projectRow = loadWritableProject(ctx, current.project_id);
    const target = data.state_id === undefined ? defaultState(ctx, projectRow.id) : resolveState(ctx, projectRow.id, data.state_id);
    assertNotTriage(target);
    stamp(ctx, current.id, { status: "accepted", snoozed_till: null });
    const loaded = loadWritableWorkItem(ctx, current.work_item_id);
    applyPatch(ctx, loaded, { state_id: target.id });
    logIntake(ctx, projectRow, current, "accepted", target.name);
    return mustView(ctx, current.work_item_id);
  });
}

export function declineIntakeItem(ctx: TesseraContext, id: string): IntakeItemView {
  return withTx(ctx, () => {
    const current = loadLive(ctx, id);
    if (current.status === "accepted") throw rule("intake_closed", "An accepted intake item cannot be declined");
    const projectRow = loadWritableProject(ctx, current.project_id);
    stamp(ctx, current.id, { status: "declined", snoozed_till: null });
    logIntake(ctx, projectRow, current, "declined", itemKey(projectRow, current.item));
    return mustView(ctx, current.work_item_id);
  });
}

const SnoozeInput = z
  .object({
    until: z.string().describe("ISO-8601 instant in the future when the item returns to Open."),
  })
  .strict();

export function snoozeIntakeItem(ctx: TesseraContext, id: string, input: z.input<typeof SnoozeInput>): IntakeItemView {
  const data = validateInput(SnoozeInput, input);
  const untilMs = Date.parse(data.until);
  if (Number.isNaN(untilMs)) throw validation({ until: data.until }, "until must be an ISO-8601 timestamp");
  return withTx(ctx, () => {
    if (untilMs <= Date.parse(ctx.now())) throw validation({ until: data.until }, "Snooze until a time in the future");
    const current = loadLive(ctx, id);
    if (current.status === "accepted" || current.status === "declined" || current.status === "duplicate") {
      throw rule("intake_closed", "Accepted, declined and duplicate items cannot be snoozed");
    }
    const projectRow = loadWritableProject(ctx, current.project_id);
    const until = new Date(untilMs).toISOString();
    stamp(ctx, current.id, { status: "snoozed", snoozed_till: until });
    logIntake(ctx, projectRow, current, "snoozed", until);
    return mustView(ctx, current.work_item_id);
  });
}

export function unsnoozeIntakeItem(ctx: TesseraContext, id: string): IntakeItemView {
  return withTx(ctx, () => {
    const current = loadLive(ctx, id);
    if (current.status !== "snoozed") throw rule("not_snoozed", "This intake item is not snoozed");
    const projectRow = loadWritableProject(ctx, current.project_id);
    stamp(ctx, current.id, { status: "pending", snoozed_till: null });
    logIntake(ctx, projectRow, current, "unsnoozed", itemKey(projectRow, current.item));
    return mustView(ctx, current.work_item_id);
  });
}

const DuplicateInput = z
  .object({
    duplicate_of_id: IdSchema.describe("The original work item, in any project. Not this item, and not one still pending in Intake."),
  })
  .strict();

export function markIntakeDuplicate(ctx: TesseraContext, id: string, input: z.input<typeof DuplicateInput>): IntakeItemView {
  const data = validateInput(DuplicateInput, input);
  return withTx(ctx, () => {
    const current = loadLive(ctx, id);
    if (current.status !== "pending" && current.status !== "snoozed") {
      throw rule("intake_closed", "Only an open intake item can be marked as a duplicate");
    }
    if (data.duplicate_of_id === current.work_item_id) throw validation({ duplicate_of_id: data.duplicate_of_id }, "An intake item cannot be a duplicate of itself");
    const target = ctx.db.select().from(work_item).where(and(eq(work_item.id, data.duplicate_of_id), isNull(work_item.deleted_at))).get();
    if (!target) throw notFound("work_item", data.duplicate_of_id);
    const targetIntake = ctx.db
      .select({ status: intake_item.status })
      .from(intake_item)
      .where(and(eq(intake_item.work_item_id, target.id), isNull(intake_item.deleted_at)))
      .get();
    if (targetIntake?.status === "pending") throw rule("intake_pending", "The original is still pending in Intake");
    const projectRow = loadWritableProject(ctx, current.project_id);
    const targetProject = ctx.db.select().from(project).where(eq(project.id, target.project_id)).get();
    stamp(ctx, current.id, { status: "duplicate", snoozed_till: null, duplicate_to_id: target.id });
    addRelation(ctx, { work_item_id: current.work_item_id, related_work_item_id: target.id, relation_type: "duplicate" });
    logIntake(ctx, projectRow, current, "marked_duplicate", targetProject ? formatKey(targetProject.identifier, target.sequence_id) : target.id);
    return mustView(ctx, current.work_item_id);
  });
}

/** Soft-deletes a non-accepted intake item together with its work item. */
export function deleteIntakeItem(ctx: TesseraContext, id: string): void {
  withTx(ctx, () => {
    const current = loadLive(ctx, id);
    if (current.status === "accepted") throw rule("intake_closed", "Delete the work item instead of an accepted intake item");
    const projectRow = loadWritableProject(ctx, current.project_id);
    logIntake(ctx, projectRow, current, "deleted", itemKey(projectRow, current.item));
    deleteWorkItem(ctx, current.work_item_id);
  });
}

type Live = Raw & { project_id: string; item: WorkItemRow };

function loadLive(ctx: TesseraContext, id: string): Live {
  const row = ctx.db
    .select({ item: intake_item, work: work_item })
    .from(intake_item)
    .innerJoin(work_item, eq(intake_item.work_item_id, work_item.id))
    .where(and(eq(intake_item.id, id), isNull(intake_item.deleted_at), isNull(work_item.deleted_at)))
    .get();
  if (!row) throw notFound("intake_item", id);
  return {
    id: row.item.id,
    work_item_id: row.work.id,
    status: row.item.status,
    snoozed_till: row.item.snoozed_till,
    duplicate_to_id: row.item.duplicate_to_id,
    source: row.item.source,
    created_at: row.item.created_at,
    updated_at: row.item.updated_at,
    name: row.work.name,
    priority: row.work.priority,
    sequence_id: row.work.sequence_id,
    identifier: "",
    actor_id: row.item.created_by_actor_id,
    actor_name: "",
    actor_kind: "user",
    project_id: row.work.project_id,
    item: row.work,
  };
}

function stamp(ctx: TesseraContext, id: string, patch: Partial<typeof intake_item.$inferInsert>): void {
  const now = ctx.now();
  ctx.db
    .update(intake_item)
    .set({ ...patch, updated_at: now, updated_by: ctx.actor.id })
    .where(eq(intake_item.id, id))
    .run();
}

function logIntake(ctx: TesseraContext, projectRow: ProjectRow, current: Live, verb: string, identifier: string): void {
  logActivity(ctx, {
    project_id: projectRow.id,
    entity_type: "intake_item",
    entity_id: current.id,
    work_item_id: current.work_item_id,
    verb,
    new_identifier: identifier,
  });
}

function mustView(ctx: TesseraContext, workItemId: string): IntakeItemView {
  const view = getIntakeItemForWorkItem(ctx, workItemId);
  if (!view) throw notFound("intake_item", workItemId);
  return view;
}

function loadRows(ctx: TesseraContext, projectId?: string): Raw[] {
  const filters = [isNull(intake_item.deleted_at), isNull(work_item.deleted_at), isNull(intake.deleted_at)];
  if (projectId !== undefined) filters.push(eq(intake.project_id, projectId));
  return ctx.db
    .select({
      id: intake_item.id,
      work_item_id: intake_item.work_item_id,
      status: intake_item.status,
      snoozed_till: intake_item.snoozed_till,
      duplicate_to_id: intake_item.duplicate_to_id,
      source: intake_item.source,
      created_at: intake_item.created_at,
      updated_at: intake_item.updated_at,
      name: work_item.name,
      priority: work_item.priority,
      sequence_id: work_item.sequence_id,
      identifier: project.identifier,
      actor_id: actor.id,
      actor_name: actor.name,
      actor_kind: actor.kind,
    })
    .from(intake_item)
    .innerJoin(intake, eq(intake_item.intake_id, intake.id))
    .innerJoin(work_item, eq(intake_item.work_item_id, work_item.id))
    .innerJoin(project, eq(work_item.project_id, project.id))
    .innerJoin(actor, eq(intake_item.created_by_actor_id, actor.id))
    .where(and(...filters))
    .orderBy(desc(intake_item.created_at), desc(intake_item.id))
    .all();
}

function tabOf(row: Raw, now: string): IntakeTab {
  if (row.status === "pending") return "open";
  if (row.status === "snoozed") return row.snoozed_till !== null && row.snoozed_till > now ? "snoozed" : "open";
  return "closed";
}

function countTabs(rows: Raw[], now: string): IntakeCounts {
  const counts: IntakeCounts = { open: 0, snoozed: 0, closed: 0 };
  for (const row of rows) counts[tabOf(row, now)] += 1;
  return counts;
}

function toViews(ctx: TesseraContext, rows: Raw[], now: string): IntakeItemView[] {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.work_item_id);
  const labels = ctx.db
    .select({ work_item_id: work_item_label.work_item_id, label_id: work_item_label.label_id })
    .from(work_item_label)
    .where(inArray(work_item_label.work_item_id, ids))
    .all();
  const byItem = new Map<string, string[]>();
  for (const label of labels) {
    const list = byItem.get(label.work_item_id) ?? [];
    list.push(label.label_id);
    byItem.set(label.work_item_id, list);
  }
  const dupIds = [...new Set(rows.map((row) => row.duplicate_to_id).filter((id): id is string => id !== null))];
  const dups = new Map<string, { id: string; key: string; name: string }>();
  if (dupIds.length > 0) {
    const found = ctx.db
      .select({ id: work_item.id, name: work_item.name, sequence_id: work_item.sequence_id, identifier: project.identifier })
      .from(work_item)
      .innerJoin(project, eq(work_item.project_id, project.id))
      .where(inArray(work_item.id, dupIds))
      .all();
    for (const row of found) dups.set(row.id, { id: row.id, key: formatKey(row.identifier, row.sequence_id), name: row.name });
  }
  return rows.map((row) => ({
    id: row.id,
    work_item_id: row.work_item_id,
    key: formatKey(row.identifier, row.sequence_id),
    name: row.name,
    priority: row.priority,
    label_ids: byItem.get(row.work_item_id) ?? [],
    status: row.status,
    is_open: tabOf(row, now) === "open",
    snoozed_till: row.snoozed_till,
    duplicate_to: row.duplicate_to_id === null ? null : (dups.get(row.duplicate_to_id) ?? null),
    source: row.source,
    created_by: { id: row.actor_id, name: row.actor_name, kind: row.actor_kind },
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}
