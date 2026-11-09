/**
 * The floating sidebar's rules (decision 129), pure so Vitest covers every
 * branch (tests/ui/floating-nav.test.ts). `use-floating-nav.ts` wires them to
 * pointer, focus and key events; the top bar's toggle marks its presses here.
 *
 * The toggle-press flag is module state with an explicit clock: a
 * `pointerdown` on `#tessera-nav-toggle` marks it, the toggle's click clears
 * it, and while it is pending the panel's focusout and outside-press closes
 * stand back, so one click on "Hide sidebar" closes the panel once and never
 * re-opens it (Safari, which does not focus a button on click, included).
 */

/** The pointer rests this long on the edge strip before the panel opens. */
export const FLOAT_OPEN_DELAY_MS = 120;
/** The pointer stays away this long before the panel closes. */
export const FLOAT_CLOSE_DELAY_MS = 300;
/** How long a toggle `pointerdown` counts as pending without its click. */
export const TOGGLE_PRESS_MS = 500;

/**
 * An open popup trigger inside the panel (an open menu). An expanded
 * favourites folder carries a plain `aria-expanded="true"` without
 * `aria-haspopup`, so it does not hold the panel open (decision 129).
 */
export const MENU_OPEN_SELECTOR = '[aria-haspopup]:not([aria-haspopup="false"])[aria-expanded="true"]';

/** The live DOM facts that keep the panel open (`liveState()` in use-floating-nav.ts). */
export type FloatState = { focusInside: boolean; menuOpen: boolean; dragging: boolean; modalOpen: boolean };

export function floatingStaysOpen(state: FloatState): boolean {
  return state.focusInside || state.menuOpen || state.dragging || state.modalOpen;
}

export type CloseReason = "escape" | "toggle" | "shortcut" | "pointer" | "outside" | "route" | "blur";

/** Where focus goes after a close (decision 129). */
export function closeFocusTarget(reason: CloseReason, focusWasInside: boolean): "toggle" | "main" | "none" {
  switch (reason) {
    case "escape":
    case "toggle":
      return "toggle";
    case "shortcut":
      return focusWasInside ? "toggle" : "none";
    case "route":
      return focusWasInside ? "main" : "none";
    default:
      return "none";
  }
}

let togglePressAt: number | null = null;

/** The top bar toggle's `onPointerDown`. */
export function markTogglePress(now: number): void {
  togglePressAt = now;
}

/** The top bar toggle's `onClick`, first thing. */
export function clearTogglePress(): void {
  togglePressAt = null;
}

export function isTogglePressPending(now: number): boolean {
  return togglePressAt !== null && now - togglePressAt < TOGGLE_PRESS_MS;
}

/** A focusout closes the panel only when nothing holds it open. */
export function shouldCloseOnFocusOut(input: { focusInside: boolean; relatedInToggle: boolean; togglePending: boolean; staysOpen: boolean }): boolean {
  return !input.focusInside && !input.relatedInToggle && !input.togglePending && !input.staysOpen;
}
