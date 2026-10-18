import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { USER_ACTOR_ID } from "@/lib/tessera/actors";
import { createContext } from "@/lib/tessera/core/context";
import { openDatabase } from "@/lib/tessera/db/client";
import { createExport, deleteExport } from "@/lib/tessera/exports";
import { createProject } from "@/lib/tessera/projects";
import { createWorkItem } from "@/lib/tessera/work-items";
import { withTempFileDb } from "./helpers/db";

describe("exports", () => {
  it("writes a spreadsheet CSV next to the database and delete removes it", async () => {
    await withTempFileDb(async (filePath) => {
      const handles = openDatabase(filePath);
      const ctx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: USER_ACTOR_ID, now: () => "2026-10-18T14:31:00.000Z", today: () => "2026-10-18" });
      const project = createProject(ctx, { name: "Web", identifier: "WEB" });
      createWorkItem(ctx, { project_id: project.id, name: "=SUM(1,2)", description_md: "A line\nwith, comma" });
      const job = createExport(ctx, {
        format: "csv",
        name: "WEB sprint",
        scope: { project_id: project.id },
      });
      expect(job.status).toBe("done");
      expect(job.row_count).toBe(1);
      expect(job.file_name).toMatch(/\.csv$/);
      const file = handles.sqlite.prepare("select file_path from export_job where id = ?").get(job.id) as { file_path: string };
      const text = fs.readFileSync(file.file_path, "utf8");
      expect(text.startsWith("\uFEFF")).toBe(true);
      expect(text).toContain("Key,Project,Name");
      expect(text).toContain("'=SUM(1,2)");
      expect(text).toContain("\r\n");
      deleteExport(ctx, job.id);
      expect(fs.existsSync(file.file_path)).toBe(false);
      handles.sqlite.close();
    });
  });
});
