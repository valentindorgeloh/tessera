/**
 * Side peek motion rules (src/components/detail/peek-motion.ts, decisions 132
 * and 133): every input combination of the open and close predicates, the
 * close outcome for finished or cancelled slides against the same or a
 * changed URL, and the slide offset.
 */
import { describe, expect, it } from "vitest";
import { closeOutcome, peekCloseAnimates, peekOpenAnimates, slideOffset } from "@/components/detail/peek-motion";

const bools = [false, true] as const;

describe("peekOpenAnimates", () => {
  it("is true only for a side peek that just opened, in the same mode, with motion allowed", () => {
    for (const wasOpen of bools)
      for (const isOpen of bools)
        for (const isModal of bools)
          for (const modeChanged of bools)
            for (const reduced of bools) {
              const expected = !wasOpen && isOpen && !isModal && !modeChanged && !reduced;
              expect(peekOpenAnimates({ wasOpen, isOpen, isModal, modeChanged, reduced }), JSON.stringify({ wasOpen, isOpen, isModal, modeChanged, reduced })).toBe(expected);
            }
  });

  it("never animates the first render, an item switch, a close or a mode switch", () => {
    // A reload or deep link: wasOpen starts as the first render's isOpen.
    expect(peekOpenAnimates({ wasOpen: true, isOpen: true, isModal: false, modeChanged: false, reduced: false })).toBe(false);
    expect(peekOpenAnimates({ wasOpen: true, isOpen: false, isModal: false, modeChanged: false, reduced: false })).toBe(false);
    expect(peekOpenAnimates({ wasOpen: false, isOpen: true, isModal: false, modeChanged: true, reduced: false })).toBe(false);
    expect(peekOpenAnimates({ wasOpen: false, isOpen: true, isModal: true, modeChanged: false, reduced: false })).toBe(false);
    expect(peekOpenAnimates({ wasOpen: false, isOpen: true, isModal: false, modeChanged: false, reduced: true })).toBe(false);
    expect(peekOpenAnimates({ wasOpen: false, isOpen: true, isModal: false, modeChanged: false, reduced: false })).toBe(true);
  });
});

describe("peekCloseAnimates", () => {
  it("is true only for a visible side card with motion allowed", () => {
    for (const isModal of bools)
      for (const reduced of bools)
        for (const isHidden of bools) {
          expect(peekCloseAnimates({ isModal, reduced, isHidden }), JSON.stringify({ isModal, reduced, isHidden })).toBe(!isModal && !reduced && !isHidden);
        }
  });

  it("closes at once in the modal, under reduced motion and on a hidden route", () => {
    expect(peekCloseAnimates({ isModal: true, reduced: false, isHidden: false })).toBe(false);
    expect(peekCloseAnimates({ isModal: false, reduced: true, isHidden: false })).toBe(false);
    expect(peekCloseAnimates({ isModal: false, reduced: false, isHidden: true })).toBe(false);
    expect(peekCloseAnimates({ isModal: false, reduced: false, isHidden: false })).toBe(true);
  });
});

describe("closeOutcome", () => {
  const list = "/projects/p1/work-items?peek=a";
  it("navigates only when the slide finished on the URL it closed", () => {
    expect(closeOutcome({ ended: "finished", hrefAtClose: list, hrefNow: list })).toBe("navigate");
    expect(closeOutcome({ ended: "finished", hrefAtClose: list, hrefNow: "/projects/p1/work-items?peek=b" })).toBe("stay");
    expect(closeOutcome({ ended: "cancel", hrefAtClose: list, hrefNow: list })).toBe("stay");
    expect(closeOutcome({ ended: "cancel", hrefAtClose: list, hrefNow: "/projects/p1/cycles" })).toBe("stay");
  });
});

describe("slideOffset", () => {
  it("adds the panel padding in whole px, never negative", () => {
    expect(slideOffset(0)).toBe("translateX(calc(100% + 0px))");
    expect(slideOffset(4)).toBe("translateX(calc(100% + 4px))");
    expect(slideOffset(4.4)).toBe("translateX(calc(100% + 4px))");
    expect(slideOffset(-1)).toBe("translateX(calc(100% + 0px))");
  });
});
