// @vitest-environment jsdom
/**
 * The "Superagent chat" rail row (decision 146; docs/contracts/ui.md "Navigation and send"): it sits right after
 * "Agents", links to the chat, and is the selected row on the chat path and below it, where "Agents" is not.
 * The other /agents pages (including the control screen) still select "Agents".
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EMPTY_FAVORITES } from "@/components/favorites/tree";
import { SUPERAGENT_CHAT_PATH } from "@/lib/superagent/types";

const nav = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useRouter: () => ({ push: () => {} }) }));
vi.mock("@/components/shell/ProjectMenu", () => ({ ProjectMenu: () => null, projectMove: async () => ({ ok: true }) }));
vi.mock("@/components/shell/FavoritesSection", () => ({ FavoritesSection: () => null }));
vi.mock("@/components/shell/TesseraShell", () => ({ useShell: () => ({ isNavCollapsed: false, setNavCollapsed: () => {}, openCreateProject: () => {} }) }));

const { Sidebar } = await import("@/components/shell/Sidebar");

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

const links = (el: HTMLElement) => [...el.querySelectorAll("a")];
const link = (el: HTMLElement, label: string) => {
  const anchor = links(el).find((candidate) => candidate.textContent?.trim() === label);
  expect(anchor, `link ${label}`).toBeDefined();
  return anchor as HTMLAnchorElement;
};
const isSelected = (anchor: HTMLAnchorElement) => anchor.getAttribute("aria-current") !== null || anchor.getAttribute("data-selected") === "true" || anchor.closest("[aria-current], [data-selected='true']") !== null;

describe("sidebar Superagent chat row", () => {
  it("links to the chat, right after Agents", async () => {
    const el = await renderSidebar("/");
    expect(link(el, "Superagent chat").getAttribute("href")).toBe(SUPERAGENT_CHAT_PATH);
    const labels = links(el).map((anchor) => anchor.textContent?.trim());
    expect(labels.indexOf("Superagent chat")).toBe(labels.indexOf("Agents") + 1);
  });

  it.each([SUPERAGENT_CHAT_PATH, `${SUPERAGENT_CHAT_PATH}/WEB-1`])("on %s the chat row is selected and Agents is not", async (pathname) => {
    const el = await renderSidebar(pathname);
    expect(isSelected(link(el, "Superagent chat"))).toBe(true);
    expect(isSelected(link(el, "Agents"))).toBe(false);
  });

  it.each(["/agents", "/agents/superagent", "/agents/superagent/chatty"])("on %s Agents is selected and the chat row is not", async (pathname) => {
    const el = await renderSidebar(pathname);
    expect(isSelected(link(el, "Agents"))).toBe(true);
    expect(isSelected(link(el, "Superagent chat"))).toBe(false);
  });
});
