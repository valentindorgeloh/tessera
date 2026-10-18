/**
 * Backup and maintenance tools (P11 decisions 120–121). Backups write files
 * only; undo reverses the latest assistant Apply batch.
 */
import { z } from "zod";
import { findLatestUndoableBatch, undoLastAssistantBatch } from "../../ai/undo";
import { rule } from "../../core/errors";
import { backupDatabase, listBackups, type BackupFile } from "../../db/backups";
import { MEMORY_DB } from "../../db/client";
import { runMaintenance, RunMaintenanceInput } from "../../maintenance";
import { defineTool } from "../define";

function dbFilePath(sqlite: { name: string }): string {
  if (!sqlite.name || sqlite.name === MEMORY_DB) {
    throw rule("no_database_file", "This database is in memory; there is no file to back up");
  }
  return sqlite.name;
}

function withCheck(file: BackupFile): BackupFile & { check: "ok" | string | null } {
  return file;
}

export const maintenanceTools = [
  defineTool({
    name: "list_backups",
    title: "List backups",
    description: "Lists database backups next to the live file, newest first, with kind, size and creation time.",
    input: z.object({}).strict(),
    mutates: false,
    phase: "P11",
    run: (ctx) => listBackups(dbFilePath(ctx.sqlite)).map(withCheck),
  }),
  defineTool({
    name: "create_backup",
    title: "Create backup",
    description: "Writes a manual VACUUM INTO copy, checks it with quick_check, and rotates old backups. User only. Requires confirm: true.",
    input: z.object({ confirm: z.literal(true).describe("Must be true to create a backup.") }).strict(),
    mutates: true,
    userOnly: true,
    phase: "P11",
    run: (ctx) => {
      const path = dbFilePath(ctx.sqlite);
      const result = backupDatabase(path, "manual");
      return { path: result.path, check: result.check, kind: "manual" as const };
    },
  }),
  defineTool({
    name: "run_maintenance",
    title: "Run maintenance",
    description: "Runs the daily maintenance job: optional auto backup, retention purge and backup rotation. A dry_run reports without writing.",
    input: RunMaintenanceInput,
    mutates: true,
    userOnly: true,
    phase: "P11",
    run: (ctx, input) => runMaintenance(ctx, input),
  }),
  defineTool({
    name: "get_undoable_assistant_batch",
    title: "Get undoable assistant batch",
    description: "Returns the latest applied assistant batch that can still be undone, or null.",
    input: z.object({}).strict(),
    mutates: false,
    phase: "P11",
    run: (ctx) => findLatestUndoableBatch(ctx),
  }),
  defineTool({
    name: "undo_last_assistant_batch",
    title: "Undo last assistant batch",
    description:
      "Reverses the latest applied assistant batch (work-item field updates and archives) when nothing later touched the same fields. User only. Destructive: requires confirm: true.",
    input: z.object({ confirm: z.literal(true).describe("Must be true to undo.") }).strict(),
    mutates: true,
    destructive: true,
    userOnly: true,
    phase: "P11",
    run: (ctx) => undoLastAssistantBatch(ctx),
  }),
];
