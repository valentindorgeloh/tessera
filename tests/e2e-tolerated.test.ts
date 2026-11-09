import { describe, expect, it } from "vitest";
import { isTolerated } from "./e2e/tolerated";

/** The e2e console filter (decision 123) tolerates only the field-guide list. Not under tests/e2e: Playwright would pick up a .test.ts there. */
describe("e2e tolerated console list", () => {
  it("no longer tolerates the ContextMenu long-press prop warnings (fixed in Astryx 0.7.0)", () => {
    // Astryx 0.6.8 spread useLongPress's start/moveTo/cancel onto the ContextMenu trigger; 0.7.x passes only the touch handlers.
    expect(isTolerated("React does not recognize the `%s` prop on a DOM element. If you intentionally want it to appear in the DOM as a custom attribute, spell it as lowercase `%s` instead. moveTo moveto")).toBe(false);
    expect(isTolerated("Invalid value for prop `%s` on <%s> tag. Either remove it from the element, or pass a string or number value to keep it in the DOM. start div")).toBe(false);
    expect(isTolerated("Received `%s` for a non-boolean attribute `%s`. true cancel")).toBe(false);
  });

  it("tolerates the prerender measure warning and the nameless form field note", () => {
    expect(isTolerated("Failed to execute 'measure' on 'Performance': 'x' cannot have a negative time stamp.")).toBe(true);
    expect(isTolerated("A form field element should have an id or name attribute (count: 1)")).toBe(true);
  });

  it("does not tolerate crashes or errors that only mention start or cancel", () => {
    for (const text of [
      "pageerror: Cannot read properties of undefined (reading 'start')",
      "TypeError: range.start is undefined",
      "Error: Failed to start the transition",
      "pageerror: Cannot read properties of null (reading 'cancel')",
      "Uncaught Error: cancel handler threw",
      "React does not recognize the `%s` prop on a DOM element. somethingElse else",
    ]) {
      expect(isTolerated(text), text).toBe(false);
    }
  });

  it("no longer tolerates failed resource loads", () => {
    expect(isTolerated("Failed to load resource: the server responded with a status of 404 (Not Found)")).toBe(false);
    expect(isTolerated("Failed to load resource: the server responded with a status of 403 (Forbidden)")).toBe(false);
  });
});
