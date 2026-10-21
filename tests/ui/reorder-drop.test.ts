/**
 * Drop maths of the States and Labels drag reorder (decision 105,
 * src/components/project-settings/reorder-drop.ts): the hook's drop (container,
 * index among the items that stay, neighbours) becomes the optimistic list and
 * the engine input, and refused drops snap back. The pointer-to-index step
 * itself is `dropIndexFor` (tests/ui/drag-math.test.ts); here it feeds the
 * helpers end to end.
 */
import { describe, expect, it } from "vitest";
import { dropIndexFor, neighboursAt, withoutId, type Rect } from "@/components/dnd/drag-math";
import {
  LABEL_TOP_CONTAINER,
  labelContainerId,
  labelDrop,
  labelDropRefusal,
  labelParentOfContainer,
  labelsIn,
  moveLabel,
  moveStateInGroup,
  stateContainerId,
  stateDrop,
} from "@/components/project-settings/reorder-drop";
import type { Label, State, StateGroup } from "@/lib/tessera/types";

function state(id: string, group: StateGroup): State {
  return { id, name: id, state_group: group } as State;
}

function label(id: string, parentId: string | null = null): Label {
  return { id, name: id, parent_id: parentId } as Label;
}

const names = (items: ReadonlyArray<{ id: string }>) => items.map((item) => item.id);

/** Rows of 40px starting at y=0, the way a list lays them out. */
function rowRects(count: number): Rect[] {
  return Array.from({ length: count }, (_, i) => ({ left: 0, top: i * 40, width: 300, height: 40 }));
}

describe("states: one container per group", () => {
  // Flat order as the engine keeps it: groups interleave after later additions.
  const states = [state("b1", "backlog"), state("s1", "started"), state("s2", "started"), state("d1", "completed"), state("s3", "started")];

  it("moves a state among the other states of its group only", () => {
    // Only the order inside the group matters; other groups' rows keep their relative places.
    expect(names(moveStateInGroup(states, "s1", 1))).toEqual(["b1", "s2", "d1", "s1", "s3"]);
    expect(names(moveStateInGroup(states, "s1", 2))).toEqual(["b1", "s2", "d1", "s3", "s1"]);
    expect(names(moveStateInGroup(states, "s3", 0))).toEqual(["b1", "s3", "s1", "s2", "d1"]);
    expect(names(moveStateInGroup(states, "nope", 0))).toEqual(names(states));
  });

  it("derives the index and one neighbour from a pointer position over the group's rows", () => {
    const group = states.filter((s) => s.state_group === "started").map((s) => s.id);
    const stay = withoutId(group, "s1");
    // Pointer below the midpoint of the first remaining row (y=20) and above the second's: slot 1.
    const index = dropIndexFor({ x: 10, y: 50 }, rowRects(stay.length));
    expect(index).toBe(1);
    const drop = stateDrop(states, { id: "s1", fromContainer: stateContainerId("started"), toContainer: stateContainerId("started"), index, ...neighboursAt(stay, index) });
    // The state follows s2 (before_id); s2 and s3 are not adjacent in the flat order, so only one neighbour is named.
    expect(drop).toEqual({ state_id: "s1", index: 1, input: { before_id: "s2" } });
  });

  it("names after_id at the head of a group and snaps a drop in another group back", () => {
    const started = stateContainerId("started");
    expect(stateDrop(states, { id: "s3", fromContainer: started, toContainer: started, index: 0, after_id: "s1" })?.input).toEqual({ after_id: "s1" });
    expect(stateDrop(states, { id: "s1", fromContainer: started, toContainer: stateContainerId("completed"), index: 1, before_id: "d1" })).toBeNull();
    expect(stateDrop(states, { id: "s1", fromContainer: started, toContainer: started, index: 0 })).toBeNull();
    expect(stateDrop(states, { id: "ghost", fromContainer: started, toContainer: started, index: 0, after_id: "s1" })).toBeNull();
  });
});

describe("labels: the top level and each parent's children are containers", () => {
  const labels = [label("a"), label("a1", "a"), label("a2", "a"), label("b"), label("c"), label("c1", "c")];

  it("maps container ids to parents", () => {
    expect(labelParentOfContainer(LABEL_TOP_CONTAINER)).toBeNull();
    expect(labelParentOfContainer(labelContainerId("a"))).toBe("a");
    expect(labelParentOfContainer("state-group:started")).toBeUndefined();
  });

  it("reorders inside a container", () => {
    expect(names(labelsIn(moveLabel(labels, "a2", "a", 0), "a"))).toEqual(["a2", "a1"]);
    expect(names(labelsIn(moveLabel(labels, "a", null, 2), null))).toEqual(["b", "c", "a"]);
  });

  it("reparents and reorders in one move", () => {
    const into = moveLabel(labels, "b", "a", 1);
    expect(names(labelsIn(into, "a"))).toEqual(["a1", "b", "a2"]);
    expect(into.find((l) => l.id === "b")?.parent_id).toBe("a");
    expect(names(labelsIn(into, null))).toEqual(["a", "c"]);
    // Out of a parent to the top level between two parents; into an empty parent.
    const out = moveLabel(labels, "a1", null, 1);
    expect(names(labelsIn(out, null))).toEqual(["a", "a1", "b", "c"]);
    expect(out.find((l) => l.id === "a1")?.parent_id).toBeNull();
    expect(names(labelsIn(moveLabel(labels, "b", "b", 0), "b"))).toContain("b");
    expect(names(labelsIn(moveLabel(labels, "a1", "b", 0), "b"))).toEqual(["a1"]);
  });

  it("enforces the one-level rule on drops", () => {
    expect(labelDropRefusal(labels, "a", "b")).toBe("a label with sub-labels stays top level");
    expect(labelDropRefusal(labels, "a", "a")).toBe("a label cannot be its own parent");
    expect(labelDropRefusal(labels, "b", "a1")).toBe("labels nest one level deep");
    expect(labelDropRefusal(labels, "b", "a")).toBeNull();
    expect(labelDropRefusal(labels, "a1", null)).toBeNull();
    // A parent can reorder among its own container (same parent: not a reparent).
    expect(labelDropRefusal(labels, "a1", "a")).toBeNull();
    expect(labelDropRefusal(labels, "a", null)).toBeNull();
  });

  it("builds the reorder_label input with parent_id, or snaps back", () => {
    const top = LABEL_TOP_CONTAINER;
    const drop = labelDrop(labels, { id: "b", fromContainer: top, toContainer: labelContainerId("a"), index: 1, before_id: "a1", after_id: "a2" });
    expect(drop).toEqual({ label_id: "b", parent_id: "a", index: 1, before_id: "a1", after_id: "a2" });
    // Into itself: refused.
    expect(labelDrop(labels, { id: "b", fromContainer: top, toContainer: labelContainerId("b"), index: 0 })).toBeNull();
    expect(labelDrop(labels, { id: "a", fromContainer: top, toContainer: labelContainerId("b"), index: 0 })).toBeNull();
    expect(labelDrop(labels, { id: "a1", fromContainer: labelContainerId("a"), toContainer: top, index: 0, after_id: "a" })).toEqual({ label_id: "a1", parent_id: null, index: 0, after_id: "a" });
    expect(labelDrop(labels, { id: "a1", fromContainer: labelContainerId("a"), toContainer: "views", index: 0 })).toBeNull();
  });

  it("drops into the slot under the pointer in a child container", () => {
    const children = labelsIn(labels, "c").map((l) => l.id);
    const stay = withoutId(children, "b");
    const index = dropIndexFor({ x: 10, y: 10 }, rowRects(stay.length));
    expect(index).toBe(0);
    const drop = labelDrop(labels, { id: "b", fromContainer: LABEL_TOP_CONTAINER, toContainer: labelContainerId("c"), index, ...neighboursAt(stay, index) });
    expect(drop).toEqual({ label_id: "b", parent_id: "c", index: 0, after_id: "c1" });
    expect(names(labelsIn(moveLabel(labels, "b", "c", index), "c"))).toEqual(["b", "c1"]);
  });
});
