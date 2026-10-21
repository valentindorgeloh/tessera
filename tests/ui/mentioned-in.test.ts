// @vitest-environment jsdom
/**
 * "Mentioned in" of the work item detail (decision 44, PLAN section 12 step 7):
 * one link per page that embeds the item, a project page under its project
 * route, an archived page marked, and nothing at all without backlinks.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { MentionedIn } from "@/components/detail/MentionedIn";
import type { PageBacklink } from "@/lib/tessera/types";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(backlinks: PageBacklink[]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(MentionedIn, { backlinks }));
  });
  return container;
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("MentionedIn", () => {
  it("renders nothing without backlinks", async () => {
    const view = await render([]);
    expect(view.textContent).toBe("");
  });

  it("links a wiki page and a project page to their canonical routes and marks an archived one", async () => {
    const view = await render([
      { id: "p-wiki", name: "Launch notes", project_id: null, archived_at: null },
      { id: "p-proj", name: "Backlink page", project_id: "proj-1", archived_at: "2026-10-01T00:00:00Z" },
    ]);
    expect(view.textContent).toContain("Mentioned in (2)");
    const hrefs = Array.from(view.querySelectorAll("a")).map((a) => [a.textContent, a.getAttribute("href")]);
    expect(hrefs).toEqual([
      ["Launch notes", "/pages/p-wiki"],
      ["Backlink page", "/projects/proj-1/pages/p-proj"],
    ]);
    expect(view.textContent).toContain("Archived");
  });
});
