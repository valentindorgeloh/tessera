// @vitest-environment jsdom
/**
 * "Your work" and "Analytics" link to the page they end up on (decision 142). A link to a page that
 * redirects prefetches the redirect, not the page, so its skeleton could not be prefetched. The
 * `isSelected` checks keep matching the whole section, and Power K's go-to commands use the same targets.
 * The page redirects (/your-work, /analytics) stay for typed URLs.
 */
import fs from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EMPTY_FAVORITES } from "@/components/favorites/tree";

const nav = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useRouter: () => ({ push: () => {} }) }));
vi.mock("@/components/shell/ProjectMenu", () => ({ ProjectMenu: () => null, projectMove: async () => ({ ok: true }) }));
vi.mock("@/components/shell/FavoritesSection", () => ({ FavoritesSection: () => null }));
vi.mock("@/components/shell/TesseraShell", async () => {
  const { DEFAULT_NAV_PREFS } = await import("@/components/shell/nav-prefs");
  const noop = () => {};
  return {
    useShell: () => ({ navPrefs: DEFAULT_NAV_PREFS, isNavCollapsed: false, isNavOpen: false, setNavCollapsed: noop, setNavView: noop, setNavDock: noop, setNavOpen: noop, openCreateProject: noop }),
  };
});

const { Sidebar } = await import("@/components/shell/Sidebar");
const { goCommandPath } = await import("@/components/shell/command-source");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }) as MediaQueryList;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(async () => {
  const current = root;
  if (current) await act(async () => current.unmount());
  container?.remove();
  root = null;
  container = null;
  nav.pathname = "/";
});

async function renderSidebar(pathname: string) {
  nav.pathname = pathname;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(Sidebar, { projects: [], unreadCount: 0, draftCount: 0, favorites: EMPTY_FAVORITES }));
  });
  return container;
}

const link = (el: HTMLElement, label: string) => {
  const anchor = [...el.querySelectorAll("a")].find((candidate) => candidate.textContent?.trim() === label);
  expect(anchor, `link ${label}`).toBeDefined();
  return anchor as HTMLAnchorElement;
};
const isSelected = (anchor: HTMLAnchorElement) => anchor.getAttribute("aria-current") !== null || anchor.getAttribute("data-selected") === "true" || anchor.closest("[aria-current], [data-selected='true']") !== null;

describe("sidebar links", () => {
  it("point at the final pages, not at the redirecting section roots", async () => {
    const el = await renderSidebar("/");
    expect(link(el, "Your work").getAttribute("href")).toBe("/your-work/summary");
    expect(link(el, "Analytics").getAttribute("href")).toBe("/analytics/overview");
  });

  it("keep the other rows as they were", async () => {
    const el = await renderSidebar("/");
    expect(link(el, "Home").getAttribute("href")).toBe("/");
    expect(link(el, "Agents").getAttribute("href")).toBe("/agents");
    expect(link(el, "Active cycles").getAttribute("href")).toBe("/active-cycles");
  });

  it.each([
    ["/your-work/assigned", "Your work", "Analytics"],
    ["/your-work", "Your work", "Analytics"],
    ["/analytics/work-items", "Analytics", "Your work"],
    ["/analytics", "Analytics", "Your work"],
  ])("on %s %s is selected and %s is not", async (pathname, selected, other) => {
    const el = await renderSidebar(pathname);
    expect(isSelected(link(el, selected))).toBe(true);
    expect(isSelected(link(el, other))).toBe(false);
  });
});

describe("Power K go-to commands", () => {
  it("use the same final targets", () => {
    expect(goCommandPath("go.yourWork")).toBe("/your-work/summary");
    expect(goCommandPath("go.analytics")).toBe("/analytics/overview");
    expect(goCommandPath("go.agents")).toBe("/agents");
  });

  it("leaves the redirecting section roots in place for typed URLs", () => {
    const root = process.cwd();
    expect(fs.readFileSync(path.join(root, "src/app/(tessera)/your-work/page.tsx"), "utf8")).toContain('redirect("/your-work/summary")');
    expect(fs.readFileSync(path.join(root, "src/app/(tessera)/analytics/page.tsx"), "utf8")).toContain('redirect("/analytics/overview")');
  });
});
