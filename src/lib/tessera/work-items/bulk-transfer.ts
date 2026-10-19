/**
 * Bulk copy and move between projects (decision 107): P8's single-item
 * transfer rules applied to every item in one transaction, all or nothing.
 * A move needs `confirm: true` because the old keys stop resolving.
 */
import { z } from "zod";
import type { TesseraContext } from "../core/context";
import { validateInput, validation } from "../core/errors";
import { withTx } from "../core/tx";
import { IdListSchema, IdSchema } from "../schemas";
import { copyWorkItem, moveWorkItemToProject } from "./transfer";

/** decision 107: at most 100 items per call. */
export const MAX_BULK_TRANSFER = 100;

export const BulkTransferWorkItemsInput = z
  .object({
    work_item_ids: IdListSchema.min(1).max(MAX_BULK_TRANSFER).describe("Work items to copy or move, at most 100."),
    project_id: IdSchema.describe("Target project."),
    mode: z.enum(["copy", "move"]).describe("copy creates new items named \"<name> (Copy)\"; move keeps the items and gives them new keys."),
    confirm: z.boolean().optional().describe("Required true for mode move, because the old keys stop resolving."),
  })
  .strict();

export type BulkTransferWorkItemsInputType = z.input<typeof BulkTransferWorkItemsInput>;

/** Copies or moves every item into `project_id`, or none of them when any item is refused. Returns the new items in input order. */
export function bulkTransferWorkItems(ctx: TesseraContext, input: BulkTransferWorkItemsInputType): { id: string; key: string }[] {
  const data = validateInput(BulkTransferWorkItemsInput, input);
  if (data.mode === "move" && data.confirm !== true) {
    throw validation([{ path: ["confirm"], message: "Moving work items needs confirm: true" }], "Moving work items needs confirm: true");
  }
  return withTx(ctx, () => {
    const unique = [...new Set(data.work_item_ids)];
    return unique.map((id) => {
      const result = data.mode === "copy" ? copyWorkItem(ctx, id, { project_id: data.project_id }) : moveWorkItemToProject(ctx, id, { project_id: data.project_id });
      return { id: result.id, key: result.key };
    });
  });
}
