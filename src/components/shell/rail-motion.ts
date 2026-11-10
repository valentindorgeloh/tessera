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
 *   the content never fades. The nav keeps its own width meanwhile and the
 *   rail clips it, so the sidebar itself never reflows. A relayout of the
 *   content per frame is cheap on these pages (under 2 ms measured on a
 *   work-items list); a very large document lands at once instead.
 * - Inside the rail, an inert copy of the old rail, on the wash, crossfades
 *   to the new one, as Astryx's own rail motion does. A collapse fades the
 *   copy's text over the first 40% and the copy over the last 30%; an expand
 *   fades the copy over the first 60% and the real rail's text in over the
 *   last 60%. The rows below the Projects heading move by its height between
 *   the two states, and the crossfade covers that.
 * - A change during a running glide starts from what the rail shows: its
 *   width, how visible the labels are, and how visible the collapsed rail is.
 *
 * `RailChangeSnapshot` calls `holdRail` (through the store's
 * `prepareRailChange`) in the commit that changes the collapse state, before
 * the DOM changes, and the Sidebar calls `playRail` in that commit's layout
 * effect, before it paints. Nothing plays under Reduce Motion, while the theme
 * reduces motion, with a coarse primary pointer (there the mark gives Astryx's
 * own short cross-fade, and one motion is enough), without the Web Animations
 * API, or in the phone drawer.
 */

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const COARSE_POINTER = "(pointer: coarse)";
/** Marks the copy, for the end of a motion, the sidebar padding rule and tests. */
export const RAIL_COPY_ATTRIBUTE = "data-tessera-rail-copy";
/** Past this many elements in the document a glide relayouts too much per frame, so the change lands at once. */
export const MAX_GLIDE_ELEMENTS = 30_000;
const FALLBACK_DURATION_MS = 280;

/** How visible the expanded rail's labels and the collapsed rail are, each 0 to 1. */
type Shown = { labels: number; collapsed: number };
type Held = { rail: HTMLElement; from: number; shown: Shown; copy: HTMLElement; scrolls: [number, number, number][]; isCollapse: boolean };
type Running = {
  animations: Animation[];
  width: Animation;
  duration: number;
  isCollapse: boolean;
  from: Shown;
  copy: HTMLElement;
  rail: HTMLElement;
  nav: HTMLElement;
  restore: { overflow: string; position: string; flexShrink: string };
};

let nav: HTMLElement | null = null;
let held: Held | null = null;
let running: Running | null = null;

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** The labels and the collapsed rail over a motion's progress, from what the rail showed when it started. */
function labelsAt(isCollapse: boolean, from: Shown, p: number): number {
  return isCollapse ? from.labels * (1 - clamp(p / 0.4)) : from.labels + (1 - from.labels) * clamp((p - 0.4) / 0.6);
}

function collapsedAt(isCollapse: boolean, from: Shown, p: number): number {
  return isCollapse ? from.collapsed + (1 - from.collapsed) * clamp((p - 0.7) / 0.3) : from.collapsed * (1 - clamp(p / 0.6));
}

/** The Sidebar's ref on its SideNav: the nav element, or null when it unmounts (which ends a running motion). */
export function registerRailNav(element: HTMLElement | null): void {
  if (element === null) endRailMotion();
  nav = element;
}

/** Before the change, in its commit: keeps the rail's width, what it shows and a copy of it, when the change will glide. */
export function holdRail(isCollapse: boolean, isThemeReducingMotion: boolean): void {
  held = null;
  const rail = nav?.parentElement ?? null;
  if (nav === null || rail === null || !canGlide(rail, isThemeReducingMotion)) {
    endRailMotion();
    return;
  }
  const from = rail.getBoundingClientRect().width;
  let shown: Shown = isCollapse ? { labels: 1, collapsed: 0 } : { labels: 0, collapsed: 1 };
  if (running !== null) {
    const p = clamp(Number(running.width.currentTime ?? 0) / running.duration);
    shown = { labels: labelsAt(running.isCollapse, running.from, p), collapsed: collapsedAt(running.isCollapse, running.from, p) };
  }
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
  held = { rail, from, shown, copy, scrolls, isCollapse };
}

/** After the change commits, before paint: glides the rail from the held width and crossfades the copy. */
export function playRail(): void {
  const hold = held;
  held = null;
  const current = nav;
  if (hold === null || current === null || current.parentElement !== hold.rail || !hold.rail.isConnected) return;
  const { rail, from, shown, copy, isCollapse } = hold;
  const to = rail.getBoundingClientRect().width;
  if (Math.abs(to - from) < 0.5) return;

  const tokens = getComputedStyle(document.documentElement);
  const duration = parseDuration(tokens.getPropertyValue("--duration-medium")) ?? FALLBACK_DURATION_MS;
  const easing = tokens.getPropertyValue("--ease-move").trim() || "ease";
  const restore = { overflow: rail.style.overflow, position: rail.style.position, flexShrink: current.style.flexShrink };
  const computed = getComputedStyle(rail);
  if (computed.overflowX !== "clip" && computed.overflowX !== "hidden") rail.style.overflow = "clip";
  if (computed.position === "static") rail.style.position = "relative";
  // The nav keeps its width while the rail's narrows or widens around it, so the rail reveals it instead of reflowing it.
  current.style.flexShrink = "0";
  rail.append(copy);
  const copied = copy.querySelectorAll("*");
  for (const [index, top, left] of hold.scrolls) {
    const element = copied[index];
    if (element) {
      element.scrollTop = top;
      element.scrollLeft = left;
    }
  }

  const width = rail.animate([{ width: `${from}px` }, { width: `${to}px` }], { duration, easing });
  const motion: Running = { animations: [width], width, duration, isCollapse, from: shown, copy, rail, nav: current, restore };
  const fade = (element: Element, keyframes: Keyframe[], fill: FillMode = "none") => motion.animations.push(element.animate(keyframes, { duration, fill }));
  const { labels, collapsed } = shown;
  if (isCollapse) {
    // The copy is the expanded rail over the real, collapsed one: its labels go first, then the copy itself.
    for (const element of textElements(copy)) fade(element, [{ opacity: labels }, { opacity: 0, offset: 0.4 }, { opacity: 0 }], "forwards");
    fade(copy, [{ opacity: 1 - collapsed }, { opacity: 1 - collapsed, offset: 0.7 }, { opacity: 0 }], "forwards");
  } else {
    // The copy is the collapsed rail over the real, expanded one: it goes first, then the labels come in.
    fade(copy, [{ opacity: collapsed }, { opacity: 0, offset: 0.6 }, { opacity: 0 }], "forwards");
    for (const element of textElements(current)) fade(element, [{ opacity: labels }, { opacity: labels, offset: 0.4 }, { opacity: 1 }]);
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
  motion.rail.style.overflow = motion.restore.overflow;
  motion.rail.style.position = motion.restore.position;
  motion.nav.style.flexShrink = motion.restore.flexShrink;
}

function canGlide(rail: HTMLElement, isThemeReducingMotion: boolean): boolean {
  if (typeof window === "undefined" || typeof rail.animate !== "function" || !rail.isConnected) return false;
  if (isThemeReducingMotion || window.matchMedia?.(REDUCED_MOTION).matches || window.matchMedia?.(COARSE_POINTER).matches) return false;
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
