import { z } from "zod";
import { createDraft, deleteDraft, DraftFieldsInput, getDraft, listDrafts, moveDraftToProject, updateDraft } from "../../drafts";
import { IdSchema } from "../../schemas";
import { defineTool } from "../define";
import { deleted } from "./shared";

const DraftId = IdSchema.describe("Draft id.");
const IdInput = z.object({ draft_id: DraftId }).strict();

const ListInput = z
  .object({
    project_id: IdSchema.optional().describe("Only drafts for this project."),
    limit: z.number().int().min(1).max(500).optional().describe("How many drafts to return, newest first. Defaults to 200."),
  })
  .strict();

const MoveInput = z
  .object({
    draft_id: DraftId,
    project_id: IdSchema.optional().describe("Project to create the work item in, when the draft has none."),
  })
  .strict();

export const draftTools = [
  defineTool({
    name: "list_drafts",
    title: "List drafts",
    description: "Lists workspace drafts, newest first. Drafts are not work items: they stay out of search, the board and counts until they are moved into a project.",
    input: ListInput,
    mutates: false,
    phase: "P8",
    run: (ctx, input) => listDrafts(ctx, input),
  }),
  defineTool({
    name: "get_draft",
    title: "Get draft",
    description: "Returns one draft by id, including its project when it has one and the fields saved for that project.",
    input: IdInput,
    mutates: false,
    phase: "P8",
    run: (ctx, { draft_id }) => getDraft(ctx, draft_id),
  }),
  defineTool({
    name: "create_draft",
    title: "Create draft",
    description: "Creates a workspace draft. The name may be empty. State, parent, cycle, labels, modules and estimate need a project and follow the work item create rules.",
    input: DraftFieldsInput,
    mutates: true,
    phase: "P8",
    run: (ctx, input) => createDraft(ctx, input),
  }),
  defineTool({
    name: "update_draft",
    title: "Update draft",
    description: "Changes a draft. Only the keys sent change. Changing the project clears state, parent, cycle, labels, modules and estimate unless the same call sets new ones.",
    input: DraftFieldsInput.extend({ draft_id: DraftId }),
    mutates: true,
    phase: "P8",
    run: (ctx, { draft_id, ...patch }) => updateDraft(ctx, draft_id, patch),
  }),
  defineTool({
    name: "delete_draft",
    title: "Delete draft",
    description: "Soft-deletes a draft. The draft leaves the drafts list. Destructive: the UI confirms and MCP requires confirm: true.",
    input: IdInput,
    mutates: true,
    destructive: true,
    phase: "P8",
    run: (ctx, { draft_id }) => {
      deleteDraft(ctx, draft_id);
      return deleted(draft_id);
    },
  }),
  defineTool({
    name: "move_draft_to_project",
    title: "Move draft to project",
    description: "Creates a work item from the draft and soft-deletes the draft in one transaction. An empty name is VALIDATION. Stale labels, cycles and modules are dropped and reported. Agent intake policy applies.",
    input: MoveInput,
    mutates: true,
    phase: "P8",
    run: (ctx, { draft_id, project_id }) => moveDraftToProject(ctx, draft_id, { project_id }),
  }),
];
