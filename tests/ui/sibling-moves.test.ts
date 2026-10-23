/**
 * Move up / Move down in the States and Labels settings
 * (src/components/project-settings/sibling-moves.ts).
 */
import { describe, expect, it } from "vitest";
import { moveLabel, moveStateInGroup } from "@/components/project-settings/reorder-drop";
import { siblingMove, siblingMoveIndex } from "@/components/project-settings/sibling-moves";
import type { Label, State } from "@/lib/tessera/types";

const IDS = ["a", "b", "c"];

describe("siblingMove", () => {
  it("moves up by naming the previous sibling as after_id", () => {
    expect(siblingMove(IDS, "b", "up")).toEqual({ after_id: "a" });
    expect(siblingMove(IDS, "c", "up")).toEqual({ after_id: "b" });
  });

  it("moves down by naming the next sibling as before_id", () => {
    expect(siblingMove(IDS, "a", "down")).toEqual({ before_id: "b" });
    expect(siblingMove(IDS, "b", "down")).toEqual({ before_id: "c" });
  });

  it("is null at an edge", () => {
    expect(siblingMove(IDS, "a", "up")).toBeNull();
    expect(siblingMove(IDS, "c", "down")).toBeNull();
  });

  it("is null for an unknown id and for a lone row", () => {
    expect(siblingMove(IDS, "x", "up")).toBeNull();
    expect(siblingMove(IDS, "x", "down")).toBeNull();
    expect(siblingMove(["a"], "a", "up")).toBeNull();
    expect(siblingMove(["a"], "a", "down")).toBeNull();
  });
});

describe("siblingMoveIndex (the optimistic menu move, decision 13)", () => {
  it("is one place earlier for up and one place later for down", () => {
    expect(siblingMoveIndex(IDS, "b", "up")).toBe(0);
    expect(siblingMoveIndex(IDS, "a", "down")).toBe(1);
    expect(siblingMoveIndex(IDS, "b", "down")).toBe(2);
  });

  it("is null where siblingMove is null", () => {
    expect(siblingMoveIndex(IDS, "a", "up")).toBeNull();
    expect(siblingMoveIndex(IDS, "c", "down")).toBeNull();
    expect(siblingMoveIndex(IDS, "x", "down")).toBeNull();
  });

  const state = (id: string, group: State["state_group"]) => ({ id, state_group: group }) as State;
  const label = (id: string, parent_id: string | null) => ({ id, parent_id }) as Label;

  it("reorders the states of a group the way the menu names it", () => {
    const states = [state("s1", "backlog"), state("s2", "unstarted"), state("s3", "unstarted"), state("s4", "unstarted")];
    const group = ["s2", "s3", "s4"];
    const down = moveStateInGroup(states, "s2", siblingMoveIndex(group, "s2", "down") ?? -1);
    expect(down.map((item) => item.id)).toEqual(["s1", "s3", "s2", "s4"]);
    const up = moveStateInGroup(states, "s4", siblingMoveIndex(group, "s4", "up") ?? -1);
    expect(up.map((item) => item.id)).toEqual(["s1", "s2", "s4", "s3"]);
  });

  it("reorders the labels of a container the way the menu names it", () => {
    const labels = [label("a", null), label("b", null), label("c", "a"), label("d", "a")];
    const down = moveLabel(labels, "c", "a", siblingMoveIndex(["c", "d"], "c", "down") ?? -1);
    expect(down.map((item) => item.id)).toEqual(["a", "b", "d", "c"]);
    const up = moveLabel(labels, "b", null, siblingMoveIndex(["a", "b"], "b", "up") ?? -1);
    expect(up.map((item) => item.id)).toEqual(["b", "a", "c", "d"]);
  });
});
