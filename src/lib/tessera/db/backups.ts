/**
 * Database backups (P11 decisions 119–121): VACUUM INTO copies next to the
 * live file, named by kind, integrity-checked, then rotated per kind.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

import type { BackupFile, BackupKind } from "../types";

export const BACKUP_KEEP = 10;

export type { BackupFile, BackupKind };

const KIND_KEEP: Record<BackupKind, number> = {
  manual: 20,
  migration: 10,
  "pre-restore": 5,
  auto: 0, // decided by planRotation's day/week/month rules
};

const BACKUP_NAME =
  /^tessera-(?:(auto|manual|migration|pre-restore)-)?(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:\.\d+)?Z)\.db$/;

/** `data/backups` next to the database file. */
export function backupDir(filePath: string): string {
  return path.join(path.dirname(filePath), "backups");
}

function backupStamp(now = new Date()): string {
  return now.toISOString().replace(/:/g, "-");
}

/** Parses a backup file name. Legacy `tessera-<stamp>.db` counts as migration. */
export function parseBackupName(name: string): { kind: BackupKind; created_at: string } | null {
  const match = BACKUP_NAME.exec(name);
  if (!match) return null;
  const kind = (match[1] as BackupKind | undefined) ?? "migration";
  const stamp = match[2].replace(/T(\d{2})-(\d{2})-(\d{2})/, "T$1:$2:$3");
  const created = new Date(stamp);
  if (Number.isNaN(created.getTime())) return null;
  return { kind, created_at: created.toISOString() };
}

function isoDay(iso: string): string {
  return iso.slice(0, 10);
}

function isoWeek(iso: string): string {
  const date = new Date(iso);
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function isoMonth(iso: string): string {
  return iso.slice(0, 7);
}

function daysBetween(a: string, b: string): number {
  return Math.floor((Date.parse(a) - Date.parse(b)) / 86_400_000);
}

function weeksBetween(a: string, b: string): number {
  return Math.floor(daysBetween(a, b) / 7);
}

function monthsBetween(a: string, b: string): number {
  const A = new Date(a);
  const B = new Date(b);
  return (A.getUTCFullYear() - B.getUTCFullYear()) * 12 + (A.getUTCMonth() - B.getUTCMonth());
}

/**
 * Pure rotation plan (decision 119). `auto` keeps the newest file per day for
 * 7 days, per ISO week for 4 weeks and per month for 12 months; other kinds
 * keep a fixed newest count.
 */
export function planRotation(files: BackupFile[], now: Date = new Date()): { keep: BackupFile[]; remove: BackupFile[] } {
  const nowIso = now.toISOString();
  const keep = new Set<string>();
  const byKind = new Map<BackupKind, BackupFile[]>();
  for (const file of files) {
    const list = byKind.get(file.kind) ?? [];
    list.push(file);
    byKind.set(file.kind, list);
  }
  for (const [kind, list] of byKind) {
    const sorted = [...list].sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (kind !== "auto") {
      for (const file of sorted.slice(0, KIND_KEEP[kind])) keep.add(file.path);
      continue;
    }
    const day = new Map<string, BackupFile>();
    const week = new Map<string, BackupFile>();
    const month = new Map<string, BackupFile>();
    for (const file of sorted) {
      if (daysBetween(nowIso, file.created_at) < 7) {
        const key = isoDay(file.created_at);
        if (!day.has(key)) day.set(key, file);
      }
      if (weeksBetween(nowIso, file.created_at) < 4) {
        const key = isoWeek(file.created_at);
        if (!week.has(key)) week.set(key, file);
      }
      if (monthsBetween(nowIso, file.created_at) < 12) {
        const key = isoMonth(file.created_at);
        if (!month.has(key)) month.set(key, file);
      }
    }
    for (const file of [...day.values(), ...week.values(), ...month.values()]) keep.add(file.path);
  }
  const keepList: BackupFile[] = [];
  const remove: BackupFile[] = [];
  for (const file of files) {
    if (keep.has(file.path)) keepList.push(file);
    else remove.push(file);
  }
  return { keep: keepList, remove };
}

function quickCheck(copyPath: string): "ok" | string {
  const copy = new Database(copyPath, { readonly: true });
  try {
    const result = copy.pragma("quick_check", { simple: true });
    return result === "ok" ? "ok" : String(result);
  } finally {
    copy.close();
  }
}

/** Lists backup files next to `filePath`, newest first. */
export function listBackups(filePath: string): BackupFile[] {
  const dir = backupDir(filePath);
  if (!fs.existsSync(dir)) return [];
  const out: BackupFile[] = [];
  for (const name of fs.readdirSync(dir)) {
    const parsed = parseBackupName(name);
    if (!parsed) continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (!stat.isFile()) continue;
    out.push({
      path: full,
      name,
      kind: parsed.kind,
      created_at: parsed.created_at,
      size: stat.size,
      check: null,
    });
  }
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/**
 * Copies the live database with VACUUM INTO, runs quick_check on the copy,
 * and deletes the copy when the check fails.
 */
export function backupDatabase(
  filePath: string,
  kind: BackupKind = "manual",
  now = new Date(),
): { path: string; check: "ok" } {
  if (filePath === ":memory:") throw new Error("Cannot back up an in-memory database");
  const dir = backupDir(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `tessera-${kind}-${backupStamp(now)}.db`);
  const sqlite = new Database(filePath);
  try {
    // Bound parameter, not string interpolation: the path may hold quotes, spaces or non-ASCII.
    sqlite.prepare("VACUUM INTO ?").run(target);
  } finally {
    sqlite.close();
  }
  const check = quickCheck(target);
  if (check !== "ok") {
    fs.rmSync(target, { force: true });
    throw new Error(`Backup integrity check failed: ${check}`);
  }
  return { path: target, check: "ok" };
}

/** Applies planRotation and deletes the remove set; returns removed paths. */
export function rotateBackups(filePath: string, now = new Date()): string[] {
  const dir = backupDir(filePath);
  const plan = planRotation(listBackups(filePath), now);
  const removed: string[] = [];
  for (const file of plan.remove) {
    fs.rmSync(file.path, { force: true });
    removed.push(file.path);
  }
  if (removed.length === 0 && !fs.existsSync(dir)) return removed;
  return removed;
}

/**
 * Legacy prune: keeps the newest `keep` tessera-*.db files. Prefer
 * rotateBackups for kind-aware rotation.
 */
export function pruneBackups(dir: string, keep = BACKUP_KEEP): string[] {
  if (!fs.existsSync(dir)) return [];
  const backups = fs
    .readdirSync(dir)
    .filter((name) => /^tessera-.*\.db$/.test(name))
    .sort()
    .reverse();
  const removed: string[] = [];
  for (const name of backups.slice(keep)) {
    const full = path.join(dir, name);
    fs.rmSync(full, { force: true });
    removed.push(full);
  }
  return removed;
}
