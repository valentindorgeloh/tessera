/**
 * Assistant scope from the route on screen (src/components/ai/assistant-scope.ts).
 */
import { describe, expect, it } from "vitest";
import {
  assistantHeading,
  composerPlaceholder,
  keyFromLabel,
  parseProjectIdentifier,
  scopeFromLocation,
  scopeSuggestions,
} from "@/components/ai/assistant-scope";

const PROJECT = "00000000-0000-4000-8000-0000000000a1";
const ITEM = "00000000-0000-4000-8000-0000000000b2";
const CYCLE = "00000000-0000-4000-8000-0000000000c3";
const MODULE = "00000000-0000-4000-8000-0000000000d4";

function query(value: string) {
  return new URLSearchParams(value);
}

describe("scopeFromLocation", () => {
  it("reads the project, and a work item from the detail path, the global path or the peek", () => {
    expect(scopeFromLocation(`/projects/${PROJECT}/work-items`, null)).toEqual({ project_id: PROJECT });
    expect(scopeFromLocation(`/projects/${PROJECT}/work-items/${ITEM}`, null)).toEqual({ project_id: PROJECT, work_item_id: ITEM });
    expect(scopeFromLocation(`/work-items/${ITEM}`, null)).toEqual({ work_item_id: ITEM });
    expect(scopeFromLocation(`/projects/${PROJECT}/work-items`, query(`peek=${ITEM}`))).toEqual({ project_id: PROJECT, work_item_id: ITEM });
  });

  it("prefers a work item in the path over the peek, and fills a cycle or module", () => {
    expect(scopeFromLocation(`/projects/${PROJECT}/work-items/${ITEM}`, query(`peek=${CYCLE}`))).toEqual({
      project_id: PROJECT,
      work_item_id: ITEM,
    });
    expect(scopeFromLocation(`/projects/${PROJECT}/cycles/${CYCLE}`, query(`peek=${ITEM}`))).toEqual({
      project_id: PROJECT,
      cycle_id: CYCLE,
      work_item_id: ITEM,
    });
    expect(scopeFromLocation(`/projects/${PROJECT}/modules/${MODULE}/`, null)).toEqual({ project_id: PROJECT, module_id: MODULE });
    expect(scopeFromLocation(`/projects/${PROJECT}/cycles`, null)).toEqual({ project_id: PROJECT });
  });

  it("ignores archives, invalid ids and an empty peek", () => {
    expect(scopeFromLocation("/projects/archives", null)).toEqual({});
    expect(scopeFromLocation("/projects/archives/work-items", query(`peek=${ITEM}`))).toEqual({ work_item_id: ITEM });
    expect(scopeFromLocation("/projects/not-a-uuid/work-items", query("peek=nope"))).toEqual({});
    expect(scopeFromLocation("/home", null)).toEqual({});
  });
});

describe("scope labels and suggestions", () => {
  it("reads a project identifier and a work item key out of display text", () => {
    expect(parseProjectIdentifier(" web ")).toBe("WEB");
    expect(parseProjectIdentifier("not an id")).toBeNull();
    expect(keyFromLabel("web-12 Fix login")).toBe("WEB-12");
    expect(keyFromLabel("Cycle 3")).toBeNull();
  });

  it("names the header Assistant · WEB, and WEB · WEB-1 when an item is open", () => {
    expect(assistantHeading("WEB", null)).toEqual({ title: "Assistant · WEB", subtitle: null });
    expect(assistantHeading("WEB", "WEB-1")).toEqual({ title: "Assistant", subtitle: "WEB · WEB-1" });
    expect(assistantHeading(null, null)).toEqual({ title: "Assistant", subtitle: null });
  });

  it("offers three suggestions from the scope, and the project placeholder", () => {
    expect(scopeSuggestions({ project_id: PROJECT })).toEqual(["What changed this week?", "What should I work on next?", "What is in progress?"]);
    expect(scopeSuggestions({ project_id: PROJECT, work_item_id: ITEM })[0]).toBe("What is this item about?");
    expect(scopeSuggestions({ project_id: PROJECT, cycle_id: CYCLE })[0]).toBe("Summarise this cycle");
    expect(scopeSuggestions({ project_id: PROJECT, module_id: MODULE })[0]).toBe("Summarise this module");
    expect(scopeSuggestions({})).toHaveLength(3);
    expect(composerPlaceholder({ project_id: PROJECT })).toBe("Ask about this project…");
    expect(composerPlaceholder({})).toBe("Ask about Tessera…");
  });
});
