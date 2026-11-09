// @vitest-environment jsdom
/**
 * The sidebar's "New work item" button (`NewItemButton`, src/components/shell/
 * RailParts.tsx) follows Astryx's collapse context, like the rows: icon only in
 * a collapsed rail, the full labelled button when expanded and in the mobile
 * drawer. Below md AppShell renders the sidebar in the top bar's drawer
 * (SideNavRenderContext "drawer-content"), where SideNav provides no collapse
 * context, so the rows are expanded there even while the shell flag is
 * collapsed. The Sidebar used to pick the button from the flag and showed the
 * icon button above expanded rows. The Sidebar cases render the real Sidebar
 * (its server-action menus and navigation mocked) with the view in the real
 * preferences store (nav-prefs.ts) and the frame from `useSideNavChrome()`;
 * the last one hydrates it against server HTML.
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { SideNav, SideNavRenderContext, SideNavSection } from "@astryxdesign/core/SideNav";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Project } from "@/lib/tessera/types";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: () => {} }) }));
vi.mock("@/components/shell/ProjectMenu", () => ({ ProjectMenu: () => null, projectMove: async () => ({ ok: true }) }));
vi.mock("@/components/shell/FavoritesSection", () => ({ FavoritesSection: () => null }));
// useShell() reads the preferences store, as TesseraShell's does; the actions other than the collapse are inert.
vi.mock("@/components/shell/TesseraShell", async () => {
  const store = await import("@/components/shell/nav-prefs");
  const setNavCollapsed = (collapsed: boolean) => store.setNavPrefs({ display: collapsed ? "rail" : "full" });
  return {
    useShell: () => {
      const navPrefs = store.useNavPrefs();
      const isNavOpen = store.useNavOpen();
      return { navPrefs, isNavCollapsed: store.isRailShown(navPrefs), isNavOpen, setNavCollapsed, setNavView: () => {}, setNavDock: () => {}, setNavOpen: () => {}, openCreateProject: () => {} };
    },
  };
});

const { NewItemButton, RailItem } = await import("@/components/shell/RailParts");
const { Sidebar } = await import("@/components/shell/Sidebar");
const { DEFAULT_NAV_PREFS, setNavPrefs } = await import("@/components/shell/nav-prefs");
const setNavCollapsed = (collapsed: boolean) => setNavPrefs({ display: collapsed ? "rail" : "full" });
const { EMPTY_FAVORITES } = await import("@/components/favorites/tree");
const { HouseIcon } = await import("@/themes/catppuccin/icons");

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

async function cleanup() {
  if (root) {
    const current = root;
    await act(async () => {
      current.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
}

afterEach(async () => {
  await cleanup();
  setNavPrefs(DEFAULT_NAV_PREFS);
  localStorage.clear();
  document.body.innerHTML = "";
});

function mount(): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  return container;
}

async function render(node: ReactNode) {
  const el = mount();
  root = createRoot(el);
  await act(async () => {
    root?.render(node);
  });
  return el;
}

// createElement with the children as arguments, typed loosely: the components' props require `children`.
const h = createElement as unknown as (type: unknown, props: object | null, ...children: ReactNode[]) => ReactNode;

/** Which "New work item" control is rendered: the icon-only IconButton or the labelled full-width Button. */
function variantOf(el: HTMLElement): "icon" | "full" {
  const buttons = [...el.querySelectorAll("button")].filter((button) => button.getAttribute("aria-label") === "New work item" || button.textContent?.trim() === "New work item");
  expect(buttons).toHaveLength(1);
  const button = buttons[0] as HTMLButtonElement;
  if (button.classList.contains("tessera-sidebar-new") && button.textContent?.trim() === "New work item") return "full";
  expect(button.textContent?.trim()).toBe("");
  return "icon";
}

/** A collapsed rail wraps each RailItem in a tooltip naming it (RailParts.tsx S3); expanded rows have none. */
function rowsAreExpanded(el: HTMLElement): boolean {
  return ![...el.querySelectorAll('[role="tooltip"]')].some((tip) => tip.textContent === "Home");
}

function button(isCollapsed: boolean | undefined, props: Partial<{ isDisabled: boolean; tooltip: string; onClick: () => void }> = {}) {
  return h(
    SideNav,
    {
      "aria-label": "Work",
      collapsible: isCollapsed === undefined ? false : { isCollapsed, hasButton: false },
      topContent: h(NewItemButton, { label: "New work item", tooltip: "Create a work item (N I)", isDisabled: false, onClick: () => {}, ...props }),
    },
    h(SideNavSection, { title: "Workspace", isHeaderHidden: true }, h(RailItem, { label: "Home", icon: HouseIcon, href: "/" })),
  );
}

const drawer = (node: ReactNode) => h(SideNavRenderContext, { value: "drawer-content" }, node);

describe("NewItemButton inside Astryx SideNav", () => {
  it("is the icon-only button in a collapsed rail", async () => {
    const el = await render(button(true));
    expect(rowsAreExpanded(el)).toBe(false);
    expect(variantOf(el)).toBe("icon");
  });

  it("is the full labelled button in an expanded rail", async () => {
    const el = await render(button(false));
    expect(rowsAreExpanded(el)).toBe(true);
    expect(variantOf(el)).toBe("full");
  });

  it("is the full labelled button in the mobile drawer while the flag is collapsed, like the rows", async () => {
    setNavCollapsed(true);
    const el = await render(drawer(button(true)));
    expect(rowsAreExpanded(el)).toBe(true);
    expect(variantOf(el)).toBe("full");
  });

  it("passes the click through in both variants and the disabled state", async () => {
    const onClick = vi.fn();
    for (const isCollapsed of [false, true]) {
      const el = await render(button(isCollapsed, { onClick }));
      const target = el.querySelector<HTMLButtonElement>(isCollapsed ? 'button[aria-label="New work item"]' : "button.tessera-sidebar-new");
      await act(async () => target?.click());
      await cleanup();
    }
    expect(onClick).toHaveBeenCalledTimes(2);
    const el = await render(button(undefined, { isDisabled: true, tooltip: "Create a project first", onClick }));
    const disabled = el.querySelector("button.tessera-sidebar-new");
    expect(disabled?.hasAttribute("disabled") || disabled?.getAttribute("aria-disabled") === "true").toBe(true);
  });
});

const NOW = "2026-10-11T10:00:00.000Z";
const audit = { created_at: NOW, updated_at: NOW, created_by: "u1", updated_by: "u1", deleted_at: null };
const PROJECT: Project = {
  id: "p1",
  name: "Website",
  name_key: "website",
  identifier: "WEB",
  description_md: "",
  logo: { icon: "Globe", color: "blue" },
  next_sequence: 1,
  cycles_enabled: true,
  modules_enabled: true,
  views_enabled: true,
  pages_enabled: true,
  intake_enabled: false,
  estimates_enabled: false,
  agent_intake_required: false,
  estimate_id: null,
  estimate_type: null,
  default_assignee_id: null,
  archive_in_months: null,
  close_in_months: null,
  close_state_id: null,
  archived_at: null,
  sort_order: "a0",
  ...audit,
  counts: { total: 3, by_state_group: { backlog: 3, unstarted: 0, started: 0, completed: 0, cancelled: 0, triage: 0 } },
};

const sidebar = () => h(Sidebar, { projects: [PROJECT], unreadCount: 0, draftCount: 0, favorites: EMPTY_FAVORITES });

describe("Sidebar topContent", () => {
  it("shows the icon button in the collapsed rail and the full button once expanded", async () => {
    setNavCollapsed(true);
    const el = await render(sidebar());
    expect(variantOf(el)).toBe("icon");
    await act(async () => setNavCollapsed(false));
    expect(variantOf(el)).toBe("full");
  });

  it("shows the full button in the drawer while the shell flag is collapsed (collapse at 1440 then narrow, or mod+b on a phone)", async () => {
    setNavCollapsed(true);
    const el = await render(drawer(sidebar()));
    expect(el.querySelector('a[href="/projects/p1/work-items"]')).not.toBeNull();
    expect(rowsAreExpanded(el)).toBe(true);
    expect(variantOf(el)).toBe("full");
  });

  it("renders the chrome: our id and class, data-rail on a rail, the autofocus mark and Sidebar options outside the drawer", async () => {
    setNavPrefs({ display: "rail", rail: "labels" });
    const el = await render(sidebar());
    const navEl = el.querySelector("nav#tessera-sidebar.tessera-sidebar");
    expect(navEl?.getAttribute("aria-label")).toBe("Work");
    expect(navEl?.getAttribute("data-rail")).toBe("labels");
    expect(el.querySelector('button[aria-label="New work item"]')?.hasAttribute("data-nav-autofocus")).toBe(true);
    expect(el.querySelector("#tessera-nav-options")?.getAttribute("aria-label")).toBe("Sidebar options");
    await cleanup();
    const drawerEl = await render(drawer(sidebar()));
    expect(drawerEl.querySelector("#tessera-nav-options")).toBeNull();
    expect(drawerEl.querySelector("button.tessera-sidebar-new")?.hasAttribute("data-nav-autofocus")).toBe(true);
  });

  it("hydrates against the server's expanded HTML when the flag flipped before the boundary hydrated", async () => {
    const el = mount();
    el.innerHTML = renderToString(sidebar());
    expect(variantOf(el)).toBe("full");
    setNavCollapsed(true); // `mod+b` before the streamed sidebar hydrates
    const onRecoverableError = vi.fn();
    await act(async () => {
      root = hydrateRoot(el, sidebar(), { onRecoverableError });
    });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(variantOf(el)).toBe("icon");
  });
});
