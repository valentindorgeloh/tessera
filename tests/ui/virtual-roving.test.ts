// @vitest-environment jsdom
/**
 * The roving tab stop of a virtual list (src/components/virtual/roving.ts, decision 136): exactly one item keeps
 * tabindex="0" after a window commit, and an item that already holds it keeps it wherever it sits.
 */
import { describe, expect, it } from "vitest";
import { stampTabStops } from "@/components/virtual/roving";

function list(tabindexes: (string | null)[]): HTMLElement {
  const root = document.createElement("ul");
  for (const value of tabindexes) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.className = "tessera-wi-open";
    if (value !== null) button.setAttribute("tabindex", value);
    li.append(button);
    root.append(li);
  }
  return root;
}

const stops = (root: HTMLElement) => [...root.querySelectorAll(".tessera-wi-open")].map((el) => el.getAttribute("tabindex"));

describe("stampTabStops", () => {
  it("gives the first item the stop when none holds it", () => {
    const root = list([null, null, null]);
    stampTabStops(root, ".tessera-wi-open");
    expect(stops(root)).toEqual(["0", "-1", "-1"]);
  });

  it("keeps a single stop where it is", () => {
    const root = list(["-1", "0", "-1"]);
    stampTabStops(root, ".tessera-wi-open");
    expect(stops(root)).toEqual(["-1", "0", "-1"]);
  });

  it("keeps the first of two stops", () => {
    const root = list(["-1", "0", "0"]);
    stampTabStops(root, ".tessera-wi-open");
    expect(stops(root)).toEqual(["-1", "0", "-1"]);
  });

  it("keeps a stop placed after freshly mounted, unstamped items", () => {
    const root = list([null, null, "0", null]);
    stampTabStops(root, ".tessera-wi-open");
    expect(stops(root)).toEqual(["-1", "-1", "0", "-1"]);
  });

  it("does nothing on an empty list", () => {
    const root = list([]);
    expect(() => stampTabStops(root, ".tessera-wi-open")).not.toThrow();
  });
});
