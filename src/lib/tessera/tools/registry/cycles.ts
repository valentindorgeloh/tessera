import { z } from "zod";
import {
  addWorkItemsToCycle,
  archiveCycle,
  createCycle,
  CreateCycleInput,
  CycleWorkItemIdsInput,
  deleteCycle,
  getActiveCycles,
  getCycle,
  getCycleProgress,
  GetCycleProgressInput,
  listCycles,
  ListCyclesInput,
  removeWorkItemsFromCycle,
  reorderCycle,
  ReorderCycleInput,
  transferCycleWorkItems,
  TransferCycleWorkItemsInput,
  unarchiveCycle,
  updateCycle,
  UpdateCycleInput,
} from "../../cycles";
import { IdSchema } from "../../schemas";
import { defineTool } from "../define";
import { ProjectId, CycleId, EmptyInput, CycleIdInput, deleted, toListResult } from "./shared";

// ---------------------------------------------------------------------------
// Cycles (P3)
// ---------------------------------------------------------------------------

const CycleWorkItemsInput = z
  .object({
    cycle_id: CycleId,
    work_item_ids: CycleWorkItemIdsInput.describe("Work item ids of the cycle's project (1 to 500)."),
  })
  .strict();

export const cycleTools = [
  defineTool({
    name: "list_cycles",
    title: "List cycles",
    description:
      "Lists the cycles of a project in sequence order with their derived status (current, upcoming, completed or draft for cycles without dates) and progress counts; filter by status, or pass archived: true for archived cycles. Each cycle carries open_count, the number of items transfer_cycle_work_items would move.",
    input: ListCyclesInput.extend({ project_id: ProjectId }),
    mutates: false,
    core: true,
    phase: "P3",
    run: (ctx, { project_id, ...input }) => toListResult(ctx, listCycles(ctx, project_id, input)),
  }),
  defineTool({
    name: "get_cycle",
    title: "Get cycle",
    description: "Returns one cycle with its derived status, dates, open_count and progress (issues mode).",
    input: CycleIdInput,
    mutates: false,
    core: true,
    phase: "P3",
    run: (ctx, { cycle_id }) => getCycle(ctx, cycle_id),
  }),
  defineTool({
    name: "create_cycle",
    title: "Create cycle",
    description:
      "Creates a cycle in a project. Set start_date and end_date together (end on or after start) or leave both empty for a draft; the date range may not overlap another active cycle of the project (CONFLICT). Names need not be unique.",
    input: CreateCycleInput,
    mutates: true,
    phase: "P3",
    run: (ctx, input) => createCycle(ctx, input),
  }),
  defineTool({
    name: "update_cycle",
    title: "Update cycle",
    description:
      "Changes a cycle's name, description or dates; dates change together, must stay in order and may not overlap another active cycle. Completed cycles are read-only (LOCKED) and archived cycles reject changes (ARCHIVED).",
    input: UpdateCycleInput.extend({ cycle_id: CycleId }),
    mutates: true,
    phase: "P3",
    run: (ctx, { cycle_id, ...patch }) => updateCycle(ctx, cycle_id, patch),
  }),
  defineTool({
    name: "reorder_cycle",
    title: "Reorder cycle",
    description: "Moves a cycle directly before or after another active cycle of the same project; before_id or after_id is required. Allowed on completed cycles, refused on archived ones (ARCHIVED).",
    input: ReorderCycleInput.extend({ cycle_id: CycleId }),
    mutates: true,
    phase: "P3",
    run: (ctx, { cycle_id, ...input }) => reorderCycle(ctx, cycle_id, input),
  }),
  defineTool({
    name: "archive_cycle",
    title: "Archive cycle",
    description: "Archives a cycle; only cycles whose end date has passed can be archived (RULE cycle_not_ended). Archived cycles leave the default list and are read-only.",
    input: CycleIdInput,
    mutates: true,
    phase: "P3",
    run: (ctx, { cycle_id }) => archiveCycle(ctx, cycle_id),
  }),
  defineTool({
    name: "unarchive_cycle",
    title: "Unarchive cycle",
    description: "Restores an archived cycle; RULE not_archived when it is not archived; CONFLICT when its dates now overlap another active cycle; the frozen snapshot stays.",
    input: CycleIdInput,
    mutates: true,
    phase: "P3",
    run: (ctx, { cycle_id }) => unarchiveCycle(ctx, cycle_id),
  }),
  defineTool({
    name: "delete_cycle",
    title: "Delete cycle",
    description: "Soft-deletes a cycle and detaches its work items (one activity row each), which stay in the project with no cycle. Allowed on archived cycles; a completed cycle must be archived first (LOCKED). Destructive.",
    input: CycleIdInput,
    mutates: true,
    destructive: true,
    phase: "P3",
    run: (ctx, { cycle_id }) => {
      deleteCycle(ctx, cycle_id);
      return deleted(cycle_id);
    },
  }),
  defineTool({
    name: "add_work_items_to_cycle",
    title: "Add work items to cycle",
    description:
      "Moves work items into a cycle (an item belongs to at most one cycle, so it leaves its previous one). Items must belong to the cycle's project, must not be archived and must not be completed or cancelled; neither the target cycle nor the cycle an item leaves may be completed (LOCKED) or archived (ARCHIVED); use transfer_cycle_work_items for a completed cycle.",
    input: CycleWorkItemsInput,
    mutates: true,
    phase: "P3",
    run: (ctx, { cycle_id, work_item_ids }) => addWorkItemsToCycle(ctx, cycle_id, work_item_ids),
  }),
  defineTool({
    name: "remove_work_items_from_cycle",
    title: "Remove work items from cycle",
    description: "Takes work items out of a cycle; items not in the cycle are ignored. The cycle must not be completed or archived.",
    input: CycleWorkItemsInput,
    mutates: true,
    phase: "P3",
    run: (ctx, { cycle_id, work_item_ids }) => removeWorkItemsFromCycle(ctx, cycle_id, work_item_ids),
  }),
  defineTool({
    name: "transfer_cycle_work_items",
    title: "Transfer open work items",
    description:
      "Moves the open (not completed or cancelled) items of a completed cycle into to_cycle_id, a cycle of the same project that is neither completed nor archived, or out of any cycle when to_cycle_id is null. Only completed cycles transfer (RULE cycle_not_completed). Returns the number moved. Destructive.",
    input: TransferCycleWorkItemsInput.extend({ cycle_id: IdSchema.describe("Completed cycle whose open items move.") }),
    mutates: true,
    destructive: true,
    phase: "P3",
    run: (ctx, { cycle_id, ...input }) => transferCycleWorkItems(ctx, cycle_id, input),
  }),
  defineTool({
    name: "get_cycle_progress",
    title: "Get cycle progress",
    description:
      "Returns a cycle's progress: totals by state group, item counts per state, label and assignee (with completed counts per label and assignee), and the pending amount per day from start_date to min(end_date, today) for burndown and burnup charts. There is no ideal line and no scope-per-day series: derive the ideal line from the dates and total minus cancelled, and treat scope as today's total. mode issues counts items; mode points sums estimate point values when the project has an active estimate, and chart_mode says which unit the series uses. A cycle whose open items were transferred, or an archived one, returns its frozen snapshot.",
    input: GetCycleProgressInput.extend({ cycle_id: CycleId }),
    mutates: false,
    core: true,
    phase: "P3",
    run: (ctx, { cycle_id, ...input }) => getCycleProgress(ctx, cycle_id, input),
  }),
  defineTool({
    name: "list_active_cycles",
    title: "List active cycles",
    description: "Lists the current cycles (date range includes today) of every non-archived project, earliest start first, each with full progress.",
    input: EmptyInput,
    mutates: false,
    phase: "P3",
    run: (ctx) => toListResult(ctx, getActiveCycles(ctx)),
  }),
];
