import { describe, expect, it } from "vitest";
import { buildAiCommands, DESCRIBE_VIEW_ID, matchesCommand, SECTION_ORDER, sortBySection } from "@/components/shell/command-source";
import { askItems } from "@/components/ai/ask-items";

const ALL_ON = { cycles: true, modules: true, views: true, pages: true, intake: true } as const;

describe("buildAiCommands (Describe a view…)", () => {
  it("lists one Create command for a project", () => {
    const items = buildAiCommands("p1", ALL_ON, true);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: DESCRIBE_VIEW_ID, label: "Describe a view…", auxiliaryData: { group: "Create", kind: "command" } });
  });

  it("is also listed for a project the shell has no flags for", () => {
    expect(buildAiCommands("p1", null, true)).toHaveLength(1);
    expect(buildAiCommands("p1", undefined, true)).toHaveLength(1);
  });

  it("is left out outside a project, with views off, or while the assistant is unavailable", () => {
    expect(buildAiCommands(null, null, true)).toEqual([]);
    expect(buildAiCommands("p1", { ...ALL_ON, views: false }, true)).toEqual([]);
    expect(buildAiCommands("p1", ALL_ON, false)).toEqual([]);
  });

  it("matches on its keywords", () => {
    const [item] = buildAiCommands("p1", ALL_ON, true);
    expect(matchesCommand(item, "describe")).toBe(true);
    expect(matchesCommand(item, "prompt")).toBe(true);
    expect(matchesCommand(item, "zzz")).toBe(false);
  });
});

describe("Ask items in the command source", () => {
  it("have their own section, which sorts after every other one", () => {
    expect(SECTION_ORDER[SECTION_ORDER.length - 1]).toBe("Ask");
    const mixed = sortBySection([...askItems("", "/"), ...buildAiCommands("p1", ALL_ON, true)]);
    expect(mixed[0].auxiliaryData?.group).toBe("Create");
  });

  it("match the query by label", () => {
    const [item] = askItems("what is blocked", "/");
    expect(matchesCommand(item, "what is blocked")).toBe(true);
  });
});
