/**
 * Side peek motion rules (decisions 132 and 133): when the peek card slides
 * in or out, what a finished close slide does, and the slide's start offset.
 * Pure; PeekHost.tsx runs the WAAPI animations (src/components/shell/layout-motion.ts).
 *
 * Only the card moves: the panel takes its final width at once, so the list
 * re-lays out once, and the card slides from just outside the panel's
 * padding. Nothing animates on the first render (a reload or deep link), a
 * mode switch (side ↔ modal), under reduced motion, or on a hidden route.
 */

export type PeekOpenInput = { wasOpen: boolean; isOpen: boolean; isModal: boolean; modeChanged: boolean; reduced: boolean };

/** A side peek that just opened, in the same mode, with motion allowed. */
export function peekOpenAnimates({ wasOpen, isOpen, isModal, modeChanged, reduced }: PeekOpenInput): boolean {
  return !wasOpen && isOpen && !isModal && !modeChanged && !reduced;
}

export type PeekCloseInput = { isModal: boolean; reduced: boolean; isHidden: boolean };

/** A side peek whose card is on screen, with motion allowed; otherwise the close navigates at once. */
export function peekCloseAnimates({ isModal, reduced, isHidden }: PeekCloseInput): boolean {
  return !isModal && !reduced && !isHidden;
}

export type CloseOutcomeInput = { ended: "finished" | "cancel"; hrefAtClose: string; hrefNow: string };

/** A close slide navigates only when it finished and the URL is still the one it closed. */
export function closeOutcome({ ended, hrefAtClose, hrefNow }: CloseOutcomeInput): "navigate" | "stay" {
  return ended === "finished" && hrefNow === hrefAtClose ? "navigate" : "stay";
}

/** The card's off-panel position: its own width plus the panel's end padding (whole px, never negative). */
export function slideOffset(padPx: number): string {
  return `translateX(calc(100% + ${Math.max(0, Math.round(padPx))}px))`;
}
