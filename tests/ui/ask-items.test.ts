import { describe, expect, it } from "vitest";
import { ASK_CHANGED, ASK_CYCLE, ASK_MAX_LENGTH, ASK_MODULE, ASK_NEXT, ASK_PREFIX, askItems, askSuggestions } from "@/components/ai/ask-items";

const PROJECT = "01JABCDEFGHJKMNPQRSTVWXYZ0";
const CYCLE = "01JABCDEFGHJKMNPQRSTVWXYZ1";

describe("askSuggestions", () => {
  it("offers one general question outside a project", () => {
    expect(askSuggestions("/")).toEqual([ASK_NEXT]);
    expect(askSuggestions("/projects")).toEqual([ASK_NEXT]);
    expect(askSuggestions("/projects/archives")).toEqual([ASK_NEXT]);
  });

  it("adds the weekly question inside a project", () => {
    expect(askSuggestions(`/projects/${PROJECT}/work-items`)).toEqual([ASK_CHANGED, ASK_NEXT]);
    expect(askSuggestions(`/projects/${PROJECT}/cycles`)).toEqual([ASK_CHANGED, ASK_NEXT]);
  });

  it("leads with the summary on a cycle or module detail, at most three", () => {
    expect(askSuggestions(`/projects/${PROJECT}/cycles/${CYCLE}`)).toEqual([ASK_CYCLE, ASK_CHANGED, ASK_NEXT]);
    expect(askSuggestions(`/projects/${PROJECT}/modules/${CYCLE}`)).toEqual([ASK_MODULE, ASK_CHANGED, ASK_NEXT]);
    expect(askSuggestions(`/projects/${PROJECT}/cycles/${CYCLE}/`)).toHaveLength(3);
  });
});

describe("askItems", () => {
  it("makes one Ask item from a typed question", () => {
    const items = askItems("  what is in progress?  ", "/");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: `${ASK_PREFIX}what is in progress?`,
      label: "Ask: what is in progress?",
      auxiliaryData: { group: "Ask", kind: "ask", text: "what is in progress?" },
    });
  });

  it("keeps the query inside the label so the palette's narrowing keeps the item", () => {
    const [item] = askItems("Burndown", "/");
    expect(item.label.toLowerCase()).toContain("burndown");
  });

  it("lists the suggestions for an empty or blank query", () => {
    for (const query of ["", "   "]) {
      const items = askItems(query, `/projects/${PROJECT}/cycles/${CYCLE}`);
      expect(items.map((item) => item.label)).toEqual([ASK_CYCLE, ASK_CHANGED, ASK_NEXT]);
      expect(items.every((item) => item.auxiliaryData?.kind === "ask")).toBe(true);
    }
  });

  it("carries the suggestion text unchanged as the question", () => {
    const [item] = askItems("", "/");
    expect(item.auxiliaryData).toEqual({ group: "Ask", kind: "ask", text: ASK_NEXT });
  });

  it("cuts a question to the assistant's turn limit", () => {
    const [item] = askItems("x".repeat(ASK_MAX_LENGTH + 50), "/");
    const aux = item.auxiliaryData;
    expect(aux?.kind === "ask" ? aux.text.length : -1).toBe(ASK_MAX_LENGTH);
  });
});
