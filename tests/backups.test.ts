/**
 * Backup rotation on a temporary file database. Never opens data/tessera.db.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createProject } from "@/lib/tessera/projects";
import { openDatabase } from "@/lib/tessera/db/client";
import { BACKUP_KEEP, REPO_ROOT, backupDatabase, backupDir, pruneBackups } from "@/lib/tessera/db/migrate";
import { createTestContext, withTempFileDb } from "./helpers/db";

describe("backup rotation", () => {
  it("keeps a bounded number of VACUUM INTO copies of a temp database", async () => {
    await withTempFileDb(async (filePath) => {
      const userDb = path.join(REPO_ROOT, "data", "tessera.db");
      expect(path.resolve(filePath)).not.toBe(path.resolve(userDb));
      expect(filePath.includes(`${path.sep}data${path.sep}tessera.db`)).toBe(false);

      const handles = openDatabase(filePath);
      const ctx = createTestContext(handles);
      createProject(ctx, { name: "Backup", identifier: "BAK" });
      handles.sqlite.close();

      const stamps = [
        new Date("2026-01-01T00:00:00.000Z"),
        new Date("2026-01-02T00:00:00.000Z"),
        new Date("2026-01-03T00:00:00.000Z"),
        new Date("2026-01-04T00:00:00.000Z"),
      ];
      const copies = stamps.map((now) => backupDatabase(filePath, now));
      expect(backupDir(filePath)).toBe(path.join(path.dirname(filePath), "backups"));
      expect(copies.every((copy) => copy.startsWith(backupDir(filePath)))).toBe(true);

      const removed = pruneBackups(backupDir(filePath), 2);
      expect(removed.map((file) => path.basename(file)).sort()).toEqual([
        "tessera-2026-01-01T00-00-00.000Z.db",
        "tessera-2026-01-02T00-00-00.000Z.db",
      ]);
      const left = fs.readdirSync(backupDir(filePath)).filter((name) => name.endsWith(".db")).sort();
      expect(left).toEqual(["tessera-2026-01-03T00-00-00.000Z.db", "tessera-2026-01-04T00-00-00.000Z.db"]);
      expect(left.length).toBeLessThanOrEqual(BACKUP_KEEP);

      const newest = new Database(copies[3], { readonly: true });
      try {
        const row = newest.prepare("SELECT identifier FROM project WHERE identifier = ?").get("BAK") as { identifier: string };
        expect(row.identifier).toBe("BAK");
        const check = newest.pragma("quick_check", { simple: true });
        expect(check).toBe("ok");
      } finally {
        newest.close();
      }

      const live = new Database(filePath, { readonly: true });
      try {
        const row = live.prepare("SELECT identifier FROM project WHERE identifier = ?").get("BAK") as { identifier: string };
        expect(row.identifier).toBe("BAK");
      } finally {
        live.close();
      }
    });
  });
});
