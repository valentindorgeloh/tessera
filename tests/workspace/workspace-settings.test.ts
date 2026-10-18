import { describe, expect, it } from "vitest";
import { USER_ACTOR_ID } from "@/lib/tessera/actors";
import { createContext } from "@/lib/tessera/core/context";
import { getWorkspaceSettings, normalizeHomeWidgets, updateWorkspaceSettings } from "@/lib/tessera/workspace";
import { createTestDb } from "../helpers/db";

describe("workspace settings", () => {
  it("normalizes widgets and merges AI overrides without filling omitted keys", () => {
    expect(normalizeHomeWidgets([{ widget: "stickies", enabled: false }, { widget: "nope", enabled: true }, { widget: "stickies", enabled: true }]).map((row) => row.widget)).toEqual([
      "stickies",
      "since_last_visit",
      "quick_links",
      "recents",
      "your_work",
    ]);
    expect(normalizeHomeWidgets([{ widget: "stickies", enabled: false }])[0]?.enabled).toBe(false);
    const handles = createTestDb();
    const ctx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: USER_ACTOR_ID });
    expect(getWorkspaceSettings(ctx).name).toBe("Tessera");
    expect(getWorkspaceSettings(ctx).ai.digest_enabled).toBe(true);
    const updated = updateWorkspaceSettings(ctx, { name: "Studio", ai: { model: "claude" } });
    expect(updated.name).toBe("Studio");
    expect(updated.ai).toEqual({ model: "claude", effort: null, digest_enabled: true });
  });
});
