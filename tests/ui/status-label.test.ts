// @vitest-environment jsdom
/**
 * StatusLabel (src/components/workspace-settings/StatusLabel.tsx): a status dot
 * with its word beside it, so the exports and webhook delivery tables do not
 * signal a status by colour alone (visual audit, settings lane).
 */
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusLabel } from "@/components/workspace-settings/StatusLabel";

describe("StatusLabel", () => {
  it("renders the visible word and keeps the dot's accessible name", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(createElement(StatusLabel, { variant: "success", label: "Done" }));
    expect(container.textContent).toContain("Done");
    expect(container.querySelector("[role='img'][aria-label='Done']")).not.toBeNull();
  });
});
