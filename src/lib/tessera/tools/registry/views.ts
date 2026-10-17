import { getViewSettings, resetViewSettings, saveViewSettings, SaveViewSettingsInput, ViewSettingsScopeInput } from "../../view-settings";
import {
  createView,
  CreateViewInput,
  deleteView,
  duplicateView,
  getView,
  listViews,
  ListViewsInput,
  lockView,
  reorderView,
  ReorderViewInput,
  unlockView,
  updateView,
  UpdateViewInput,
} from "../../views";
import { defineTool } from "../define";
import { ViewId, ViewIdInput, deleted, toListResult } from "./shared";

// ---------------------------------------------------------------------------
// Views and view settings (P4)
// ---------------------------------------------------------------------------

const SaveViewSettingsToolInput = ViewSettingsScopeInput.extend(SaveViewSettingsInput.shape);

export const viewTools = [
  defineTool({
    name: "list_views",
    title: "List views",
    description: "Lists the saved views of a project, or the workspace views when project_id is null, with their filters, display and lock state.",
    input: ListViewsInput,
    mutates: false,
    core: true,
    phase: "P4",
    run: (ctx, input) => toListResult(ctx, listViews(ctx, input)),
  }),
  defineTool({
    name: "get_view",
    title: "Get view",
    description: "Returns one saved view with its filters, rich filters, display settings and lock state.",
    input: ViewIdInput,
    mutates: false,
    phase: "P4",
    run: (ctx, { view_id }) => getView(ctx, view_id),
  }),
  defineTool({
    name: "create_view",
    title: "Create view",
    description:
      "Saves a view in a project or, with project_id null, in the workspace. Names are unique within the project or among workspace views (case-insensitive, CONFLICT otherwise); display is merged over the defaults and workspace views accept only the table layout. Use describe_filters for the filter and display vocabulary. RULE feature_disabled while the project has the feature turned off.",
    input: CreateViewInput,
    mutates: true,
    phase: "P4",
    run: (ctx, input) => createView(ctx, input),
  }),
  defineTool({
    name: "update_view",
    title: "Update view",
    description: "Changes a view's name, description, filters, rich filters, display or logo. Locked views reject changes (LOCKED); unlock first. filters replaces the saved filters while display merges over them.",
    input: UpdateViewInput.extend({ view_id: ViewId }),
    mutates: true,
    phase: "P4",
    run: (ctx, { view_id, ...patch }) => updateView(ctx, view_id, patch),
  }),
  defineTool({
    name: "duplicate_view",
    title: "Duplicate view",
    description: "Creates an unlocked copy at the end of the same scope with a derived unique name and the same filters, rich filters, display and logo; the source may be locked. RULE feature_disabled while the project has the feature turned off.",
    input: ViewIdInput,
    mutates: true,
    phase: "P4",
    run: (ctx, { view_id }) => duplicateView(ctx, view_id),
  }),
  defineTool({
    name: "lock_view",
    title: "Lock view",
    description: "Locks a view so its filters and display cannot change until unlock_view; locking a locked view fails with LOCKED.",
    input: ViewIdInput,
    mutates: true,
    phase: "P4",
    run: (ctx, { view_id }) => lockView(ctx, view_id),
  }),
  defineTool({
    name: "unlock_view",
    title: "Unlock view",
    description: "Unlocks a locked view; RULE not_locked when it is not locked.",
    input: ViewIdInput,
    mutates: true,
    phase: "P4",
    run: (ctx, { view_id }) => unlockView(ctx, view_id),
  }),
  defineTool({
    name: "reorder_view",
    title: "Reorder view",
    description:
      "Moves a view directly before or after another view of the same scope (the same project, or the workspace); before_id or after_id is required. Works on locked views: the order is not view content.",
    input: ReorderViewInput.extend({ view_id: ViewId }),
    mutates: true,
    phase: "P4",
    run: (ctx, { view_id, ...input }) => reorderView(ctx, view_id, input),
  }),
  defineTool({
    name: "delete_view",
    title: "Delete view",
    description: "Soft-deletes a saved view; locked views must be unlocked first. Destructive.",
    input: ViewIdInput,
    mutates: true,
    destructive: true,
    phase: "P4",
    run: (ctx, { view_id }) => {
      deleteView(ctx, view_id);
      return deleted(view_id);
    },
  }),
  defineTool({
    name: "get_view_settings",
    title: "Get view settings",
    description:
      "Returns the filters and display the UI applies for a scope (project, cycle, module, workspace, profile, archived or draft list, identified by scope_id; the workspace scope uses scope_id workspace); the defaults when nothing was saved.",
    input: ViewSettingsScopeInput,
    mutates: false,
    phase: "P4",
    run: (ctx, { scope_type, scope_id }) => getViewSettings(ctx, scope_type, scope_id),
  }),
  defineTool({
    name: "save_view_settings",
    title: "Save view settings",
    description:
      "Merges filter keys and display keys over the settings stored for a scope and returns the result; an empty filter list clears that key. Saved settings are per scope, not per view.",
    input: SaveViewSettingsToolInput,
    mutates: true,
    phase: "P4",
    run: (ctx, { scope_type, scope_id, ...input }) => saveViewSettings(ctx, scope_type, scope_id, input),
  }),
  defineTool({
    name: "reset_view_settings",
    title: "Reset view settings",
    description: "Drops the settings stored for a scope so the defaults apply again, and returns those defaults.",
    input: ViewSettingsScopeInput,
    mutates: true,
    phase: "P4",
    run: (ctx, { scope_type, scope_id }) => resetViewSettings(ctx, scope_type, scope_id),
  }),
];
