/**
 * Page drag maths (decision 105): drop neighbours become `move_page` input
 * (the before/after names are swapped), a drop under the page itself or its
 * own subtree is refused, the optimistic order follows the move, and the
 * landing line sits where the pointer's slot is.
 */
import { describe, expect, it } from "vitest";
import { applyPageMove, dropLineFor, isPageDraggable, pageMoveFromDrop, ROOT_CONTAINER, siblingIds } from "@/components/pages/page-move";
import { dropIndexFor, neighboursAt, withoutId } from "@/components/dnd/drag-math";
import type { PageSummary } from "@/lib/tessera/types";

function page(id: string, parent_id: string | null = null): PageSummary {
  return {
    id,
    project_id: null,
    parent_id,
    name: id,
    access: "public",
    is_locked: false,
    logo: null,
    archived_at: null,
    sort_order: id,
    label_ids: [],
    child_count: 0,
    updated_at: "2026-10-11T10:00:00.000Z",
    updated_by: "u",
  };
}

// A, B (children B1, B2), C at the top level, in list order.
const pages = [page("A"), page("B"), page("B1", "B"), page("B2", "B"), page("C")];

describe("siblingIds", () => {
  it("lists the ids drawn under a parent in list order", () => {
    expect(siblingIds(pages, null)).toEqual(["A", "B", "C"]);
    expect(siblingIds(pages, "B")).toEqual(["B1", "B2"]);
  });

  it("draws a page whose parent is not in the list at the top level", () => {
    expect(siblingIds([page("X", "gone"), page("Y")], null)).toEqual(["X", "Y"]);
  });
});

describe("pageMoveFromDrop", () => {
  it("swaps the neighbour names: the sibling after the slot is `before_id`", () => {
    expect(pageMoveFromDrop(pages, { id: "C", toContainer: ROOT_CONTAINER, before_id: "A", after_id: "B" })).toEqual({ page_id: "C", parent_id: null, before_id: "B" });
  });

  it("uses the sibling before the slot as `after_id` when the slot is last", () => {
    expect(pageMoveFromDrop(pages, { id: "A", toContainer: ROOT_CONTAINER, before_id: "C" })).toEqual({ page_id: "A", parent_id: null, after_id: "C" });
  });

  it("reparents into a child group and sends only the parent for an empty slot list", () => {
    expect(pageMoveFromDrop(pages, { id: "A", toContainer: "B", before_id: "B1", after_id: "B2" })).toEqual({ page_id: "A", parent_id: "B", before_id: "B2" });
    expect(pageMoveFromDrop([page("A"), page("B")], { id: "A", toContainer: "B" })).toEqual({ page_id: "A", parent_id: "B" });
  });

  it("refuses a drop under the page itself or one of its descendants", () => {
    expect(pageMoveFromDrop(pages, { id: "B", toContainer: "B" })).toBeNull();
    const deep = [...pages, page("B11", "B1")];
    expect(pageMoveFromDrop(deep, { id: "B", toContainer: "B1" })).toBeNull();
    expect(pageMoveFromDrop(deep, { id: "B", toContainer: "B11" })).toBeNull();
  });

  it("skips neighbours that are only drawn at the top level", () => {
    const withOrphan = [page("A"), page("X", "hidden"), page("C")];
    expect(pageMoveFromDrop(withOrphan, { id: "C", toContainer: ROOT_CONTAINER, before_id: "A", after_id: "X" })).toEqual({ page_id: "C", parent_id: null, after_id: "A" });
  });

  it("refuses to move a row drawn at the top level whose real parent is hidden", () => {
    const withOrphan = [page("A"), page("X", "hidden")];
    expect(isPageDraggable(withOrphan, "X")).toBe(false);
    expect(pageMoveFromDrop(withOrphan, { id: "X", toContainer: ROOT_CONTAINER, before_id: "A" })).toBeNull();
  });

  it("works with the pointer maths: a pointer in the top half of B puts the page before B", () => {
    // Rows A, B, C stacked 40px tall; the pointer is at y=45, inside B's top half.
    const rects = ["A", "B", "C"].map((_, index) => ({ left: 0, top: index * 40, width: 200, height: 40 }));
    const stay = withoutId(["A", "B", "C"], "C");
    const slot = dropIndexFor({ x: 10, y: 45 }, rects.slice(0, 2), "y");
    expect(slot).toBe(1);
    const neighbours = neighboursAt(stay, slot);
    expect(pageMoveFromDrop(pages, { id: "C", toContainer: ROOT_CONTAINER, ...neighbours })).toEqual({ page_id: "C", parent_id: null, before_id: "B" });
  });
});

describe("applyPageMove", () => {
  it("puts the page before the named sibling and keeps its subtree attached", () => {
    const next = applyPageMove(pages, { page_id: "C", parent_id: null, before_id: "B" });
    expect(siblingIds(next, null)).toEqual(["A", "C", "B"]);
    expect(siblingIds(next, "B")).toEqual(["B1", "B2"]);
  });

  it("puts the page after the named sibling", () => {
    expect(siblingIds(applyPageMove(pages, { page_id: "A", parent_id: null, after_id: "C" }), null)).toEqual(["B", "C", "A"]);
  });

  it("reparents and appends when no neighbour is named", () => {
    const next = applyPageMove(pages, { page_id: "A", parent_id: "B" });
    expect(siblingIds(next, null)).toEqual(["B", "C"]);
    expect(siblingIds(next, "B")).toEqual(["B1", "B2", "A"]);
    expect(next.find((entry) => entry.id === "A")?.parent_id).toBe("B");
  });

  it("leaves the list alone for an unknown page", () => {
    expect(applyPageMove(pages, { page_id: "nope", parent_id: null })).toEqual(pages);
  });
});

describe("dropLineFor", () => {
  it("lines up above the sibling at the slot, or below the last one", () => {
    expect(dropLineFor(pages, "C", { container: ROOT_CONTAINER, index: 1 })).toEqual({ before: "B" });
    expect(dropLineFor(pages, "A", { container: ROOT_CONTAINER, index: 2 })).toEqual({ after: "C" });
    expect(dropLineFor(pages, "A", { container: "B", index: 0 })).toEqual({ before: "B1" });
  });

  it("shows nothing without a target, for an empty container or inside the dragged subtree", () => {
    expect(dropLineFor(pages, "A", null)).toEqual({});
    expect(dropLineFor([page("A")], "A", { container: ROOT_CONTAINER, index: 0 })).toEqual({});
    expect(dropLineFor(pages, "B", { container: "B", index: 0 })).toEqual({});
  });
});
