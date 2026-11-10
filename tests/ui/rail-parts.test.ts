// @vitest-environment jsdom
/**
 * The sidebar pieces that depend on the collapsed rail (src/components/shell/
 * RailParts.tsx, S2, S3) and the not-found heading (S15). Collapse state comes
 * from a real Astryx SideNav, so these read the same context the sidebar does.
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SideNav, SideNavSection } from "@astryxdesign/core/SideNav";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/components/shell/recents-store", () => ({ useMissingRoute: () => {} }));
vi.mock("@/app/actions/favorites", () => ({
  deleteFavoriteFolderAction: async () => ({ ok: true }),
  moveFavoriteAction: async () => ({ ok: true }),
  moveFavoriteFolderAction: async () => ({ ok: true }),
  removeFavoriteAction: async () => ({ ok: true }),
}));
vi.mock("@/components/shell/FavoriteDialog", () => ({ FavoriteDialog: () => null }));

const { ExpandedOnly, RailItem, RowActions } = await import("@/components/shell/RailParts");
const { HouseIcon } = await import("@/themes/catppuccin/icons");
const { NotFoundScreen } = await import("@/components/shell/NotFoundScreen");
const { FavoritesSection } = await import("@/components/shell/FavoritesSection");

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

async function render(node: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(node);
  });
  return container;
}

// createElement with the children as arguments, typed loosely: the components' props require `children`.
const h = createElement as unknown as (type: unknown, props: object | null, ...children: ReactNode[]) => ReactNode;

function nav(isCollapsed: boolean) {
  return h(
    SideNav,
    { "aria-label": "Work", collapsible: { isCollapsed, hasButton: false } },
    h(
      SideNavSection,
      { title: "Projects", endContent: h(ExpandedOnly, null, h("button", { type: "button" }, "Create project")) },
      h(RailItem, { label: "Inbox", href: "/inbox", icon: HouseIcon }),
    ),
  );
}

describe("ExpandedOnly (S2)", () => {
  it("renders its children while the sidebar is expanded", async () => {
    const el = await render(nav(false));
    expect(el.querySelector("button")?.textContent).toBe("Create project");
  });

  it("renders nothing in a collapsed rail, so no hidden section button stays a focus stop", async () => {
    const el = await render(nav(true));
    expect(el.querySelector("button")).toBeNull();
  });
});

describe("RailItem (S3)", () => {
  it("names a collapsed row in exactly one tooltip, Astryx's own on the link", async () => {
    const el = await render(nav(true));
    const tips = [...el.querySelectorAll('[role="tooltip"]')].map((tip) => tip.textContent);
    // Astryx 0.7.5+ puts the label tooltip on the collapsed link; the 0.6.8 wrapper would add a second one.
    expect(tips).toEqual(["Inbox"]);
    const link = el.querySelector('a[aria-label="Inbox"]');
    expect(link?.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("renders the bare row, with no tooltip, while expanded", async () => {
    const el = await render(nav(false));
    expect(el.querySelector('[role="tooltip"]')).toBeNull();
    expect(el.querySelector("a")?.textContent).toContain("Inbox");
  });
});

describe("RailItem labels for the Icons and labels rail (decision 128)", () => {
  it("puts data-rail-label on the collapsed link and keeps the tooltip and the link's name", async () => {
    const el = await render(nav(true));
    const link = el.querySelector('a[aria-label="Inbox"]');
    expect(link?.getAttribute("data-rail-label")).toBe("Inbox");
    expect([...el.querySelectorAll('[role="tooltip"]')].map((tip) => tip.textContent)).toContain("Inbox");
  });

  it("keeps the label out of a project link's name: the name stays its aria-label with the count", async () => {
    const el = await render(
      h(
        SideNav,
        { "aria-label": "Work", collapsible: { isCollapsed: true, hasButton: false } },
        h(SideNavSection, { title: "Projects" }, h(RailItem, { label: "Website", "aria-label": "Website 12", href: "/projects/p1/work-items", icon: HouseIcon })),
      ),
    );
    const link = el.querySelector('a[href="/projects/p1/work-items"]');
    expect(link?.getAttribute("aria-label")).toBe("Website 12");
    expect(link?.getAttribute("data-rail-label")).toBe("Website");
  });

  it("is harmless on the expanded row", async () => {
    const el = await render(nav(false));
    const link = el.querySelector('a[href="/inbox"]');
    expect(link?.textContent).toContain("Inbox");
    expect(el.querySelector("[data-rail-label]")?.getAttribute("data-rail-label")).toBe("Inbox");
  });

  it("is on the favourites folder's collapsed button too", async () => {
    const tree = {
      folders: [{ id: "f1", name: "Launch", sort_order: "a0", items: [] }],
      items: [],
      order: [{ kind: "folder" as const, id: "f1" }],
    };
    const el = await render(h(SideNav, { "aria-label": "Work", collapsible: { isCollapsed: true, hasButton: false } }, h(FavoritesSection, { tree })));
    const folder = el.querySelector('button[aria-label="Launch"]');
    expect(folder?.getAttribute("data-rail-label")).toBe("Launch");
  });
});

describe("RowActions (S9)", () => {
  it("holds the menu and, when given, the count, in the classes the stylesheet hides and reveals", async () => {
    const el = await render(h(RowActions, { count: 12 }, h("button", { type: "button" }, "menu")));
    expect(el.querySelector(".tessera-row-actions .tessera-row-count")?.textContent).toBe("12");
    expect(el.querySelector(".tessera-row-actions .tessera-row-menu button")?.textContent).toBe("menu");
  });

  it("hides the count from assistive tech: the row's link names itself with the count instead", async () => {
    const el = await render(
      h(
        SideNav,
        { "aria-label": "Work" },
        h(
          SideNavSection,
          { title: "Projects" },
          h(RailItem, {
            label: "Website",
            "aria-label": "Website 12",
            href: "/projects/p1/work-items",
            icon: HouseIcon,
            actions: h(RowActions, { count: 12 }, h("button", { type: "button", "aria-label": "Project actions" })),
          }),
        ),
      ),
    );
    expect(el.querySelector(".tessera-row-count")?.getAttribute("aria-hidden")).toBe("true");
    const link = el.querySelector('a[href="/projects/p1/work-items"]');
    expect(link?.getAttribute("aria-label")).toBe("Website 12");
    expect(link?.textContent).toContain("Website");
  });

  it("has no count element for a row without one", async () => {
    const el = await render(h(RowActions, null, h("button", { type: "button" }, "menu")));
    expect(el.querySelector(".tessera-row-count")).toBeNull();
  });
});

describe("NotFoundScreen (S15)", () => {
  it("renders the title as the page's one h1", async () => {
    const el = await render(h(NotFoundScreen, null));
    const headings = [...el.querySelectorAll("h1, h2, h3")];
    expect(headings.map((h) => h.tagName)).toEqual(["H1"]);
    expect(headings[0]?.textContent).toBe("Page not found");
  });
});
