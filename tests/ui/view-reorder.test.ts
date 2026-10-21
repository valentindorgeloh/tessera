/**
 * Drop maths of the views list drag reorder (decision 105,
 * src/components/views/view-reorder.ts).
 */
import { describe, expect, it } from "vitest";
import { dropIndexFor, neighboursAt, withoutId, type Rect } from "@/components/dnd/drag-math";
import { moveView, viewDropInput } from "@/components/views/view-reorder";
import type { View } from "@/lib/tessera/types";

const views = ["a", "b", "c", "d"].map((id) => ({ id, name: id }) as View);
const ids = (list: View[]) => list.map((view) => view.id);

describe("moveView", () => {
  it("places a view at the index measured against the other views", () => {
    expect(ids(moveView(views, "a", 2))).toEqual(["b", "c", "a", "d"]);
    expect(ids(moveView(views, "d", 0))).toEqual(["d", "a", "b", "c"]);
    expect(ids(moveView(views, "b", 3))).toEqual(["a", "c", "d", "b"]);
    expect(ids(moveView(views, "b", 1))).toEqual(["a", "b", "c", "d"]);
    expect(ids(moveView(views, "zz", 1))).toEqual(["a", "b", "c", "d"]);
  });
});

describe("viewDropInput", () => {
  it("passes both neighbours from a pointer position", () => {
    const stay = withoutId(["a", "b", "c", "d"], "a");
    const rects: Rect[] = stay.map((_, i) => ({ left: 0, top: i * 48, width: 400, height: 48 }));
    // Between b (0-48) and c (48-96) the second row's midpoint is 72; a pointer at y=60 lands before it.
    const index = dropIndexFor({ x: 20, y: 60 }, rects);
    expect(index).toBe(1);
    expect(viewDropInput({ id: "a", ...neighboursAt(stay, index) })).toEqual({ view_id: "a", before_id: "b", after_id: "c" });
    expect(ids(moveView(views, "a", index))).toEqual(["b", "a", "c", "d"]);
  });

  it("names one neighbour at either end and nothing for a lone view", () => {
    expect(viewDropInput({ id: "d", after_id: "a" })).toEqual({ view_id: "d", after_id: "a" });
    expect(viewDropInput({ id: "a", before_id: "d" })).toEqual({ view_id: "a", before_id: "d" });
    expect(viewDropInput({ id: "a" })).toBeNull();
  });
});
