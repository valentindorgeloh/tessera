/**
 * Work item exports. `create_export` writes the file during the tool call
 * and records an `export_job` of status done or failed. CSV opens in a
 * spreadsheet; JSON keeps ids next to the resolved names.
 */
import fs from "node:fs";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { logActivity } from "../activity";
import { toCsv } from "../core/csv";
import type { TesseraContext } from "../core/context";
import { isTrackerError, notFound, validateInput } from "../core/errors";
import { newId } from "../core/ids";
import { withTx } from "../core/tx";
import { export_job } from "../db/schema";
import { ExportFormatSchema, ExportScopeSchema } from "../schemas";
import type { ExportFormat, ExportJobView, ExportScope } from "../types";
import { exportFileName, exportsDir } from "./files";
import { CSV_HEADER, csvRows, exportRows } from "./rows";

export const CreateExportInput = z
  .object({
    format: ExportFormatSchema.describe("csv opens in a spreadsheet; json keeps ids and names."),
    scope: ExportScopeSchema.describe("Which work items to export."),
    name: z.string().max(120).optional().describe("Title stored on the job and used in the file name."),
  })
  .strict();

function fileNameOf(filePath: string | null): string | null {
  return filePath === null ? null : path.basename(filePath);
}

function toView(row: typeof export_job.$inferSelect): ExportJobView {
  return {
    id: row.id,
    name: row.name,
    format: row.format,
    status: row.status,
    row_count: row.row_count,
    error: row.error,
    file_name: fileNameOf(row.file_path),
    created_at: row.created_at,
    created_by: row.created_by,
  };
}

function render(format: ExportFormat, scope: ExportScope, exportedAt: string, items: ReturnType<typeof exportRows>): string {
  if (format === "csv") return toCsv([...CSV_HEADER], csvRows(items));
  return JSON.stringify({ exported_at: exportedAt, scope, count: items.length, items }, null, 2);
}

export function createExport(ctx: TesseraContext, input: z.input<typeof CreateExportInput>): ExportJobView {
  const data = validateInput(CreateExportInput, input);
  const id = newId();
  const now = ctx.now();
  const name = data.name?.trim() || "Work items";
  let body = "";
  let rowCount = 0;
  let error: string | null = null;
  try {
    const items = exportRows(ctx, data.scope);
    rowCount = items.length;
    body = render(data.format, data.scope, now, items);
  } catch (err) {
    if (isTrackerError(err)) throw err;
    error = err instanceof Error ? err.message : "Export failed";
  }
  const file = error === null ? path.join(exportsDir(ctx.sqlite), exportFileName({ created_at: now, name, id }, data.format)) : null;
  if (file !== null) fs.writeFileSync(file, body, "utf8");
  try {
    return withTx(ctx, () => {
      const row = ctx.db
        .insert(export_job)
        .values({
          id,
          name,
          scope: data.scope,
          format: data.format,
          status: error === null ? "done" : "failed",
          file_path: file,
          row_count: error === null ? rowCount : null,
          error,
          created_at: now,
          created_by: ctx.actor.id,
          updated_at: now,
        })
        .returning()
        .get();
      logActivity(ctx, {
        project_id: data.scope.project_id,
        entity_type: "export",
        entity_id: id,
        verb: "created",
        new_identifier: name,
      });
      return toView(row);
    });
  } catch (err) {
    if (file !== null) fs.rmSync(file, { force: true });
    throw err;
  }
}

export function listExports(ctx: TesseraContext, input: { limit?: number } = {}): ExportJobView[] {
  const limit = input.limit ?? 100;
  return ctx.db.select().from(export_job).orderBy(desc(export_job.created_at)).limit(limit).all().map(toView);
}

export function getExport(ctx: TesseraContext, id: string): ExportJobView & { file_path: string | null } {
  const row = ctx.db.select().from(export_job).where(eq(export_job.id, id)).get();
  if (!row) throw notFound("export", id);
  return { ...toView(row), file_path: row.file_path };
}

export function deleteExport(ctx: TesseraContext, id: string): void {
  withTx(ctx, () => {
    const row = ctx.db.select().from(export_job).where(eq(export_job.id, id)).get();
    if (!row) throw notFound("export", id);
    if (row.file_path !== null) fs.rmSync(row.file_path, { force: true });
    ctx.db.delete(export_job).where(eq(export_job.id, id)).run();
    logActivity(ctx, { project_id: row.scope.project_id ?? null, entity_type: "export", entity_id: id, verb: "deleted", old_identifier: row.name });
  });
}
