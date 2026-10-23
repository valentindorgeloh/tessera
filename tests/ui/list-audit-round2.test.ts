// @vitest-environment jsdom
/**
 * Visual-audit round 2, list lane: the "Show more" footer of a list group sits on the row key column, the locked
 * view's reason is written out for touch users, and the sub-header's actions form one wrapping unit (CSS rules are
 * read from the stylesheets: jsdom has no layout).
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_DISPLAY } from "@/lib/tessera/schemas";
import type { View } from "@/lib/tessera/types";

vi.mock("@/app/actions/views", () => ({ updateViewAction: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/projects/p/views/v",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/components/work-items/project-provider", () => ({ useProject: () => ({ bundle: { project: { archived_at: null } } }) }));
vi.mock("@/components/views/ViewDialog", () => ({ ViewDialog: () => null }));

const { ViewBar } = await import("@/components/views/ViewBar");
const { GroupFooter } = await import("@/components/work-items/GroupFooter");

const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");
const read = (file: string) => strip(readFileSync(path.join(process.cwd(), file), "utf8"));
const norm = (text: string) => text.replace(/\s+/g, " ").trim();

type Block = { prelude: string; body: string };

function blocks(source: string): Block[] {
  const found: Block[] = [];
  let depth = 0;
  let start = 0;
  let prelude = "";
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "{") {
      if (depth === 0) {
        prelude = norm(source.slice(start, i));
        start = i + 1;
      }
      depth++;
    } else if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        found.push({ prelude, body: source.slice(start, i) });
        start = i + 1;
      }
    }
  }
  return found;
}

const rule = (source: string, selector: string) => {
  const found = blocks(source).find((block) => !block.prelude.startsWith("@") && block.prelude.split(",").some((part) => norm(part) === selector));
  if (!found) throw new Error(`no rule for ${selector}`);
  return found.body;
};
const inMedia = (source: string, prelude: string, selector: string) => {
  const media = blocks(source).find((block) => block.prelude === prelude);
  if (!media) throw new Error(`no ${prelude}`);
  return rule(media.body, selector);
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(node: ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(node);
  });
  return container;
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }
  if (typeof globalThis.ResizeObserver !== "function") {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }
});

afterEach(async () => {
  if (root) {
    const current = root;
    await act(async () => {
      current.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
});

const view = (isLocked: boolean) => ({ id: "v1", name: "Open bugs", is_locked: isLocked }) as unknown as View;

describe("Show more footer on the key column", () => {
  it("marks the list variant and lines its button up with the key column (12px inset + 24px checkbox slot, +8px on touch)", async () => {
    const host = await render(createElement(GroupFooter, { display: DEFAULT_DISPLAY, loaded: 50, total: 80, onLoadMore: () => {}, variant: "list" }));
    expect(host.querySelector('.tessera-paging-footer[data-variant="list"]')).not.toBeNull();
    const paging = read("src/components/styles/paging.css");
    expect(norm(rule(paging, '.tessera-paging-footer[data-variant="list"]'))).toContain("padding-inline-start: calc(var(--spacing-3) + var(--spacing-6))");
    expect(norm(inMedia(paging, "@media (pointer: coarse), (max-width: 480px)", '.tessera-paging-footer[data-variant="list"]'))).toContain(
      "padding-inline-start: calc(var(--spacing-3) + var(--spacing-6) + var(--spacing-2))",
    );
    // The table keeps the plain row inset.
    expect(norm(rule(paging, '.tessera-paging-footer[data-variant="row"]'))).toContain("padding-inline: var(--spacing-4)");
  });
});

describe("locked view reason", () => {
  it("writes the reason out beside the disabled Update view, shown only where nothing hovers", async () => {
    const host = await render(createElement(ViewBar, { projectId: "p", view: view(true), isModified: true, effective: { filters: {}, display: DEFAULT_DISPLAY } }));
    expect(host.querySelector(".tessera-view-bar-reason")?.textContent).toBe("Unlock the view to update it");
    const css = read("src/components/styles/views.css");
    expect(rule(css, ".tessera-view-bar-reason")).toMatch(/display:\s*none/);
    expect(inMedia(css, "@media (hover: none)", ".tessera-view-bar-reason")).toMatch(/display:\s*block/);
  });

  it("shows no reason on an unlocked view", async () => {
    const host = await render(createElement(ViewBar, { projectId: "p", view: view(false), isModified: true, effective: { filters: {}, display: DEFAULT_DISPLAY } }));
    expect(host.querySelector(".tessera-view-bar-reason")).toBeNull();
  });
});

describe("sub-header in a narrow window", () => {
  const items = read("src/components/styles/work-items.css");

  it("keeps the actions a unit that flows in the end group, and a wrapping unit only from 481px to 796px", () => {
    expect(rule(items, ".tessera-wi-subheader .tessera-wi-subheader-actions")).toMatch(/display:\s*contents/);
    const range = "@media (min-width: 481px) and (max-width: 796px)";
    expect(inMedia(items, range, ".tessera-wi-subheader > .tessera-panel-bar-end")).toMatch(/display:\s*contents/);
    expect(inMedia(items, range, ".tessera-wi-subheader .tessera-wi-subheader-actions")).toMatch(/display:\s*flex/);
    expect(inMedia(items, range, ".tessera-wi-subheader")).toMatch(/justify-content:\s*flex-end/);
  });
});
