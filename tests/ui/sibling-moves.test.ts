/**
 * Move up / Move down in the States and Labels settings
 * (src/components/project-settings/sibling-moves.ts).
 */
import { describe, expect, it } from "vitest";
import { siblingMove } from "@/components/project-settings/sibling-moves";

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
