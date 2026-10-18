/**
 * Intake policy (plan decision 27). Agents land in the hidden triage state
 * when the project requires it, and an agent whose access is `intake` always
 * does. A new intake item from anyone but the user or the assistant notifies
 * the user in the same transaction.
 */
import { and, eq, isNull } from "drizzle-orm";
import { logActivity } from "./activity";
import type { TesseraContext } from "./core/context";
import { rule } from "./core/errors";
import { newId } from "./core/ids";
import { assertInTransaction } from "./core/tx";
import { intake, intake_item } from "./db/schema";
import { notifyIntakeReceived } from "./notifications";
import { DEFAULT_INTAKE_NAME } from "./projects";
import type { IntakeSource, ProjectRow, WorkItemRow } from "./types";
import { itemKey } from "./work-items/model";

export function intakeSourceFor(ctx: TesseraContext): IntakeSource {
  if (ctx.actor.kind === "assistant") return "assistant";
  if (ctx.actor.kind === "user") return "in_app";
  return "mcp";
}

function findDefaultIntake(ctx: TesseraContext, projectId: string): { id: string } | undefined {
  return ctx.db
    .select({ id: intake.id })
    .from(intake)
    .where(and(eq(intake.project_id, projectId), eq(intake.is_default, true), isNull(intake.deleted_at)))
    .get();
}

/** The project's default intake, created on demand (updateProjectFeatures normally creates it with the triage state). */
export function ensureDefaultIntake(ctx: TesseraContext, projectId: string): string {
  assertInTransaction(ctx, "ensureDefaultIntake");
  const existing = findDefaultIntake(ctx, projectId);
  if (existing) return existing.id;
  const now = ctx.now();
  const row = ctx.db
    .insert(intake)
    .values({
      id: newId(),
      project_id: projectId,
      name: DEFAULT_INTAKE_NAME,
      is_default: true,
      created_at: now,
      updated_at: now,
      created_by: ctx.actor.id,
      updated_by: ctx.actor.id,
    })
    .returning({ id: intake.id })
    .get();
  logActivity(ctx, { project_id: projectId, entity_type: "intake", entity_id: row.id, verb: "created", new_identifier: DEFAULT_INTAKE_NAME });
  return row.id;
}

export function recordIntakeItem(ctx: TesseraContext, projectRow: ProjectRow, item: WorkItemRow, source: IntakeSource): void {
  assertInTransaction(ctx, "recordIntakeItem");
  const now = ctx.now();
  const row = ctx.db
    .insert(intake_item)
    .values({
      id: newId(),
      intake_id: ensureDefaultIntake(ctx, projectRow.id),
      work_item_id: item.id,
      status: "pending",
      source,
      created_by_actor_id: ctx.actor.id,
      created_at: now,
      updated_at: now,
      created_by: ctx.actor.id,
      updated_by: ctx.actor.id,
    })
    .returning({ id: intake_item.id })
    .get();
  logActivity(ctx, {
    project_id: projectRow.id,
    entity_type: "intake_item",
    entity_id: row.id,
    work_item_id: item.id,
    verb: "created",
    new_identifier: itemKey(projectRow, item),
  });
  notifyIntakeReceived(ctx, {
    intake_item_id: row.id,
    work_item_id: item.id,
    project_id: projectRow.id,
    title: item.name,
    key: itemKey(projectRow, item),
  });
}

/**
 * True when this call must land in Intake. An agent with access `intake`
 * always does, and a project with Intake off refuses that create.
 */
export function intakeRequired(ctx: TesseraContext, projectRow: ProjectRow): boolean {
  if (ctx.actor.kind !== "agent") return false;
  if (ctx.actor.access === "intake") {
    if (!projectRow.intake_enabled) throw rule("intake_disabled", "Intake is turned off in this project");
    return true;
  }
  return projectRow.intake_enabled && projectRow.agent_intake_required;
}
