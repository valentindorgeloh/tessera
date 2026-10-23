// @vitest-environment jsdom
/**
 * The favourite star (FavoriteButton): a ghost icon button, not a ToggleButton, so a
 * favourite shows a filled star in the warning colour instead of a pressed (held-down)
 * background. The label names the action, so there is no aria-pressed.
 */
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/favorites", () => ({ addFavoriteAction: vi.fn(), removeFavoriteAction: vi.fn() }));
vi.mock("@/components/favorites/store", () => ({ useIsFavorite: () => false }));
vi.mock("@astryxdesign/core/Toast", () => ({ useToast: () => () => undefined }));
const { FavoriteButton } = await import("@/components/shell/FavoriteButton");

function button(isFavorite: boolean): HTMLButtonElement | null {
  const host = document.createElement("div");
  host.innerHTML = renderToString(createElement(FavoriteButton, { entityType: "project", entityId: "p1", isFavorite }));
  return host.querySelector("button");
}

describe("FavoriteButton", () => {
  it("names the action and has no pressed state", () => {
    const off = button(false);
    const on = button(true);
    expect(off?.getAttribute("aria-label")).toBe("Add to favorites");
    expect(on?.getAttribute("aria-label")).toBe("Remove from favorites");
    expect(off?.hasAttribute("aria-pressed")).toBe(false);
    expect(on?.hasAttribute("aria-pressed")).toBe(false);
    expect(on?.getAttribute("data-variant")).toBe("ghost");
    expect(on?.getAttribute("class")).toBe(off?.getAttribute("class"));
  });

  it("swaps the duotone outline star for a filled star with its own colour", () => {
    const off = button(false);
    const on = button(true);
    // The duotone star draws a faint fill path (opacity 0.2) under its outline; the filled star does not.
    expect(off?.querySelector("svg [opacity]")).not.toBeNull();
    expect(on?.querySelector("svg [opacity]")).toBeNull();
    expect(on?.querySelector("svg")?.innerHTML).not.toBe(off?.querySelector("svg")?.innerHTML);
    // Astryx Icon colour (data-color is the documented theming attribute): the theme's warning yellow.
    expect(off?.querySelector("svg")?.getAttribute("data-color")).toBe("inherit");
    expect(on?.querySelector("svg")?.getAttribute("data-color")).toBe("warning");
  });
});
