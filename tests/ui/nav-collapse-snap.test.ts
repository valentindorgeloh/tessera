// @vitest-environment jsdom
/**
 * The sidebar strip snaps for Astryx (decision 149): a change of the strip made
 * through `setNavPrefs` (a collapse or expand, a rail kind switch, a dock
 * change) holds the mark Astryx reads as Reduce Motion on `<html>` for the
 * commit and the frame after it, so AppShell neither glides the content column
 * nor cross-fades the content; Tessera's own glide (rail-motion.ts) plays
 * instead, only for a change made on this page. The first block pins the
 * private Astryx behaviour this relies on; if an Astryx upgrade fails it, the
 * collapse animates again and this file says why
 * (docs/drafts/astryx-upstream-2026-10-24.md has the issue draft).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const motion = vi.hoisted(() => ({ holds: [] as { isCollapse: boolean; isDockChange: boolean }[], ends: 0 }));

vi.mock("@/components/shell/rail-motion", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/shell/rail-motion")>();
  return {
    ...original,
    holdRail: (isCollapse: boolean, _isThemeReducingMotion: boolean, options?: { isDockChange?: boolean }) => {
      motion.holds.push({ isCollapse, isDockChange: options?.isDockChange ?? false });
    },
    endRailMotion: () => {
      motion.ends += 1;
    },
  };
});

const { RailChangeSnapshot } = await import("@/components/shell/RailChangeSnapshot");
const { SNAP_MARK, navPrefsStore, setNavPrefs } = await import("@/components/shell/nav-prefs");
const subscribe = navPrefsStore.subscribe;
const setNavCollapsed = (collapsed: boolean) => setNavPrefs({ display: collapsed ? "rail" : "full" });

const ASTRYX = join(process.cwd(), "node_modules/@astryxdesign/core/dist");

function astryxFile(path: string): string {
  return readFileSync(join(ASTRYX, path), "utf8");
}

describe("Astryx still turns a rail change instant under the mark", () => {
  it("reads the mark from the closest ancestor", () => {
    const source = astryxFile("privateAttributes/reducedMotion.stylex.js");
    expect(source).toContain(`'${SNAP_MARK}'`);
    expect(source).toMatch(/closest\??\.?\(`\[\$\{REDUCED_MOTION\}\]`\)/);
  });

  it("makes the layout motion instant when the mark applies and the pointer is fine", () => {
    const source = astryxFile("motion/animatedLayout.js");
    expect(source).toMatch(/themeReducesMotion\(area\)\)\s*\{\s*if \(!matches\(area, '\(pointer: coarse\)'\)\)\s*\{\s*return \{\s*kind: 'instant'/);
  });

  it("decides the content swap and the column glide from that motion", () => {
    const source = astryxFile("AppShell/AppShell.js");
    expect(source).toMatch(/beforeRailChange\(\)\s*\{[\s\S]*?layoutMotionFor\(main\)[\s\S]*?holdLayoutSwap\(contentLayout, main/);
    expect(astryxFile("motion/animatedLayout.js")).toMatch(/function holdLayoutSwap[\s\S]*?kind === 'instant'/);
  });
});

describe("a strip change holds the mark for the change", () => {
  let frames: FrameRequestCallback[] = [];

  function runFrame(): void {
    const due = frames.splice(0);
    for (const callback of due) callback(0);
  }

  const hasMark = () => document.documentElement.hasAttribute(SNAP_MARK);

  beforeEach(() => {
    frames = [];
    motion.holds = [];
    motion.ends = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
  });

  afterEach(() => {
    setNavPrefs({ display: "full", rail: "icons", dock: "docked" });
    while (frames.length > 0) runFrame();
    document.documentElement.removeAttribute(SNAP_MARK);
    vi.restoreAllMocks();
  });

  it("is on when the shell hears of the change and gone two frames later", () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribe(() => seen.push(hasMark()));
    setNavCollapsed(true);
    unsubscribe();
    expect(seen).toEqual([true]);
    runFrame();
    expect(hasMark()).toBe(true);
    runFrame();
    expect(hasMark()).toBe(false);
  });

  it("is not set when the value does not change", () => {
    setNavCollapsed(false);
    expect(hasMark()).toBe(false);
    expect(frames).toHaveLength(0);
  });

  it("stays until the frames of the last of several quick toggles", () => {
    setNavCollapsed(true);
    runFrame();
    setNavCollapsed(false);
    runFrame(); // the first toggle's second frame: the second toggle still needs the mark
    expect(hasMark()).toBe(true);
    runFrame();
    expect(hasMark()).toBe(false);
  });

  it("leaves a mark it did not set", () => {
    document.documentElement.setAttribute(SNAP_MARK, "");
    setNavCollapsed(true);
    while (frames.length > 0) runFrame();
    expect(hasMark()).toBe(true);
  });

  it("is set for a switch between the two rails and for docking and undocking, and not for an unchanged strip", () => {
    setNavPrefs({ display: "rail", rail: "icons" });
    while (frames.length > 0) runFrame();
    setNavPrefs({ rail: "labels" });
    expect(hasMark(), "Icons only to Icons and labels").toBe(true);
    while (frames.length > 0) runFrame();
    setNavPrefs({ dock: "floating" });
    expect(hasMark(), "undocking").toBe(true);
    while (frames.length > 0) runFrame();
    setNavPrefs({ rail: "icons" });
    expect(hasMark(), "the rail kind while floating does not change the strip").toBe(false);
    expect(frames).toHaveLength(0);
  });

  it("is set again in the commit that changes the rail, also when it lands after the toggle's frames", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(createElement(RailChangeSnapshot, { shape: "full" })));
    expect(hasMark()).toBe(false);
    act(() => root.render(createElement(RailChangeSnapshot, { shape: "icons" })));
    expect(hasMark()).toBe(true);
    runFrame();
    runFrame();
    expect(hasMark()).toBe(false);
    act(() => root.render(createElement(RailChangeSnapshot, { shape: "icons" })));
    expect(hasMark()).toBe(false); // an unchanged value is no rail change
    act(() => root.unmount());
  });

  it("glides only a change made on this page; the stored value arriving and a resize drag land at once", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(createElement(RailChangeSnapshot, { shape: "full" })));
    // The stored rail replacing the server's Full after hydration: no change was asked for here.
    act(() => root.render(createElement(RailChangeSnapshot, { shape: "icons" })));
    expect(motion.holds).toEqual([]);
    expect(motion.ends).toBe(1);

    setNavPrefs({ display: "rail", rail: "icons" });
    setNavPrefs({ display: "full" });
    act(() => root.render(createElement(RailChangeSnapshot, { shape: "full" })));
    expect(motion.holds).toEqual([{ isCollapse: false, isDockChange: false }]);

    setNavPrefs({ dock: "floating" });
    act(() => root.render(createElement(RailChangeSnapshot, { shape: "floating" })));
    expect(motion.holds.at(-1)).toEqual({ isCollapse: true, isDockChange: true });

    setNavPrefs({ dock: "docked", display: "rail" }, { animate: false });
    act(() => root.render(createElement(RailChangeSnapshot, { shape: "icons" })));
    expect(motion.holds).toHaveLength(2);
    expect(hasMark(), "Astryx is held off for the drag's change too").toBe(true);
    act(() => root.unmount());
  });
});
