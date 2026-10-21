/**
 * Placement semantics behind the stickies and quick-link reorder (decision 105):
 * `before_id` names the row that ends up directly before the moved one,
 * `after_id` the row that ends up directly after it. A drop passes one
 * neighbour, so a search-filtered stickies grid (whose neighbours are not
 * adjacent in the full list) still reorders.
 */
import { describe, expect, it } from "vitest";
import { USER_ACTOR_ID } from "@/lib/tessera/actors";
import { createContext } from "@/lib/tessera/core/context";
import { addQuickLink, createSticky, listQuickLinks, listStickies, moveQuickLink, moveSticky } from "@/lib/tessera/workspace";
import { createTestDb } from "../helpers/db";

function setup() {
  const handles = createTestDb();
  return createContext({ db: handles.db, sqlite: handles.sqlite, actorId: USER_ACTOR_ID });
}

describe("move_sticky placement", () => {
  it("before_id puts the sticky directly after that row, after_id directly before it", () => {
    const ctx = setup();
    const c = createSticky(ctx, { name: "c" });
    const b = createSticky(ctx, { name: "b" });
    const a = createSticky(ctx, { name: "a" });
    const order = () => listStickies(ctx).map((row) => row.name);
    expect(order()).toEqual(["a", "b", "c"]);
    moveSticky(ctx, { sticky_id: a.id, before_id: b.id });
    expect(order()).toEqual(["b", "a", "c"]);
    moveSticky(ctx, { sticky_id: c.id, after_id: b.id });
    expect(order()).toEqual(["c", "b", "a"]);
  });

  it("takes a single neighbour that is not adjacent to the slot's other side", () => {
    const ctx = setup();
    const d = createSticky(ctx, { name: "d" });
    createSticky(ctx, { name: "c" });
    const b = createSticky(ctx, { name: "b" });
    createSticky(ctx, { name: "a" });
    // The grid filtered to a, b, d: dropping d after b names only b.
    moveSticky(ctx, { sticky_id: d.id, before_id: b.id });
    expect(listStickies(ctx).map((row) => row.name)).toEqual(["a", "b", "d", "c"]);
  });
});

describe("move_quick_link placement", () => {
  it("before_id puts the link directly after that row, after_id directly before it", () => {
    const ctx = setup();
    const a = addQuickLink(ctx, { url: "/a" });
    const b = addQuickLink(ctx, { url: "/b" });
    const c = addQuickLink(ctx, { url: "/c" });
    const order = () => listQuickLinks(ctx).map((row) => row.url);
    expect(order()).toEqual(["/a", "/b", "/c"]);
    moveQuickLink(ctx, { quick_link_id: a.id, before_id: b.id });
    expect(order()).toEqual(["/b", "/a", "/c"]);
    moveQuickLink(ctx, { quick_link_id: c.id, after_id: b.id });
    expect(order()).toEqual(["/c", "/b", "/a"]);
  });
});
