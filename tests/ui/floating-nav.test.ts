// @vitest-environment jsdom
/**
 * The floating sidebar's rules (src/components/shell/floating-nav.ts,
 * decision 129): what holds the panel open, where focus goes after each kind
 * of close, the toggle-press flag and its clock, the focusout check, and the
 * open-menu selector, which an expanded favourites folder must not match.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  clearTogglePress,
  closeFocusTarget,
  FLOAT_CLOSE_DELAY_MS,
  FLOAT_OPEN_DELAY_MS,
  floatingStaysOpen,
  isTogglePressPending,
  markTogglePress,
  MENU_OPEN_SELECTOR,
  shouldCloseOnFocusOut,
  TOGGLE_PRESS_MS,
  type CloseReason,
} from "@/components/shell/floating-nav";

const CLOSED = { focusInside: false, menuOpen: false, dragging: false, modalOpen: false };

afterEach(() => {
  clearTogglePress();
  document.body.innerHTML = "";
});

describe("timings", () => {
  it("are the decision's values", () => {
    expect(FLOAT_OPEN_DELAY_MS).toBe(120);
    expect(FLOAT_CLOSE_DELAY_MS).toBe(300);
    expect(TOGGLE_PRESS_MS).toBe(500);
  });
});

describe("floatingStaysOpen", () => {
  it("is false when nothing holds the panel", () => {
    expect(floatingStaysOpen(CLOSED)).toBe(false);
  });

  it.each(["focusInside", "menuOpen", "dragging", "modalOpen"] as const)("is true while %s", (field) => {
    expect(floatingStaysOpen({ ...CLOSED, [field]: true })).toBe(true);
  });
});

describe("closeFocusTarget", () => {
  it.each<[CloseReason, boolean, "toggle" | "main" | "none"]>([
    ["escape", true, "toggle"],
    ["escape", false, "toggle"],
    ["toggle", true, "toggle"],
    ["toggle", false, "toggle"],
    ["shortcut", true, "toggle"],
    ["shortcut", false, "none"],
    ["route", true, "main"],
    ["route", false, "none"],
    ["pointer", true, "none"],
    ["outside", true, "none"],
    ["blur", false, "none"],
  ])("%s with focus inside %s → %s", (reason, focusWasInside, target) => {
    expect(closeFocusTarget(reason, focusWasInside)).toBe(target);
  });
});

describe("the toggle-press flag", () => {
  it("is pending from the mark until 500ms later", () => {
    expect(isTogglePressPending(0)).toBe(false);
    markTogglePress(1000);
    expect(isTogglePressPending(1000)).toBe(true);
    expect(isTogglePressPending(1499)).toBe(true);
    expect(isTogglePressPending(1500)).toBe(false);
  });

  it("is cleared by the toggle's click", () => {
    markTogglePress(0);
    expect(isTogglePressPending(0)).toBe(true);
    clearTogglePress();
    expect(isTogglePressPending(0)).toBe(false);
  });
});

describe("shouldCloseOnFocusOut", () => {
  const none = { focusInside: false, relatedInToggle: false, togglePending: false, staysOpen: false };

  it("closes only when all four inputs are false", () => {
    expect(shouldCloseOnFocusOut(none)).toBe(true);
    for (const field of ["focusInside", "relatedInToggle", "togglePending", "staysOpen"] as const) {
      expect(shouldCloseOnFocusOut({ ...none, [field]: true })).toBe(false);
    }
  });
});

describe("MENU_OPEN_SELECTOR", () => {
  it("does not match an expanded favourites folder (plain aria-expanded)", () => {
    document.body.innerHTML = '<button aria-expanded="true">Launch</button>';
    expect(document.querySelector(MENU_OPEN_SELECTOR)).toBeNull();
  });

  it("matches an open menu trigger and not a closed one or aria-haspopup=false", () => {
    document.body.innerHTML = '<button aria-haspopup="menu" aria-expanded="false">Closed</button><button aria-haspopup="false" aria-expanded="true">No popup</button>';
    expect(document.querySelector(MENU_OPEN_SELECTOR)).toBeNull();
    document.body.innerHTML = '<button aria-haspopup="menu" aria-expanded="true">Open</button>';
    expect(document.querySelector(MENU_OPEN_SELECTOR)?.textContent).toBe("Open");
  });
});
