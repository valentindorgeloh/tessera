import { createLabel, CreateLabelInput, deleteLabel, listLabels, reorderLabel, ReorderLabelInput, updateLabel, UpdateLabelInput } from "../../labels";
import { defineTool } from "../define";
import { LabelId, ProjectIdInput, LabelIdInput, deleted, toListResult } from "./shared";

// ---------------------------------------------------------------------------
// Labels (P1)
// ---------------------------------------------------------------------------

export const labelTools = [
  defineTool({
    name: "list_labels",
    title: "List labels",
    description: "Lists the labels of a project in sequence order; nested labels carry their parent_id.",
    input: ProjectIdInput,
    mutates: false,
    core: true,
    phase: "P1",
    run: (ctx, { project_id }) => toListResult(ctx, listLabels(ctx, project_id)),
  }),
  defineTool({
    name: "create_label",
    title: "Create label",
    description:
      "Creates a label in a project. Names are unique per project (case-insensitive, CONFLICT otherwise). parent_id nests it under a top-level label of the same project; labels nest one level deep (RULE label_depth).",
    input: CreateLabelInput,
    mutates: true,
    phase: "P1",
    run: (ctx, input) => createLabel(ctx, input),
  }),
  defineTool({
    name: "update_label",
    title: "Update label",
    description:
      "Renames, recolours or re-parents a label. A label cannot be its own parent, a label with children cannot be nested, and the parent must be a top-level label of the same project; null parent_id moves it to the top level.",
    input: UpdateLabelInput.extend({ label_id: LabelId }),
    mutates: true,
    phase: "P1",
    run: (ctx, { label_id, ...patch }) => updateLabel(ctx, label_id, patch),
  }),
  defineTool({
    name: "reorder_label",
    title: "Reorder label",
    description: "Moves a label directly before or after another label of the same project; before_id or after_id is required.",
    input: ReorderLabelInput.extend({ label_id: LabelId }),
    mutates: true,
    phase: "P1",
    run: (ctx, { label_id, ...input }) => reorderLabel(ctx, label_id, input),
  }),
  defineTool({
    name: "delete_label",
    title: "Delete label",
    description: "Soft-deletes a label and its child labels, detaches them from every work item and page, and strips them from the saved filters of the project's views, of workspace views and of remembered list settings. Destructive. Its id is removed from every saved view and remembered view setting that filters on it.",
    input: LabelIdInput,
    mutates: true,
    destructive: true,
    phase: "P1",
    run: (ctx, { label_id }) => {
      deleteLabel(ctx, label_id);
      return deleted(label_id);
    },
  }),
];
