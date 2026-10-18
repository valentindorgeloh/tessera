/**
 * Reorder a project among the live projects. Lives beside projects.ts because
 * that file is at the line budget.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { logActivity } from "./activity";
import type { TesseraContext } from "./core/context";
import { archived, validateInput } from "./core/errors";
import { sortOrderForMove } from "./core/order";
import { withTx } from "./core/tx";
import { project } from "./db/schema";
import { getProject, getProjectRow } from "./projects";
import { IdSchema } from "./schemas";
import type { Project } from "./projects";

export const ReorderProjectInput = z
  .object({
    before_id: IdSchema.optional().describe("Project that will come directly before this one."),
    after_id: IdSchema.optional().describe("Project that will come directly after this one."),
  })
  .strict()
  .refine((value) => value.before_id !== undefined || value.after_id !== undefined, { message: "before_id or after_id is required" });

export type ReorderProjectInputType = z.input<typeof ReorderProjectInput>;

export function reorderProject(ctx: TesseraContext, id: string, input: ReorderProjectInputType): Project {
  const data = validateInput(ReorderProjectInput, input);
  return withTx(ctx, () => {
    const before = getProjectRow(ctx, id);
    if (before.archived_at !== null) throw archived(`project ${before.identifier} is archived`);
    const rows = ctx.db
      .select({ id: project.id, sort_order: project.sort_order, archived_at: project.archived_at })
      .from(project)
      .where(and(isNull(project.deleted_at)))
      .orderBy(asc(project.sort_order))
      .all();
    const sort_order = sortOrderForMove(rows, id, data.before_id, data.after_id, "project");
    const now = ctx.now();
    ctx.db.update(project).set({ sort_order, updated_at: now, updated_by: ctx.actor.id }).where(eq(project.id, id)).run();
    if (before.sort_order !== sort_order) {
      logActivity(ctx, {
        project_id: id,
        entity_type: "project",
        entity_id: id,
        verb: "moved",
        field: "sort_order",
        old_value: before.sort_order,
        new_value: sort_order,
      });
    }
    return getProject(ctx, id);
  });
}
