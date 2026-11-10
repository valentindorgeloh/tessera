// @vitest-environment jsdom
/**
 * Layout motion helpers (src/components/shell/layout-motion.ts, decisions 132
 * and 133): duration parsing, the token read, and the jsdom fallbacks (no
 * `matchMedia`). The sidebar's width motion is rail-motion.ts (decision 149,
 * tests/ui/rail-motion.test.ts).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { LAYOUT_MOTION_FALLBACK_MS, LAYOUT_MOTION_TOKEN, isSidenavDrawer, layoutExitPlays, layoutMotionMs, parseDurationMs, prefersReducedMotion } from "@/components/shell/layout-motion";

afterEach(() => {
  document.documentElement.style.removeProperty(LAYOUT_MOTION_TOKEN);
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseDurationMs", () => {
  it("reads milliseconds and seconds, including the built CSS's .28s", () => {
    expect(parseDurationMs("280ms")).toBe(280);
    expect(parseDurationMs(".28s")).toBe(280);
    expect(parseDurationMs("0.28s")).toBe(280);
    expect(parseDurationMs(" .28s ")).toBe(280);
  });

  it("falls back for empty, keyword and negative values", () => {
    expect(parseDurationMs("")).toBe(LAYOUT_MOTION_FALLBACK_MS);
    expect(parseDurationMs("auto")).toBe(LAYOUT_MOTION_FALLBACK_MS);
    expect(parseDurationMs("-1s")).toBe(LAYOUT_MOTION_FALLBACK_MS);
    expect(parseDurationMs("auto", 120)).toBe(120);
  });
});

describe("layoutMotionMs", () => {
  it("reads --duration-medium from <html> and falls back to 300 when it is empty", () => {
    expect(layoutMotionMs()).toBe(300);
    document.documentElement.style.setProperty(LAYOUT_MOTION_TOKEN, ".28s");
    expect(layoutMotionMs()).toBe(280);
  });
});

describe("environment checks without matchMedia", () => {
  it("reports no reduced motion and no drawer", () => {
    expect(typeof window.matchMedia).not.toBe("function");
    expect(prefersReducedMotion()).toBe(false);
    expect(isSidenavDrawer()).toBe(false);
    expect(layoutExitPlays()).toBe(true);
  });

  it("follows matchMedia when it exists", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));
    expect(prefersReducedMotion()).toBe(true);
    expect(isSidenavDrawer()).toBe(false);
    expect(layoutExitPlays()).toBe(false);
  });
});
