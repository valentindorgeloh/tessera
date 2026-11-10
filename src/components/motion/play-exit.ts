/**
 * Runs a CSS exit and waits for it (the side-panel slides, src/components/styles/motion.css).
 *
 * `playExit(element)` marks the element `data-exiting`, which the Tessera motion
 * classes turn into the exit animation (`forwards`, so the element stays out
 * until its owner unmounts it), and resolves when that animation ends. Then the
 * caller closes the surface (clears a flag, navigates):
 *
 *   playExit(panel).then(close, ignoreCancelled);
 *
 * It settles three ways:
 * - Resolves at once when the element runs no CSS animation: Reduce Motion
 *   (every Tessera rule is `animation: none` there, and the media query is
 *   checked too), a class without an exit rule, or an environment without the
 *   Web Animations API.
 * - Resolves when every running CSS animation of the element has finished (the
 *   `animationend` moment).
 * - REJECTS with an AbortError when the animation is cancelled (the `animationcancel`
 *   moment: Activity hid the route, the element unmounted) or when the caller's
 *   `signal` aborts. The attribute is removed first, so a reveal or a reopened
 *   surface shows normally instead of replaying the exit and staying out. A
 *   caller must treat a rejection as "do not close, do not navigate":
 *   `isExitCancelled(error)` tells it from a real error.
 *
 * Once it has resolved the attribute stays (the exit holds the surface out);
 * `clearExit(element)` takes the surface back (a reopen that keeps the node).
 * It is the one place a Tessera close waits on motion. Do not wait on an Astryx
 * animator promise instead: it resolves at spring settle (about 0.75 s for a
 * panel width), far too slow to hold a close.
 */

/** The attribute the Tessera motion classes read to play the exit. */
export const EXITING_ATTRIBUTE = "data-exiting";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

export type PlayExitOptions = {
  /** Abort to take the exit back: the attribute is removed and the promise rejects (see `isExitCancelled`). */
  signal?: AbortSignal;
};

/** The error a cancelled exit rejects with: an `AbortError` DOMException, like a cancelled animation's own `finished`. */
function cancelled(): DOMException {
  return new DOMException("The exit animation was cancelled", "AbortError");
}

/** True for the rejection of a cancelled exit, so a caller can ignore it and rethrow anything else. */
export function isExitCancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** A `.catch` handler for `playExit(...)`: swallows a cancelled exit, rethrows every other error. */
export function ignoreCancelled(error: unknown): void {
  if (!isExitCancelled(error)) throw error;
}

/** Takes the exit back: removes the attribute so the element shows as it is. */
export function clearExit(element: Element): void {
  element.removeAttribute(EXITING_ATTRIBUTE);
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION).matches;
}

/** The CSS animations (not transitions) the element runs now; `getAnimations` flushes the style change first. */
function cssAnimations(element: Element): Animation[] {
  if (typeof element.getAnimations !== "function") return [];
  return element.getAnimations().filter((animation) => "animationName" in animation);
}

export function playExit(element: Element, options: PlayExitOptions = {}): Promise<void> {
  const { signal } = options;
  if (signal?.aborted) return Promise.reject(cancelled());
  element.setAttribute(EXITING_ATTRIBUTE, "");
  if (prefersReducedMotion()) return Promise.resolve();
  const animations = cssAnimations(element);
  if (animations.length === 0) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    function finish(error?: unknown) {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      if (error === undefined) {
        resolve();
      } else {
        clearExit(element);
        reject(error);
      }
    }
    function onAbort() {
      finish(cancelled());
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    // `finished` resolves at the end of the active time (the `animationend` event) and rejects with an AbortError on a cancel.
    Promise.all(animations.map((animation) => animation.finished)).then(
      () => finish(),
      (error: unknown) => finish(error ?? cancelled()),
    );
  });
}
