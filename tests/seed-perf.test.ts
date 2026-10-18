/** seedPerf (decision 115): shape, determinism and idempotency on a tiny fixture. */
import { describe, expect, it } from "vitest";
import { seedPerf } from "@/lib/tessera/seed-perf";
import { createTestContext, createTestDb } from "./helpers/db";

function seeded(items: number, seed?: number) {
  const handles = createTestDb();
  const ctx = createTestContext(handles);
  const result = seedPerf(ctx, { items, other_items: Math.round(items / 5), ...(seed !== undefined ? { seed } : {}) });
  return { handles, ctx, result };
}

function names(sqlite: ReturnType<typeof createTestDb>["sqlite"]): string[] {
  return (sqlite.prepare("SELECT name FROM work_item ORDER BY project_id, sequence_id").all() as { name: string }[]).map((row) => row.name);
}

describe("seedPerf", () => {
  it("builds the decision 115 shape at a small scale", () => {
    const { result } = seeded(100);
    expect(result.created).toBe(true);
    expect(result.counts).toMatchObject({ projects: 5, work_items: 120, labels: 40, actors: 8, cycles: 12, modules: 20, relations: expect.any(Number), comments: 50 });
    expect(result.counts.relations).toBeGreaterThan(0);
    expect(result.counts.relations).toBeLessThanOrEqual(30);
    expect(result.counts.activity).toBeGreaterThanOrEqual(300);
  });

  it("is deterministic for one seed and differs for another", () => {
    const a = seeded(60, 5);
    const b = seeded(60, 5);
    const c = seeded(60, 6);
    expect(names(a.handles.sqlite)).toEqual(names(b.handles.sqlite));
    expect(names(a.handles.sqlite)).not.toEqual(names(c.handles.sqlite));
  });

  it("writes nothing when the project already exists", () => {
    const { ctx, result } = seeded(40);
    const again = seedPerf(ctx, { items: 40 });
    expect(again.created).toBe(false);
    expect(again.project_id).toBe(result.project_id);
    expect(again.counts).toEqual(result.counts);
  });
});
