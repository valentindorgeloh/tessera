import { z } from "zod";
import { latestSeq } from "../../activity";
import type { TesseraContext } from "../../core/context";
import { IdSchema } from "../../schemas";
import { type ListResult } from "../../work-items";

// ---------------------------------------------------------------------------
// Shared input pieces and result shapes
// ---------------------------------------------------------------------------

export const ProjectId = IdSchema.describe("Project id.");
export const StateId = IdSchema.describe("State id.");
export const LabelId = IdSchema.describe("Label id.");
export const ActorId = IdSchema.describe("Actor id.");
export const WorkItemId = IdSchema.describe("Work item id.");
export const CycleId = IdSchema.describe("Cycle id.");
export const ModuleId = IdSchema.describe("Module id.");
export const ViewId = IdSchema.describe("View id.");
export const LinkId = IdSchema.describe("Link id.");

export const EmptyInput = z.object({}).strict();
export const ProjectIdInput = z.object({ project_id: ProjectId }).strict();
/** get_project is the one tool that resolves a project identifier as well as an id (the service already does). */
export const GetProjectInput = z.object({ project_id: z.string().min(1).describe("Project id, or the project identifier such as WEB.") }).strict();
export const StateIdInput = z.object({ state_id: StateId }).strict();
export const LabelIdInput = z.object({ label_id: LabelId }).strict();
export const WorkItemIdInput = z.object({ work_item_id: WorkItemId }).strict();
export const CycleIdInput = z.object({ cycle_id: CycleId }).strict();
export const ModuleIdInput = z.object({ module_id: ModuleId }).strict();
export const ViewIdInput = z.object({ view_id: ViewId }).strict();
export const LinkIdInput = z.object({ link_id: LinkId }).strict();

/** What `delete_*` tools return: the soft-deleted entity's id. */
export type DeleteResult = { id: string; deleted: true };

/** What `remove_*` tools that drop a row (links) return. */
export type RemoveResult = { id: string; removed: true };

export function deleted(id: string): DeleteResult {
  return { id, deleted: true };
}

export function removed(id: string): RemoveResult {
  return { id, removed: true };
}

/** List tools return ListResult; the cursor lets a page start the change poller without a second query. */
export function toListResult<T>(ctx: TesseraContext, items: T[]): ListResult<T> {
  return { items, total: items.length, cursor: latestSeq(ctx) };
}
