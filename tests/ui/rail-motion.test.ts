// @vitest-environment jsdom
/**
 * The sidebar collapse motion (src/components/shell/rail-motion.ts, decision
 * 149). jsdom has no layout and no Web Animations, so the rail's widths are
 * stubbed and `animate` is recorded: the rail's width glides from the held
 * width to the new one, an inert copy of the old rail sits over it and is
 * gone at the end, and nothing plays under Reduce Motion, while the theme
 * reduces motion, or without a held change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RAIL_COPY_ATTRIBUTE, endRailMotion, holdRail, parseDuration, playRail, registerRailNav } from "@/components/shell/rail-motion";

type Played = { element: Element; keyframes: Keyframe[]; options: KeyframeAnimationOptions; animation: { cancel: ReturnType<typeof vi.fn>; finish: () => void } };

let played: Played[] = [];
let railWidth = 236;
let rail: HTMLElement;
let nav: HTMLElement;
let reduced = false;

function fakeAnimate(this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
  let finish = () => {};
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const animation = { cancel: vi.fn(), finish, finished };
  played.push({ element: this, keyframes, options, animation });
  return animation as unknown as Animation;
}

function box(width: number): DOMRect {
  return { width, height: 600, top: 0, left: 0, right: width, bottom: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
}

beforeEach(() => {
  played = [];
  railWidth = 236;
  reduced = false;
  document.body.innerHTML = '<div id="rail"><nav id="work" aria-label="Work"><a id="home" href="/"><svg></svg><span>Home</span></a><p>Projects</p></nav></div>';
  rail = document.getElementById("rail")!;
  nav = document.getElementById("work")!;
  rail.getBoundingClientRect = () => box(railWidth);
  nav.getBoundingClientRect = () => box(railWidth);
  Object.defineProperty(Element.prototype, "animate", { value: fakeAnimate, configurable: true, writable: true });
  window.matchMedia = vi.fn((query: string) => ({ matches: reduced && query.includes("reduce") }) as MediaQueryList);
  registerRailNav(nav);
});

afterEach(() => {
  endRailMotion();
  registerRailNav(null);
  delete (Element.prototype as { animate?: unknown }).animate;
});

const widthGlide = () => played.find((entry) => entry.element === rail);
const copy = () => rail.querySelector(`[${RAIL_COPY_ATTRIBUTE}]`);

describe("rail motion", () => {
  it("glides the rail's width from the held width to the new one, under an inert copy that leaves at the end", async () => {
    holdRail(true, false);
    railWidth = 48;
    playRail();

    const glide = widthGlide();
    expect(glide?.keyframes).toEqual([{ width: "236px" }, { width: "48px" }]);
    expect(glide?.options.duration).toBeGreaterThan(0);
    const held = copy() as HTMLElement | null;
    expect(held).not.toBeNull();
    expect(held?.getAttribute("aria-hidden")).toBe("true");
    expect(held?.inert).toBe(true);
    expect(held?.querySelectorAll("[id]")).toHaveLength(0);
    expect(held?.hasAttribute("id")).toBe(false);
    expect(held?.style.backgroundColor).toBe("var(--color-background-body)");
    expect(rail.style.overflow).toBe("clip");

    glide?.animation.finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(copy()).toBeNull();
    expect(rail.style.overflow).toBe("");
  });

  it("fades the copy's text early and the copy late on a collapse, and the real labels in late on an expand", () => {
    holdRail(true, false);
    railWidth = 48;
    playRail();
    const copied = copy()!;
    expect(played.some((entry) => copied.contains(entry.element) && entry.element !== copied && entry.keyframes[1]?.offset === 0.4)).toBe(true);
    expect(played.some((entry) => entry.element === copied && entry.keyframes[1]?.offset === 0.7)).toBe(true);

    endRailMotion();
    played = [];
    holdRail(false, false);
    railWidth = 236;
    playRail();
    expect(played.some((entry) => entry.element === copy() && entry.keyframes[1]?.offset === 0.6)).toBe(true);
    expect(played.some((entry) => nav.contains(entry.element) && entry.keyframes[0]?.opacity === 0)).toBe(true);
  });

  it("starts a change made during a glide from the width the rail shows, with one copy", () => {
    holdRail(true, false);
    railWidth = 48;
    playRail();
    railWidth = 140; // where the running glide has the rail
    holdRail(false, false);
    expect(copy()).toBeNull(); // the running motion ended before the new hold
    railWidth = 236;
    playRail();
    expect(played.filter((entry) => entry.element === rail).at(-1)?.keyframes).toEqual([{ width: "140px" }, { width: "236px" }]);
    expect(rail.querySelectorAll(`[${RAIL_COPY_ATTRIBUTE}]`)).toHaveLength(1);
  });

  it("lands at once under Reduce Motion, while the theme reduces motion, or without a held change", () => {
    reduced = true;
    holdRail(true, false);
    railWidth = 48;
    playRail();
    expect(played).toHaveLength(0);

    reduced = false;
    railWidth = 236;
    holdRail(true, true);
    railWidth = 48;
    playRail();
    expect(played).toHaveLength(0);

    playRail();
    expect(played).toHaveLength(0);
    expect(copy()).toBeNull();
  });

  it("ends a running motion when the sidebar unmounts", () => {
    holdRail(true, false);
    railWidth = 48;
    playRail();
    expect(copy()).not.toBeNull();
    registerRailNav(null);
    expect(copy()).toBeNull();
    expect(widthGlide()?.animation.cancel).toHaveBeenCalled();
  });

  it("reads CSS times", () => {
    expect(parseDuration(".28s")).toBe(280);
    expect(parseDuration("280ms")).toBe(280);
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("auto")).toBeNull();
  });
});
