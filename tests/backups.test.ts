/**
 * Backup naming, kind-aware rotation and VACUUM INTO on a temporary file
 * database. Never opens data/tessera.db.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BACKUP_KEEP,
  backupDatabase,
  backupDir,
  listBackups,
  parseBackupName,
  planRotation,
  pruneBackups,
  rotateBackups,
  type BackupFile,
} from "@/lib/tessera/db/backups";
import { REPO_ROOT } from "@/lib/tessera/db/migrate";
import { createProject } from "@/lib/tessera/projects";
import { openDatabase } from "@/lib/tessera/db/client";
import { createTestContext, withTempFileDb } from "./helpers/db";

function fake(kind: BackupFile["kind"], created_at: string, name?: string): BackupFile {
  const stamp = created_at.replace(/:/g, "-");
  const fileName = name ?? `tessera-${kind}-${stamp}.db`;
  return { path: `/tmp/${fileName}`, name: fileName, kind, created_at, size: 1, check: null };
}

describe("parseBackupName", () => {
  it("reads kinded names and treats legacy names as migration", () => {
    expect(parseBackupName("tessera-manual-2026-01-02T03-04-05.000Z.db")).toEqual({
      kind: "manual",
      created_at: "2026-01-02T03:04:05.000Z",
    });
    expect(parseBackupName("tessera-2026-01-02T03-04-05.000Z.db")).toEqual({
      kind: "migration",
      created_at: "2026-01-02T03:04:05.000Z",
    });
    expect(parseBackupName("other.db")).toBeNull();
  });
});

describe("planRotation", () => {
  it("keeps a bounded number of manual backups and day/week/month autos", () => {
    const now = new Date("2026-06-15T12:00:00.000Z");
    const manuals = Array.from({ length: 25 }, (_, i) =>
      fake("manual", new Date(Date.UTC(2026, 5, 15 - i, 12)).toISOString()),
    );
    const autos = [
      fake("auto", "2026-06-15T10:00:00.000Z"),
      fake("auto", "2026-06-14T10:00:00.000Z"),
      fake("auto", "2026-06-01T10:00:00.000Z"),
      fake("auto", "2026-05-01T10:00:00.000Z"),
      fake("auto", "2025-01-01T10:00:00.000Z"),
    ];
    const plan = planRotation([...manuals, ...autos], now);
    expect(plan.keep.filter((f) => f.kind === "manual")).toHaveLength(20);
    expect(plan.remove.filter((f) => f.kind === "manual")).toHaveLength(5);
    expect(plan.keep.some((f) => f.created_at.startsWith("2026-06-15"))).toBe(true);
    expect(plan.keep.some((f) => f.created_at.startsWith("2025-01-01"))).toBe(false);
  });
});

describe("backup rotation", () => {
  it("backs up a database whose folder name holds a quote, spaces and non-ASCII", async () => {
    await withTempFileDb(async (filePath) => {
      const dir = path.join(path.dirname(filePath), "it's a dir ü");
      fs.mkdirSync(dir);
      const odd = path.join(dir, "tessera.db");
      fs.copyFileSync(filePath, odd);
      const copy = backupDatabase(odd, "manual", new Date("2026-01-04T00:00:00.000Z"));
      expect(copy.check).toBe("ok");
      expect(path.dirname(copy.path)).toBe(backupDir(odd));
    });
  });

  it("writes a kinded VACUUM INTO copy and rotates on a temp database", async () => {
    await withTempFileDb(async (filePath) => {
      const userDb = path.join(REPO_ROOT, "data", "tessera.db");
      expect(path.resolve(filePath)).not.toBe(path.resolve(userDb));

      const handles = openDatabase(filePath);
      const ctx = createTestContext(handles);
      createProject(ctx, { name: "Backup", identifier: "BAK" });
      handles.sqlite.close();

      const first = backupDatabase(filePath, "manual", new Date("2026-01-01T00:00:00.000Z"));
      const second = backupDatabase(filePath, "migration", new Date("2026-01-02T00:00:00.000Z"));
      expect(first.check).toBe("ok");
      expect(path.basename(first.path)).toContain("manual");
      expect(listBackups(filePath)).toHaveLength(2);

      const removed = pruneBackups(backupDir(filePath), 1);
      expect(removed).toHaveLength(1);
      expect(BACKUP_KEEP).toBe(10);

      const newest = new Database(second.path, { readonly: true });
      try {
        const row = newest.prepare("SELECT identifier FROM project WHERE identifier = ?").get("BAK") as {
          identifier: string;
        };
        expect(row.identifier).toBe("BAK");
        expect(newest.pragma("quick_check", { simple: true })).toBe("ok");
      } finally {
        newest.close();
      }

      backupDatabase(filePath, "auto", new Date("2026-01-03T00:00:00.000Z"));
      rotateBackups(filePath, new Date("2026-01-03T00:00:00.000Z"));
      expect(fs.existsSync(backupDir(filePath))).toBe(true);
    });
  });
});
