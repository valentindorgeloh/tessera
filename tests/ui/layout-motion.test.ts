// @vitest-environment jsdom
/**
 * Layout motion helpers (src/components/shell/layout-motion.ts, decisions 132
 * and 133): duration parsing, the token read, the width plan, the jank guard
 * with a fake requestAnimationFrame, and the jsdom fallbacks (no
 * `Element.prototype.animate`, no `matchMedia`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  JANK_FRAME_MS,
  LAYOUT_MOTION_FALLBACK_MS,
  LAYOUT_MOTION_TOKEN,
  animateSlide,
  animateWidth,
  fadeIn,
  guardJank,
  isJanky,
  isResizing,
  isSidenavDrawer,
  layoutMotionMs,
  parseDurationMs,
  prefersReducedMotion,
  sideNavPanel,
  widthMotionPlan,
  withWidthMotion,
} from "@/components/shell/layout-motion";

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
  it("reports no reduced motion and no drawer, and finds no resize or panel", () => {
    expect(typeof window.matchMedia).not.toBe("function");
    expect(prefersReducedMotion()).toBe(false);
    expect(isSidenavDrawer()).toBe(false);
    expect(isResizing()).toBe(false);
    expect(sideNavPanel()).toBeNull();
  });

  it("follows matchMedia when it exists", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));
    expect(prefersReducedMotion()).toBe(true);
    expect(isSidenavDrawer()).toBe(false);
  });
});

describe("widthMotionPlan", () => {
  it("skips reduced motion, resizing and equal widths", () => {
    expect(widthMotionPlan({ from: 250, to: 48, reduced: true, resizing: false })).toBeNull();
    expect(widthMotionPlan({ from: 250, to: 48, reduced: false, resizing: true })).toBeNull();
    expect(widthMotionPlan({ from: 48, to: 48.5, reduced: false, resizing: false })).toBeNull();
    expect(widthMotionPlan({ from: 250, to: 48, reduced: false, resizing: false })).toEqual({ from: 250, to: 48 });
  });
});

describe("isJanky", () => {
  it("needs two of the first three intervals over two frames", () => {
    expect(JANK_FRAME_MS).toBe(34);
    expect(isJanky([16, 17, 16])).toBe(false);
    expect(isJanky([40, 40, 16])).toBe(true);
    expect(isJanky([16, 40, 40])).toBe(true);
    expect(isJanky([40, 16, 16])).toBe(false);
    expect(isJanky([40])).toBe(false);
    expect(isJanky([16, 16, 16, 40, 40])).toBe(false);
  });
});

function fakeFrames() {
  const queue = new Map<number, FrameRequestCallback>();
  let next = 1;
  return {
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
      const id = next++;
      queue.set(id, callback);
      return id;
    }),
    cancelAnimationFrame: vi.fn((id: number) => {
      queue.delete(id);
    }),
    /** Runs the pending frame callbacks at `time`. */
    run(time: number) {
      const callbacks = [...queue.values()];
      queue.clear();
      for (const callback of callbacks) callback(time);
    },
    get pending() {
      return queue.size;
    },
  };
}

function fakeAnimation() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    finish: vi.fn(),
    addEventListener: (type: string, listener: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(listener);
    },
    removeEventListener: (type: string, listener: () => void) => {
      listeners.get(type)?.delete(listener);
    },
    fire(type: string) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener();
    },
  };
}

function runFrames(frames: ReturnType<typeof fakeFrames>, times: number[]) {
  for (const time of times) frames.run(time);
}

describe("guardJank", () => {
  it("finishes a janky animation", () => {
    const frames = fakeFrames();
    const animation = fakeAnimation();
    guardJank(animation as unknown as Animation, frames);
    runFrames(frames, [0, 40, 80]);
    expect(animation.finish).toHaveBeenCalledTimes(1);
    expect(frames.pending).toBe(0);
  });

  it("finishes when the second and third intervals are long", () => {
    const frames = fakeFrames();
    const animation = fakeAnimation();
    guardJank(animation as unknown as Animation, frames);
    runFrames(frames, [0, 16, 56, 96]);
    expect(animation.finish).toHaveBeenCalledTimes(1);
    expect(frames.pending).toBe(0);
  });

  it("leaves a smooth animation alone and stops after three intervals", () => {
    const frames = fakeFrames();
    const animation = fakeAnimation();
    guardJank(animation as unknown as Animation, frames);
    runFrames(frames, [0, 16, 33, 49]);
    expect(frames.pending).toBe(0);
    runFrames(frames, [100, 200]);
    expect(animation.finish).not.toHaveBeenCalled();
    expect(frames.requestAnimationFrame).toHaveBeenCalledTimes(4);
  });

  it("stops sampling when the animation ends or the stop function runs", () => {
    const frames = fakeFrames();
    const animation = fakeAnimation();
    guardJank(animation as unknown as Animation, frames);
    frames.run(0);
    animation.fire("finish");
    expect(frames.pending).toBe(0);

    const other = fakeAnimation();
    const stop = guardJank(other as unknown as Animation, frames);
    stop();
    expect(frames.pending).toBe(0);
    runFrames(frames, [0, 50, 100]);
    expect(other.finish).not.toHaveBeenCalled();
  });
});

describe("jsdom fallbacks", () => {
  it("withWidthMotion runs the change exactly once without an element", () => {
    const change = vi.fn();
    expect(withWidthMotion(null, change)).toBeNull();
    expect(change).toHaveBeenCalledTimes(1);
  });

  it("withWidthMotion runs the change exactly once with an element that cannot animate", () => {
    const el = document.createElement("div");
    const change = vi.fn();
    expect(withWidthMotion(el, change)).toBeNull();
    expect(change).toHaveBeenCalledTimes(1);
  });

  it("returns null when Element.prototype.animate is missing", () => {
    const el = document.createElement("div");
    expect(typeof el.animate).not.toBe("function");
    expect(animateWidth(el, { from: 250, to: 48 })).toBeNull();
    expect(animateSlide(el, "translateX(100%)", "none")).toBeNull();
    expect(fadeIn(el)).toBeNull();
    expect(fadeIn(null)).toBeNull();
  });

  it("animates with the token's timing when animate exists", () => {
    document.documentElement.style.setProperty(LAYOUT_MOTION_TOKEN, "280ms");
    const el = document.createElement("div");
    const animate = vi.fn(() => ({}) as Animation);
    Object.defineProperty(el, "animate", { value: animate });
    animateSlide(el, "translateX(100%)", "none", { fill: "forwards" });
    expect(animate).toHaveBeenCalledWith([{ transform: "translateX(100%)" }, { transform: "none" }], { duration: 280, easing: "ease-in-out", fill: "forwards" });
    animateWidth(el, { from: 250, to: 48 });
    expect(animate).toHaveBeenLastCalledWith([{ width: "250px" }, { width: "48px" }], { duration: 280, easing: "ease-in-out" });
  });

  it("finds the resize marker and the sidebar panel", () => {
    const panel = document.createElement("div");
    panel.className = "astryx-app-shell-sidenav";
    const handle = document.createElement("div");
    handle.setAttribute("data-resizing", "");
    document.body.append(panel, handle);
    expect(sideNavPanel()).toBe(panel);
    expect(isResizing()).toBe(true);
  });
});
