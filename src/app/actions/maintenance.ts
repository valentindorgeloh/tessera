"use server";

import { toolAction } from "./_run";

export const listBackupsAction = toolAction("list_backups");
export const createBackupAction = toolAction("create_backup");
export const runMaintenanceAction = toolAction("run_maintenance");
export const getUndoableAssistantBatchAction = toolAction("get_undoable_assistant_batch");
export const undoLastAssistantBatchAction = toolAction("undo_last_assistant_batch");
