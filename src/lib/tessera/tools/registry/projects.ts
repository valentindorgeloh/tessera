import {
  archiveProject,
  createProject,
  CreateProjectInput,
  deleteProject,
  getProject,
  listProjects,
  ListProjectsInput,
  unarchiveProject,
  updateProject,
  UpdateProjectInput,
  updateProjectFeatures,
  UpdateProjectFeaturesInput,
} from "../../projects";
import { defineTool } from "../define";
import { ProjectId, EmptyInput, ProjectIdInput, GetProjectInput, deleted, toListResult } from "./shared";

// ---------------------------------------------------------------------------
// Projects (P1)
// ---------------------------------------------------------------------------

export const projectTools = [
  defineTool({
    name: "list_projects",
    title: "List projects",
    description:
      "Lists the workspace's projects with their feature toggles. Active projects by default; pass archived: true to list archived ones instead. Deleted projects never appear.",
    input: ListProjectsInput,
    mutates: false,
    core: true,
    phase: "P1",
    run: (ctx, input) => toListResult(ctx, listProjects(ctx, input)),
  }),
  defineTool({
    name: "get_project",
    title: "Get project",
    description: "Returns one project by id or by its identifier such as WEB. NOT_FOUND for deleted projects. A former identifier resolves the same way.",
    input: GetProjectInput,
    mutates: false,
    core: true,
    phase: "P1",
    run: (ctx, { project_id }) => getProject(ctx, project_id),
  }),
  defineTool({
    name: "create_project",
    title: "Create project",
    description:
      "Creates a project and seeds its default states. The name is unique across the workspace (case-insensitive) and the identifier (2 to 12 letters or digits starting with a letter, upper-cased) becomes the key prefix of its work items; both fail with CONFLICT when taken. Cycles, modules, views and pages are on unless features says otherwise.",
    input: CreateProjectInput,
    mutates: true,
    core: true,
    phase: "P1",
    run: (ctx, input) => createProject(ctx, input),
  }),
  defineTool({
    name: "update_project",
    title: "Update project",
    description:
      "Changes project fields. A new identifier renames every work item key with it; name and identifier stay unique across the workspace. close_state_id must belong to the project. Archived projects are read-only (ARCHIVED).",
    input: UpdateProjectInput.extend({ project_id: ProjectId }),
    mutates: true,
    phase: "P1",
    run: (ctx, { project_id, ...patch }) => updateProject(ctx, project_id, patch),
  }),
  defineTool({
    name: "update_project_features",
    title: "Update project features",
    description:
      "Toggles the project's features. Enabling intake creates the hidden triage state; intake cannot be disabled while intake items are pending (RULE intake_pending). agent_intake_required sends work items created by agents to Intake instead of the board.",
    input: UpdateProjectFeaturesInput.extend({ project_id: ProjectId }),
    mutates: true,
    phase: "P1",
    run: (ctx, { project_id, ...patch }) => updateProjectFeatures(ctx, project_id, patch),
  }),
  defineTool({
    name: "archive_project",
    title: "Archive project",
    description: "Archives a project: it and everything in it become read-only and leave the default lists until unarchive_project.",
    input: ProjectIdInput,
    mutates: true,
    phase: "P1",
    run: (ctx, { project_id }) => archiveProject(ctx, project_id),
  }),
  defineTool({
    name: "unarchive_project",
    title: "Unarchive project",
    description: "Restores an archived project to the active list; RULE not_archived when it is not archived.",
    input: ProjectIdInput,
    mutates: true,
    phase: "P1",
    run: (ctx, { project_id }) => unarchiveProject(ctx, project_id),
  }),
  defineTool({
    name: "delete_project",
    title: "Delete project",
    description:
      "Soft-deletes a project together with its states, labels, work items, cycles, modules, views and intakes in one transaction; works on archived projects too. Destructive: the UI confirms, assistant proposals are confirmed before they run and MCP requires confirm: true.",
    input: ProjectIdInput,
    mutates: true,
    destructive: true,
    phase: "P1",
    run: (ctx, { project_id }) => {
      deleteProject(ctx, project_id);
      return deleted(project_id);
    },
  }),
  defineTool({
    name: "list_archived_projects",
    title: "List archived projects",
    description: "Lists archived projects only; the same rows list_projects returns with archived: true.",
    input: EmptyInput,
    mutates: false,
    phase: "P1",
    run: (ctx) => toListResult(ctx, listProjects(ctx, { archived: true })),
  }),
];
