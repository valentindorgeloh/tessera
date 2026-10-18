import { z } from "zod";
import { createExport, CreateExportInput, deleteExport, getExport, listExports } from "../../exports";
import { IdSchema } from "../../schemas";
import { defineTool } from "../define";

const ExportIdInput = z.object({ export_id: IdSchema.describe("Export job id.") }).strict();

const ListExportsInput = z
  .object({
    limit: z.number().int().min(1).max(200).optional().describe("How many jobs, newest first. Default 100."),
  })
  .strict();

export const exportTools = [
  defineTool({
    name: "create_export",
    title: "Create export",
    description: "Writes a CSV or JSON file of the work items in scope and records the job. CSV is UTF-8 with a byte order mark so a spreadsheet opens it.",
    input: CreateExportInput,
    mutates: true,
    phase: "P10",
    run: (ctx, input) => createExport(ctx, input),
  }),
  defineTool({
    name: "list_exports",
    title: "List exports",
    description: "Lists export jobs, newest first, without the file path.",
    input: ListExportsInput,
    mutates: false,
    phase: "P10",
    run: (ctx, input) => listExports(ctx, input),
  }),
  defineTool({
    name: "get_export",
    title: "Get export",
    description: "Returns one export job, including the file path when the file was written.",
    input: ExportIdInput,
    mutates: false,
    phase: "P10",
    run: (ctx, { export_id }) => getExport(ctx, export_id),
  }),
  defineTool({
    name: "delete_export",
    title: "Delete export",
    description: "Removes an export job and its file. An export is a log entry, so the row is deleted rather than archived. Destructive: requires confirm: true.",
    input: ExportIdInput,
    mutates: true,
    destructive: true,
    phase: "P10",
    run: (ctx, { export_id }) => {
      deleteExport(ctx, export_id);
      return { deleted: true };
    },
  }),
];
