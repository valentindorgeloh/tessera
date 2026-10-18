import { z } from "zod";
import { getWorkItemVersion, listWorkItemVersions, ListWorkItemVersionsInput, restoreWorkItemVersion, RestoreWorkItemVersionInput } from "../../work-items";
import { IdSchema } from "../../schemas";
import { defineTool } from "../define";

const VersionIdInput = z.object({ version_id: IdSchema.describe("Version id.") }).strict();

export const historyTools = [
  defineTool({
    name: "list_work_item_versions",
    title: "List work item versions",
    description: "Lists stored descriptions of a work item, newest first, without the bodies.",
    input: ListWorkItemVersionsInput,
    mutates: false,
    core: true,
    phase: "P10",
    run: (ctx, input) => listWorkItemVersions(ctx, input),
  }),
  defineTool({
    name: "get_work_item_version",
    title: "Get work item version",
    description: "Returns one stored description, including the Markdown body.",
    input: VersionIdInput,
    mutates: false,
    phase: "P10",
    run: (ctx, { version_id }) => getWorkItemVersion(ctx, version_id),
  }),
  defineTool({
    name: "restore_work_item_version",
    title: "Restore work item version",
    description: "Restores a stored description. The name is left unchanged. Needs the current description version. Destructive: requires confirm: true.",
    input: RestoreWorkItemVersionInput,
    mutates: true,
    destructive: true,
    core: true,
    phase: "P10",
    run: (ctx, input) => {
      const item = restoreWorkItemVersion(ctx, input);
      return { id: item.id, description_version: item.description_version };
    },
  }),
];
