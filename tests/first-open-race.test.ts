/**
 * First-open race (docs/improvements.md): several processes open one fresh
 * database file at the same moment. Each child runs tests/helpers/first-open.ts
 * through tsx; none may crash, and the seeds must end up as one row each.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "@/lib/tessera/db/migrate";

const execFileAsync = promisify(execFile);
const CHILDREN = 6;
const ROUNDS = 3;
const TSX = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");
const CHILD = path.join(REPO_ROOT, "tests", "helpers", "first-open.ts");

type ChildResult = { ok: boolean; settings?: number; actors?: number; error?: string };

async function runChild(dbPath: string, startAt: number): Promise<ChildResult> {
  try {
    const { stdout } = await execFileAsync(TSX, [CHILD, dbPath, String(startAt)], { cwd: REPO_ROOT, timeout: 60_000 });
    return JSON.parse(stdout.trim().split("\n").pop() ?? "{}") as ChildResult;
  } catch (err) {
    const stdout = (err as { stdout?: string }).stdout ?? "";
    const line = stdout.trim().split("\n").pop();
    if (line) return JSON.parse(line) as ChildResult;
    return { ok: false, error: String(err) };
  }
}

describe("first open of a fresh database file", () => {
  it("survives several processes opening it at once", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "tessera-first-open-"));
      try {
        const dbPath = path.join(dir, "tessera.db");
        // Children need ~1.5 s to boot tsx; the shared start time lines up their openDatabase calls.
        const startAt = Date.now() + 4000;
        const results = await Promise.all(Array.from({ length: CHILDREN }, () => runChild(dbPath, startAt)));
        expect(results.filter((r) => !r.ok)).toEqual([]);
        for (const result of results) {
          expect(result.settings).toBe(1);
          expect(result.actors).toBe(3);
        }
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  }, 120_000);
});
