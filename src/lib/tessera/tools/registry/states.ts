import {
  createState,
  CreateStateInput,
  deleteState,
  DeleteStateInput,
  listStates,
  reorderState,
  ReorderStateInput,
  setDefaultState,
  updateState,
  UpdateStateInput,
} from "../../states";
import { defineTool } from "../define";
import { StateId, ProjectIdInput, StateIdInput, deleted, toListResult } from "./shared";

// ---------------------------------------------------------------------------
// States (P1)
// ---------------------------------------------------------------------------

export const stateTools = [
  defineTool({
    name: "list_states",
    title: "List states",
    description: "Lists the states of a project in sequence order with their group, colour and default flag.",
    input: ProjectIdInput,
    mutates: false,
    core: true,
    phase: "P1",
    run: (ctx, { project_id }) => toListResult(ctx, listStates(ctx, project_id)),
  }),
  defineTool({
    name: "create_state",
    title: "Create state",
    description:
      "Creates a state in a project. Names are unique per project (case-insensitive, CONFLICT otherwise); the group is one of backlog, unstarted, started, completed or cancelled and cannot change later. is_default makes it the project default and clears the previous one. Archived projects reject changes.",
    input: CreateStateInput,
    mutates: true,
    phase: "P1",
    run: (ctx, input) => createState(ctx, input),
  }),
  defineTool({
    name: "update_state",
    title: "Update state",
    description: "Renames, recolours or re-describes a state; the group is fixed at creation and the new name stays unique within the project.",
    input: UpdateStateInput.extend({ state_id: StateId }),
    mutates: true,
    phase: "P1",
    run: (ctx, { state_id, ...patch }) => updateState(ctx, state_id, patch),
  }),
  defineTool({
    name: "reorder_state",
    title: "Reorder state",
    description: "Moves a state directly before or after another state of the same project; before_id or after_id is required.",
    input: ReorderStateInput.extend({ state_id: StateId }),
    mutates: true,
    phase: "P1",
    run: (ctx, { state_id, ...input }) => reorderState(ctx, state_id, input),
  }),
  defineTool({
    name: "set_default_state",
    title: "Set default state",
    description: "Makes the state the project's default for new work items and clears the flag on the previous default. The triage state cannot be the default (RULE triage_default).",
    input: StateIdInput,
    mutates: true,
    phase: "P1",
    run: (ctx, { state_id }) => setDefaultState(ctx, state_id),
  }),
  defineTool({
    name: "delete_state",
    title: "Delete state",
    description:
      "Soft-deletes a state. The default state, the triage state and the last state of a group cannot be deleted (RULE). When work items still sit in the state, move_to_state_id names a different visible state of the same project that receives them (never the triage state); without it the call fails with RULE state_not_empty. Destructive.",
    input: DeleteStateInput.extend({ state_id: StateId }),
    mutates: true,
    destructive: true,
    phase: "P1",
    run: (ctx, { state_id, ...options }) => {
      deleteState(ctx, state_id, options);
      return deleted(state_id);
    },
  }),
];
