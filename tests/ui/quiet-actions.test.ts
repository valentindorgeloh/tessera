// @vitest-environment node
/**
 * Quiet Server Actions: `quietToolAction` runs the tool without `refresh()`,
 * `toolAction` still refreshes after a mutating tool, and the wrappers for
 * autosaves and view-settings saves are the quiet kind (reset stays loud).
 * The engine and the database are mocked: only the wiring is under test.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  mutates: true,
  run: vi.fn(async () => ({ data: { ok: 1 }, cursor: 7 })),
}));

vi.mock("next/cache", () => ({ refresh: mocks.refresh }));
vi.mock("@/lib/tessera/db/client", () => ({ getDb: () => ({ db: {}, sqlite: {} }) }));
vi.mock("@/lib/tessera/core/context", () => ({ createContext: () => ({}) }));
vi.mock("@/lib/tessera/tools/registry", () => ({
  getTool: () => ({ mutates: mocks.mutates, input: z.object({}).passthrough() }),
  runToolWithContext: mocks.run,
}));

const { quietToolAction, runTool, toolAction } = await import("@/app/actions/_run");
const views = await import("@/app/actions/views");
const workItems = await import("@/app/actions/work-items");
const pages = await import("@/app/actions/pages");
const stickies = await import("@/app/actions/stickies");

beforeEach(() => {
  mocks.refresh.mockClear();
  mocks.run.mockClear();
  mocks.mutates = true;
});

describe("quietToolAction", () => {
  it("runs the tool and returns its result without refreshing", async () => {
    const result = await quietToolAction("save_view_settings")({} as never);
    expect(result).toEqual({ ok: true, data: { ok: 1 }, cursor: 7 });
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("toolAction still refreshes after a mutating tool, and runTool skips it for a read tool", async () => {
    await toolAction("save_view_settings")({} as never);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    mocks.refresh.mockClear();
    mocks.mutates = false;
    await toolAction("list_work_items")({} as never);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("runTool refreshes unless refreshAfter is false", async () => {
    await runTool("save_view_settings", {});
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    await runTool("save_view_settings", {}, undefined, false);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});

describe("action wrappers", () => {
  it("autosaves and the view-settings save do not refresh", async () => {
    await views.saveViewSettingsAction({} as never);
    await workItems.updateWorkItemDescriptionAction({} as never);
    await pages.updatePageBodyAction({} as never);
    await stickies.updateStickyBodyAction({} as never);
    expect(mocks.run).toHaveBeenCalledTimes(4);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("reset view settings and sticky name or colour edits still refresh", async () => {
    await views.resetViewSettingsAction({} as never);
    await stickies.updateStickyAction({} as never);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });
});
