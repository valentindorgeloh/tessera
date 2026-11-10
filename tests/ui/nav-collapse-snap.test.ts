// @vitest-environment jsdom
/**
 * The sidebar collapse snaps (decision 149): `setNavCollapsed` holds the mark
 * Astryx reads as Reduce Motion on `<html>` for the commit and the frame after
 * it, so AppShell neither glides the content column nor cross-fades the
 * content. The first block pins the private Astryx behaviour this relies on;
 * if an Astryx upgrade fails it, the collapse animates again and this file
 * says why (docs/drafts/astryx-upstream-2026-10-24.md has the issue draft).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SNAP_MARK, setNavCollapsed, subscribe } from "@/components/shell/nav-collapse-store";

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

describe("setNavCollapsed holds the mark for the change", () => {
  let frames: FrameRequestCallback[] = [];

  function runFrame(): void {
    const due = frames.splice(0);
    for (const callback of due) callback(0);
  }

  const hasMark = () => document.documentElement.hasAttribute(SNAP_MARK);

  beforeEach(() => {
    frames = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
  });

  afterEach(() => {
    setNavCollapsed(false);
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
});
