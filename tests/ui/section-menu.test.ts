// @vitest-environment jsdom
/**
 * SectionMenu (src/components/shell/SectionMenu.tsx, decision 14): the phone's
 * replacement for a tab strip. One ghost button named by the current section
 * opens a menu named by the strip it stands in for, one link per section, the
 * current one marked `aria-current="page"`. The band switch is CSS (shell.css),
 * so jsdom only checks the structure; keyboard behaviour (arrows, Escape, focus
 * return) belongs to the Astryx DropdownMenu and is measured in the browser pass.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { SectionMenu } from "@/components/shell/SectionMenu";
import { CycleIcon, KanbanIcon } from "@/themes/catppuccin/icons";

const ENTRIES = [
  { key: "work-items", label: "Work items", href: "/projects/p/work-items", icon: createElement(KanbanIcon) },
  { key: "cycles", label: "Cycles", href: "/projects/p/cycles", icon: CycleIcon },
  { key: "intake", label: "Intake", href: "/projects/p/intake", endContent: createElement("span", { "data-testid": "count" }, "3") },
];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(currentKey: string | null) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(SectionMenu, { label: "Website pages", entries: ENTRIES, currentKey, className: "tessera-section-menu--project" }));
  });
  return container;
}

async function open(el: HTMLElement) {
  const button = el.querySelector<HTMLButtonElement>(".tessera-section-menu-button");
  await act(async () => {
    button?.click();
  });
  return button;
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

describe("SectionMenu", () => {
  it("carries the band classes on its root and names its button by the current section", async () => {
    const el = await render("cycles");
    const menu = el.querySelector(".tessera-section-menu.tessera-section-menu--project");
    expect(menu).not.toBeNull();
    const button = menu?.querySelector<HTMLButtonElement>("button.tessera-section-menu-button");
    expect(button?.textContent).toContain("Cycles");
    expect(button?.getAttribute("aria-label") ?? "Cycles").toBe("Cycles");
  });

  it("falls back to 'Sections' when no entry matches the route", async () => {
    const el = await render(null);
    expect(el.querySelector(".tessera-section-menu-button")?.textContent).toContain("Sections");
  });

  it("opens a role=menu named by the label prop, with one link per entry", async () => {
    const el = await render("cycles");
    await open(el);
    const menu = document.querySelector<HTMLElement>('[role="menu"]');
    expect(menu?.getAttribute("aria-label")).toBe("Website pages");
    const items = [...document.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]')];
    expect(items.map((item) => item.textContent?.trim().replace(/\d+$/, ""))).toEqual(["Work items", "Cycles", "Intake"]);
    expect(items.map((item) => item.getAttribute("href"))).toEqual(["/projects/p/work-items", "/projects/p/cycles", "/projects/p/intake"]);
  });

  it("marks exactly the current entry with aria-current=page and keeps an entry's own end content", async () => {
    const el = await render("intake");
    await open(el);
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items.filter((item) => item.getAttribute("aria-current") === "page")).toHaveLength(1);
    const current = items.find((item) => item.getAttribute("aria-current") === "page");
    expect(current?.textContent).toContain("Intake");
    expect(current?.querySelector('[data-testid="count"]')).not.toBeNull();
  });

  it("marks no entry when the route matches none", async () => {
    const el = await render(null);
    await open(el);
    expect(document.querySelectorAll('[role="menuitem"][aria-current]')).toHaveLength(0);
  });
});
