/**
 * Daily maintenance (decisions 120 and 122): optional auto backup, retention
 * purge, backup rotation. Runs under the `maintenance` lease.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { TesseraContext } from "../core/context";
import { validateInput } from "../core/errors";
import { backupDatabase, listBackups, rotateBackups, type BackupFile } from "../db/backups";
import { resolveDbPath, MEMORY_DB } from "../db/client";
import { automation_lease } from "../db/schema";
import { eq } from "drizzle-orm";
import { acquireLease, LEASE_TTL_MS, releaseLease } from "../automations/lease";
import { getWorkspaceSettings } from "../workspace/settings";
import { applyRetention, emptyRetention, planRetention, type RetentionCounts } from "./retention";

const DAY_MS = 24 * 60 * 60 * 1000;

export type MaintenanceSummary = {
  ran_at: string;
  dry_run: boolean;
  lease_held: boolean;
  auto_backup: boolean;
  backup_due: boolean;
  backup_path: string | null;
  pruned: string[];
  retention: RetentionCounts;
};

export const RunMaintenanceInput = z
  .object({
    now: z.string().datetime().optional().describe("Clock for due checks and retention cutoffs. Defaults to ctx.now()."),
    dry_run: z.boolean().optional().describe("When true, report without writing files or deleting rows."),
  })
  .strict();

export type RunMaintenanceInputType = z.input<typeof RunMaintenanceInput>;

function dbFilePath(): string | null {
  const path = resolveDbPath();
  return path === MEMORY_DB ? null : path;
}

function lastAutoBackup(filePath: string): BackupFile | null {
  return listBackups(filePath).find((file) => file.kind === "auto") ?? null;
}

function backupIsDue(filePath: string, now: string): boolean {
  const last = lastAutoBackup(filePath);
  if (!last) return true;
  return Date.parse(now) - Date.parse(last.created_at) >= DAY_MS;
}

/**
 * Takes the maintenance lease, optionally writes an auto backup, purges
 * retention and rotates backups. A held lease returns without writing.
 */
export function runMaintenance(ctx: TesseraContext, input: RunMaintenanceInputType = {}): MaintenanceSummary {
  const data = validateInput(RunMaintenanceInput, input);
  const now = data.now ?? ctx.now();
  const dryRun = data.dry_run === true;
  const settings = getWorkspaceSettings(ctx);
  const filePath = dbFilePath();
  const autoOn = settings.auto_backup;
  const due = filePath !== null && autoOn && backupIsDue(filePath, now);

  if (dryRun) {
    const retention = filePath ? planRetention(ctx, now) : emptyRetention();
    return {
      ran_at: now,
      dry_run: true,
      lease_held: false,
      auto_backup: autoOn,
      backup_due: due,
      backup_path: null,
      pruned: [],
      retention: {
        proposals: retention.proposals,
        notifications: retention.notifications,
        webhook_deliveries: retention.webhook_deliveries,
        export_jobs: retention.export_jobs,
      },
    };
  }

  if (ctx.sqlite.inTransaction) {
    throw new Error("runMaintenance commits on its own, so it cannot run inside a transaction");
  }

  const holder = `${process.pid}:${randomUUID()}`;
  if (!acquireLease(ctx.sqlite, "maintenance", holder, now, LEASE_TTL_MS)) {
    return {
      ran_at: now,
      dry_run: false,
      lease_held: true,
      auto_backup: autoOn,
      backup_due: due,
      backup_path: null,
      pruned: [],
      retention: emptyRetention(),
    };
  }

  try {
    let backupPath: string | null = null;
    let pruned: string[] = [];
    if (filePath !== null && autoOn && backupIsDue(filePath, now)) {
      backupPath = backupDatabase(filePath, "auto", new Date(now)).path;
    }
    const plan = planRetention(ctx, now);
    const retention = applyRetention(ctx, plan);
    if (filePath !== null) pruned = rotateBackups(filePath, new Date(now));
    const summary: MaintenanceSummary = {
      ran_at: now,
      dry_run: false,
      lease_held: false,
      auto_backup: autoOn,
      backup_due: due,
      backup_path: backupPath,
      pruned,
      retention,
    };
    ctx.db.update(automation_lease).set({ last_run_at: now, last_summary: summary }).where(eq(automation_lease.id, "maintenance")).run();
    return summary;
  } finally {
    releaseLease(ctx.sqlite, "maintenance", holder);
  }
}

export { planRetention, applyRetention, type RetentionCounts, type RetentionPlan } from "./retention";
