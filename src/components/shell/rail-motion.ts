"use client";

/**
 * The sidebar collapse motion (decision 149). Astryx's AppShell moves the
 * content column with a transform and cross-fades a copy of the old content
 * over the new layout, so the content panel jumps to its new width and fades
 * like a reload. Tessera turns that off (the store holds Astryx's
 * reduced-motion mark for the change) and plays this instead:
 *
 * - The rail's real width glides from what it showed to its new width
 *   (`--duration-medium` on `--ease-move`), so the content panel's leading
 *   edge follows it frame by frame, its trailing edge stays where it is, and
 *   the content never fades. A relayout per frame is cheap on these pages
 *   (under 2 ms measured on a work-items list); a very large document lands
 *   at once instead.
 * - Inside the rail, an inert copy of the old rail, on the wash, crossfades
 *   to the new one, as Astryx's own rail motion does. A collapse fades the
 *   copy's text over the first 40% and the copy over the last 30%; an expand
 *   fades the copy over the first 60% and the real rail's text in over the
 *   last 60%. The rows below the Projects heading move by its height between
 *   the two states, and the crossfade covers that.
 *
 * `setNavCollapsed` calls `holdRail` before the flip, and the Sidebar calls
 * `playRail` in the layout effect of the commit that shows the new state,
 * before it paints. Nothing plays under Reduce Motion, while the theme
 * reduces motion, without the Web Animations API, or in the mobile drawer.
 * A change during a running glide starts from the width the rail shows.
 */

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
/** Marks the copy, for the end of a motion and for tests. */
export const RAIL_COPY_ATTRIBUTE = "data-tessera-rail-copy";
/** Past this many elements in the document a glide relayouts too much per frame, so the change lands at once. */
export const MAX_GLIDE_ELEMENTS = 30_000;
const FALLBACK_DURATION_MS = 280;

type Held = { rail: HTMLElement; from: number; copy: HTMLElement; scrolls: [number, number, number][]; isCollapse: boolean };
type Running = { animations: Animation[]; copy: HTMLElement; rail: HTMLElement; overflow: string; position: string };

let nav: HTMLElement | null = null;
let held: Held | null = null;
let running: Running | null = null;

/** The Sidebar's ref on its SideNav: the nav element, or null when it unmounts (which ends a running motion). */
export function registerRailNav(element: HTMLElement | null): void {
  if (element === null) endRailMotion();
  nav = element;
}

/** Before the change: keeps the rail's width and a copy of what it shows, when the change will glide. */
export function holdRail(isCollapse: boolean, isThemeReducingMotion: boolean): void {
  held = null;
  const rail = nav?.parentElement ?? null;
  if (nav === null || rail === null || !canGlide(rail, isThemeReducingMotion)) {
    endRailMotion();
    return;
  }
  const from = rail.getBoundingClientRect().width;
  endRailMotion();
  const box = nav.getBoundingClientRect();
  const copy = nav.cloneNode(true) as HTMLElement;
  for (const element of [copy, ...Array.from(copy.querySelectorAll<HTMLElement>("[id]"))]) element.removeAttribute("id");
  copy.setAttribute(RAIL_COPY_ATTRIBUTE, "");
  copy.setAttribute("aria-hidden", "true");
  copy.removeAttribute("aria-label");
  copy.removeAttribute("role");
  copy.inert = true;
  Object.assign(copy.style, {
    position: "absolute",
    insetBlockStart: "0",
    insetInlineStart: "0",
    inlineSize: `${box.width}px`,
    blockSize: `${box.height}px`,
    margin: "0",
    pointerEvents: "none",
    backgroundColor: "var(--color-background-body)",
  });
  const scrolls: [number, number, number][] = [];
  Array.from(nav.querySelectorAll("*")).forEach((element, index) => {
    if (element.scrollTop !== 0 || element.scrollLeft !== 0) scrolls.push([index, element.scrollTop, element.scrollLeft]);
  });
  held = { rail, from, copy, scrolls, isCollapse };
}

/** After the change commits, before paint: glides the rail from the held width and crossfades the copy. */
export function playRail(): void {
  const hold = held;
  held = null;
  if (hold === null || nav === null || nav.parentElement !== hold.rail || !hold.rail.isConnected) return;
  const { rail, from, copy, isCollapse } = hold;
  const to = rail.getBoundingClientRect().width;
  if (Math.abs(to - from) < 0.5) return;

  const tokens = getComputedStyle(document.documentElement);
  const duration = parseDuration(tokens.getPropertyValue("--duration-medium")) ?? FALLBACK_DURATION_MS;
  const easing = tokens.getPropertyValue("--ease-move").trim() || "ease";
  const motion: Running = { animations: [], copy, rail, overflow: rail.style.overflow, position: rail.style.position };
  const computed = getComputedStyle(rail);
  if (computed.overflowX !== "clip" && computed.overflowX !== "hidden") rail.style.overflow = "clip";
  if (computed.position === "static") rail.style.position = "relative";
  rail.append(copy);
  const copied = copy.querySelectorAll("*");
  for (const [index, top, left] of hold.scrolls) {
    const element = copied[index];
    if (element) {
      element.scrollTop = top;
      element.scrollLeft = left;
    }
  }

  const fade = (element: Element, keyframes: Keyframe[], fill: FillMode = "none") => motion.animations.push(element.animate(keyframes, { duration, fill }));
  const width = rail.animate([{ width: `${from}px` }, { width: `${to}px` }], { duration, easing });
  motion.animations.push(width);
  if (isCollapse) {
    for (const element of textElements(copy)) fade(element, [{ opacity: 1 }, { opacity: 0, offset: 0.4 }, { opacity: 0 }], "forwards");
    fade(copy, [{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], "forwards");
  } else {
    fade(copy, [{ opacity: 1 }, { opacity: 0, offset: 0.6 }, { opacity: 0 }], "forwards");
    for (const element of textElements(nav)) fade(element, [{ opacity: 0 }, { opacity: 0, offset: 0.4 }, { opacity: 1 }]);
  }
  running = motion;
  width.finished.then(
    () => {
      if (running === motion) endRailMotion();
    },
    () => {},
  );
}

/** Ends a running motion at once: the rail at its real width, the copy gone. */
export function endRailMotion(): void {
  const motion = running;
  running = null;
  if (motion === null) return;
  for (const animation of motion.animations) animation.cancel();
  motion.copy.remove();
  motion.rail.style.overflow = motion.overflow;
  motion.rail.style.position = motion.position;
}

function canGlide(rail: HTMLElement, isThemeReducingMotion: boolean): boolean {
  if (typeof window === "undefined" || typeof rail.animate !== "function" || !rail.isConnected) return false;
  if (isThemeReducingMotion || window.matchMedia?.(REDUCED_MOTION).matches) return false;
  // The phone drawer has no rail to glide.
  if (rail.closest('[role="dialog"]') !== null || rail.getBoundingClientRect().width === 0) return false;
  return document.getElementsByTagName("*").length <= MAX_GLIDE_ELEMENTS;
}

/** The rail's own text: elements that hold a run of text directly. */
function textElements(root: Element): Element[] {
  return Array.from(root.querySelectorAll("*")).filter((element) =>
    Array.from(element.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()),
  );
}

/** A CSS time (`.28s`, `280ms`) in milliseconds. */
export function parseDuration(value: string): number | null {
  const text = value.trim();
  const number = parseFloat(text);
  if (!Number.isFinite(number)) return null;
  if (text.endsWith("ms")) return number;
  if (text.endsWith("s")) return number * 1000;
  return null;
}
