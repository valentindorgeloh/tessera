import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { USER_ACTOR_ID } from "@/lib/tessera/actors";
import { createContext } from "@/lib/tessera/core/context";
import { activity } from "@/lib/tessera/db/schema";
import { createSticky, deleteSticky, listStickies, updateSticky } from "@/lib/tessera/workspace";
import { createTestDb } from "../helpers/db";

describe("stickies", () => {
  it("puts new stickies first, searches the body, and logs a description edit without values", () => {
    const handles = createTestDb();
    const ctx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: USER_ACTOR_ID });
    const first = createSticky(ctx, { name: "Older", description_md: "alpha" });
    const second = createSticky(ctx, { name: "Newer", description_md: "beta word" });
    expect(listStickies(ctx).map((row) => row.id)).toEqual([second.id, first.id]);
    expect(listStickies(ctx, { q: "word" }).map((row) => row.id)).toEqual([second.id]);
    updateSticky(ctx, second.id, { description_md: "beta word edited", color: "blue" });
    const edit = handles.db
      .select()
      .from(activity)
      .where(eq(activity.entity_id, second.id))
      .all()
      .find((row) => row.field === "description_md");
    expect(edit?.verb).toBe("updated");
    expect(edit?.old_value).toBeNull();
    expect(edit?.new_value).toBeNull();
    expect(listStickies(ctx)[0]?.color).toBe("blue");
    deleteSticky(ctx, second.id);
    expect(listStickies(ctx).map((row) => row.id)).toEqual([first.id]);
  });
});
