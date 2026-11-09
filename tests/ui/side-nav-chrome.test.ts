/**
 * The SideNav frame for each sidebar view and dock (src/components/shell/
 * side-nav-chrome.ts, decisions 128–129): docked Full, Icons only and Icons
 * and labels; floating closed and open; and the mobile drawer, where the dock
 * preference is ignored. The drag-collapse callback passes straight through.
 */
import { describe, expect, it, vi } from "vitest";

// The pure function needs neither the sidebar nor the shell; their modules pull in Next and server actions.
vi.mock("@/components/shell/Sidebar", () => ({ useSidebarResize: () => ({ key: "default", resizable: {} }) }));
vi.mock("@/components/shell/TesseraShell", () => ({ useShell: () => ({}) }));

const { sideNavChrome } = await import("@/components/shell/side-nav-chrome");
const { DEFAULT_NAV_PREFS } = await import("@/components/shell/nav-prefs");

const RESIZABLE = { defaultWidth: 280, minWidth: 236, maxWidth: 350, onWidthChange: () => {} };

function chrome(prefs: Partial<typeof DEFAULT_NAV_PREFS>, options: { isOpen?: boolean; isDrawer?: boolean } = {}) {
  const onCollapsedChange = vi.fn();
  const result = sideNavChrome({
    prefs: { ...DEFAULT_NAV_PREFS, ...prefs },
    isOpen: options.isOpen ?? false,
    isDrawer: options.isDrawer ?? false,
    width: RESIZABLE.defaultWidth,
    resizable: RESIZABLE,
    onCollapsedChange,
  });
  return { result, onCollapsedChange };
}

describe("sideNavChrome", () => {
  it("docked Full: expanded, resizable, no rail, no dock attributes", () => {
    const { result, onCollapsedChange } = chrome({});
    expect(result).toMatchObject({ id: "tessera-sidebar", className: "tessera-sidebar", resizable: RESIZABLE, inert: false });
    expect(result.collapsible).toMatchObject({ isCollapsed: false, hasButton: false });
    expect(result["data-rail"]).toBeUndefined();
    expect(result["data-dock"]).toBeUndefined();
    expect(result["data-open"]).toBeUndefined();
    expect(result.style).toBeUndefined();
    result.collapsible.onCollapsedChange?.(true);
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
  });

  it("docked Icons only: Astryx's collapsed rail with data-rail=icons", () => {
    const { result, onCollapsedChange } = chrome({ display: "rail", rail: "icons" });
    expect(result.collapsible).toMatchObject({ isCollapsed: true, hasButton: false });
    expect(result["data-rail"]).toBe("icons");
    expect(result.resizable).toBe(RESIZABLE);
    result.collapsible.onCollapsedChange?.(false);
    expect(onCollapsedChange).toHaveBeenCalledWith(false);
  });

  it("docked Icons and labels: the same collapsed rail with data-rail=labels", () => {
    const { result } = chrome({ display: "rail", rail: "labels" });
    expect(result.collapsible.isCollapsed).toBe(true);
    expect(result["data-rail"]).toBe("labels");
    expect(result["data-dock"]).toBeUndefined();
  });

  it("floating and closed: Full view, not resizable, inert, slid out with the stored width", () => {
    const { result } = chrome({ display: "rail", rail: "labels", dock: "floating" });
    expect(result.collapsible).toEqual({ isCollapsed: false, hasButton: false });
    expect(result.resizable).toBeUndefined();
    expect(result["data-rail"]).toBeUndefined();
    expect(result["data-dock"]).toBe("floating");
    expect(result["data-open"]).toBeUndefined();
    expect(result.inert).toBe(true);
    expect(result.style).toEqual({ "--tessera-nav-float-width": "280px" });
  });

  it("floating and open: data-open and not inert", () => {
    const { result } = chrome({ dock: "floating" }, { isOpen: true });
    expect(result["data-dock"]).toBe("floating");
    expect(result["data-open"]).toBe("");
    expect(result.inert).toBe(false);
  });

  it("in the drawer the dock is ignored: the docked frame, never inert", () => {
    const { result } = chrome({ dock: "floating" }, { isOpen: false, isDrawer: true });
    expect(result["data-dock"]).toBeUndefined();
    expect(result.inert).toBe(false);
    expect(result.resizable).toBe(RESIZABLE);
  });
});
