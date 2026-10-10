/**
 * Two writers on one database file (docs/contracts/schema.md "Migrations and
 * database file", service-api.md "Context, errors, transactions"): two
 * openDatabase handles in this process stand in for two processes, and one
 * test spawns a real second process (tsx + tests/helpers/second-writer.ts)
 * that writes while this process holds a BEGIN IMMEDIATE transaction.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { ASSISTANT_ACTOR_ID, USER_ACTOR_ID } from "@/lib/tessera/actors";
import { latestSeq } from "@/lib/tessera/activity";
import { listChanges } from "@/lib/tessera/changes";
import { createContext, type TesseraContext } from "@/lib/tessera/core/context";
import { isTrackerError } from "@/lib/tessera/core/errors";
import { openDatabase, type DbHandles } from "@/lib/tessera/db/client";
import { REPO_ROOT } from "@/lib/tessera/db/migrate";
import { createProject, getProject, type Project } from "@/lib/tessera/projects";
import { listStates } from "@/lib/tessera/states";
import { createWorkItem, getWorkItem, listWorkItems, moveWorkItem, type WorkItem } from "@/lib/tessera/work-items";
import { withTempFileDb } from "./helpers/db";
import type { SecondWriterResult } from "./helpers/second-writer";

const execFileAsync = promisify(execFile);

/** The busy_timeout every handle gets from openDatabase (ms). */
const BUSY_TIMEOUT_MS = 5000;
/** How long the test keeps its lock after the second process signalled that it is about to write. */
const HOLD_MS = 400;
const SECOND_PROCESS_TIMEOUT_MS = 30_000;

type Writer = { handles: DbHandles; ctx: TesseraContext };

function openWriter(filePath: string, actorId: string): Writer {
  const handles = openDatabase(filePath);
  return { handles, ctx: createContext({ db: handles.db, sqlite: handles.sqlite, actorId }) };
}

/** Two handles on the same migrated temp file: `a` acts as the user, `b` as the assistant. */
async function withTwoWriters<T>(fn: (a: Writer, b: Writer, filePath: string) => T | Promise<T>): Promise<T> {
  return withTempFileDb(async (filePath) => {
    const a = openWriter(filePath, USER_ACTOR_ID);
    const b = openWriter(filePath, ASSISTANT_ACTOR_ID);
    try {
      return await fn(a, b, filePath);
    } finally {
      a.handles.sqlite.close();
      b.handles.sqlite.close();
    }
  });
}

function orderedIds(ctx: TesseraContext, projectId: string): string[] {
  return listWorkItems(ctx, { scope: { type: "project", project_id: projectId } }).items.map((item) => item.id);
}

function nextSequence(writer: Writer, projectId: string): number {
  const row = writer.handles.sqlite.prepare<[string], { next_sequence: number }>("SELECT next_sequence FROM project WHERE id = ?").get(projectId);
  return row?.next_sequence ?? -1;
}

function errorCode(fn: () => unknown): string | null {
  try {
    fn();
  } catch (err) {
    if (isTrackerError(err)) return err.code;
    throw err;
  }
  return null;
}

/** Alternates between the two writers: even indexes go to `a`, odd ones to `b`. */
function pick(a: Writer, b: Writer, index: number): Writer {
  return index % 2 === 0 ? a : b;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFile(filePath: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(filePath)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${filePath}`);
    await sleep(20);
  }
}

/** The tsx CLI from the installed package, run with this process's node so both sides share the runtime. */
function tsxCli(): string {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "node_modules", "tsx", "package.json"), "utf8")) as { bin: string | Record<string, string> };
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.tsx;
  return path.join(REPO_ROOT, "node_modules", "tsx", bin);
}

const SECOND_WRITER = path.join(REPO_ROOT, "tests", "helpers", "second-writer.ts");

function runSecondWriter(filePath: string, projectId: string, markerPath: string): Promise<SecondWriterResult> {
  return execFileAsync(process.execPath, [tsxCli(), SECOND_WRITER, filePath, projectId, markerPath], {
    cwd: REPO_ROOT,
    env: process.env,
    timeout: SECOND_PROCESS_TIMEOUT_MS,
  }).then(({ stdout }) => JSON.parse(stdout.trim()) as SecondWriterResult);
}

// ---------------------------------------------------------------------------
// Two handles in one process
// ---------------------------------------------------------------------------

describe("two handles on one database file", () => {
  it("both open with a 5 s busy_timeout in WAL mode", async () => {
    await withTwoWriters((a, b) => {
      for (const writer of [a, b]) {
        expect(writer.handles.sqlite.pragma("busy_timeout", { simple: true })).toBe(BUSY_TIMEOUT_MS);
        expect(writer.handles.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
      }
    });
  });

  it("interleaved creates never collide on sequence_id", async () => {
    await withTwoWriters((a, b) => {
      const project = createProject(a.ctx, { name: "Website", identifier: "WEB" });
      const created: WorkItem[] = [];
      for (let i = 0; i < 10; i += 1) {
        created.push(createWorkItem(pick(a, b, i).ctx, { project_id: project.id, name: `Item ${i}` }));
      }
      const sequences = created.map((item) => item.sequence_id);
      expect(new Set(sequences).size).toBe(10);
      expect([...sequences].sort((x, y) => x - y)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
      expect(created.map((item) => item.key)).toEqual(sequences.map((n) => `WEB-${n}`));
    });
  });

  it("next_sequence reads the same from both handles after interleaved creates", async () => {
    await withTwoWriters((a, b) => {
      const project = createProject(a.ctx, { name: "Website", identifier: "WEB" });
      for (let i = 0; i < 7; i += 1) createWorkItem(pick(a, b, i).ctx, { project_id: project.id, name: `Item ${i}` });
      expect(nextSequence(a, project.id)).toBe(8);
      expect(nextSequence(b, project.id)).toBe(8);
      expect(getProject(a.ctx, project.id).next_sequence).toBe(8);
      expect(getProject(b.ctx, project.id).next_sequence).toBe(8);
    });
  });

  it("each handle sees the other's committed rows", async () => {
    await withTwoWriters((a, b) => {
      const project = createProject(a.ctx, { name: "Website", identifier: "WEB" });
      const fromA = createWorkItem(a.ctx, { project_id: project.id, name: "Written by A" });
      const fromB = createWorkItem(b.ctx, { project_id: project.id, name: "Written by B" });
      expect(getWorkItem(b.ctx, fromA.id).name).toBe("Written by A");
      expect(getWorkItem(a.ctx, fromB.id).name).toBe("Written by B");
      expect(getWorkItem(a.ctx, fromB.id).created_by).toBe(ASSISTANT_ACTOR_ID);
      expect(getWorkItem(b.ctx, fromA.id).created_by).toBe(USER_ACTOR_ID);
      expect(listWorkItems(a.ctx, { scope: { type: "project", project_id: project.id } }).total).toBe(2);
      expect(listWorkItems(b.ctx, { scope: { type: "project", project_id: project.id } }).total).toBe(2);
      expect(getProject(b.ctx, "WEB").id).toBe(project.id);
    });
  });

  it("moves from both handles settle on one order that both handles read", async () => {
    await withTwoWriters((a, b) => {
      const project = createProject(a.ctx, { name: "Website", identifier: "WEB" });
      const items = Array.from({ length: 4 }, (_, i) => createWorkItem(pick(a, b, i).ctx, { project_id: project.id, name: `Item ${i + 1}` }));
      const [one, two, three, four] = items;
      expect(orderedIds(a.ctx, project.id)).toEqual([one.id, two.id, three.id, four.id]);

      moveWorkItem(b.ctx, four.id, { after_id: one.id });
      expect(orderedIds(a.ctx, project.id)).toEqual([four.id, one.id, two.id, three.id]);

      moveWorkItem(a.ctx, two.id, { before_id: three.id });
      expect(orderedIds(b.ctx, project.id)).toEqual([four.id, one.id, three.id, two.id]);
      expect(orderedIds(a.ctx, project.id)).toEqual(orderedIds(b.ctx, project.id));
    });
  });

  it("a group move from one handle is visible to the other with its activity row", async () => {
    await withTwoWriters((a, b) => {
      const project = createProject(a.ctx, { name: "Website", identifier: "WEB" });
      const started = listStates(a.ctx, project.id).find((state) => state.state_group === "started");
      if (!started) throw new Error("createProject seeds a started state");
      const item = createWorkItem(a.ctx, { project_id: project.id, name: "Moved by B" });
      const before = latestSeq(a.ctx);
      moveWorkItem(b.ctx, item.id, { group_by: "state", value: started.id });
      expect(getWorkItem(a.ctx, item.id).state_id).toBe(started.id);
      const changes = listChanges(a.ctx, before).changes;
      expect(changes.some((change) => change.entity_id === item.id && change.field === "state_id" && change.actor_id === ASSISTANT_ACTOR_ID)).toBe(true);
    });
  });

  it("alternating writes from both handles never surface BUSY", async () => {
    await withTwoWriters((a, b) => {
      const project = createProject(a.ctx, { name: "Website", identifier: "WEB" });
      const first = createWorkItem(a.ctx, { project_id: project.id, name: "Anchor" });
      const codes: (string | null)[] = [];
      for (let i = 0; i < 20; i += 1) {
        const writer = pick(a, b, i);
        codes.push(errorCode(() => createWorkItem(writer.ctx, { project_id: project.id, name: `Item ${i}` })));
        codes.push(errorCode(() => moveWorkItem(writer.ctx, first.id, { group_by: "priority", value: i % 2 === 0 ? "high" : "low" })));
      }
      expect(codes.filter((code) => code !== null)).toEqual([]);
      expect(a.handles.sqlite.inTransaction).toBe(false);
      expect(b.handles.sqlite.inTransaction).toBe(false);
      expect(listWorkItems(b.ctx, { scope: { type: "project", project_id: project.id } }).total).toBe(21);
    });
  });

  it("the activity cursor is strictly increasing across both handles in commit order", async () => {
    await withTwoWriters((a, b) => {
      const project = createProject(a.ctx, { name: "Website", identifier: "WEB" });
      const cursors: number[] = [latestSeq(b.ctx)];
      for (let i = 0; i < 8; i += 1) {
        const writer = pick(a, b, i);
        const other = pick(a, b, i + 1);
        createWorkItem(writer.ctx, { project_id: project.id, name: `Item ${i}` });
        // The other handle must already see the new rows.
        cursors.push(latestSeq(other.ctx));
      }
      for (let i = 1; i < cursors.length; i += 1) expect(cursors[i]).toBeGreaterThan(cursors[i - 1]);
      const seqs = listChanges(a.ctx, 0).changes.map((change) => change.seq);
      expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
      expect(new Set(seqs).size).toBe(seqs.length);
      expect(listChanges(b.ctx, 0).cursor).toBe(latestSeq(a.ctx));
    });
  });
});

// ---------------------------------------------------------------------------
// A real second process
// ---------------------------------------------------------------------------

describe("a second process", () => {
  it(
    "waits for this process's immediate transaction, succeeds once it is released, and keeps the cursor monotonic",
    { timeout: SECOND_PROCESS_TIMEOUT_MS + 10_000 },
    async () => {
      await withTempFileDb(async (filePath) => {
        const a = openWriter(filePath, USER_ACTOR_ID);
        try {
          const project: Project = createProject(a.ctx, { name: "Website", identifier: "WEB" });
          const seqBefore = latestSeq(a.ctx);
          const markerPath = path.join(path.dirname(filePath), "second-writer.ready");

          a.handles.sqlite.exec("BEGIN IMMEDIATE");
          const child = runSecondWriter(filePath, project.id, markerPath);
          // Mark the rejection handled so a failed spawn surfaces through `await child` below, not as an unhandled rejection.
          child.catch(() => undefined);
          let releasedAt = 0;
          const writeWhileHoldingTheLock = async (): Promise<WorkItem> => {
            try {
              await waitForFile(markerPath, SECOND_PROCESS_TIMEOUT_MS);
              // The other process is about to write; keep the lock a little longer so it really has to wait.
              await sleep(HOLD_MS);
              // A write inside the held transaction joins it (withTx sees inTransaction) and commits with it.
              const item = createWorkItem(a.ctx, { project_id: project.id, name: "Written while holding the lock" });
              expect(a.handles.sqlite.inTransaction).toBe(true);
              return item;
            } finally {
              a.handles.sqlite.exec("COMMIT");
              releasedAt = Date.now();
            }
          };
          const held = await writeWhileHoldingTheLock();
          const result = await child;

          // It started before the lock was released and finished only after.
          expect(result.started_at).toBeLessThan(releasedAt);
          expect(result.done_at).toBeGreaterThanOrEqual(releasedAt);
          expect(result.done_at - result.started_at).toBeGreaterThanOrEqual(HOLD_MS - 50);
          expect(result.pid).not.toBe(process.pid);

          // Sequence numbers: ours was allocated first (inside the held transaction), theirs next.
          expect(held.sequence_id).toBe(1);
          expect(result.sequence_id).toBe(2);
          expect(result.key).toBe("WEB-2");
          expect(getWorkItem(a.ctx, result.id).name).toBe("Written by the second process");
          expect(getProject(a.ctx, project.id).next_sequence).toBe(3);

          // The cursor moved past our write, then past theirs, and keeps growing afterwards.
          const heldSeq = listChanges(a.ctx, seqBefore).changes.find((change) => change.entity_id === held.id && change.verb === "created")?.seq;
          expect(heldSeq).toBeDefined();
          expect(result.seq).toBeGreaterThan(heldSeq ?? Number.MAX_SAFE_INTEGER);
          expect(latestSeq(a.ctx)).toBe(result.seq);
          const after = createWorkItem(a.ctx, { project_id: project.id, name: "Written after the second process" });
          expect(after.sequence_id).toBe(3);
          expect(latestSeq(a.ctx)).toBeGreaterThan(result.seq);

          const changes = listChanges(a.ctx, seqBefore).changes;
          const seqs = changes.map((change) => change.seq);
          expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
          expect(new Set(seqs).size).toBe(seqs.length);
          expect(changes.some((change) => change.entity_id === result.id && change.verb === "created")).toBe(true);
          expect(a.handles.sqlite.inTransaction).toBe(false);
        } finally {
          a.handles.sqlite.close();
        }
      });
    },
  );
});
