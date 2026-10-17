// @vitest-environment jsdom
/**
 * Panel headers (src/components/shell/PanelHeader.tsx, docs/contracts/ui.md
 * "Shell", "Panel headers"): server-rendered markup of the header,
 * the bar sizes and their classes, the title's heading level and the two
 * page widths. No client state is involved, so `renderToString` is enough.
 */
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PanelBar, PanelHeader, PanelPage, PanelTitle } from "@/components/shell/PanelHeader";

/**
 * `createElement` for a component whose props require `children`, with the
 * children passed as arguments (the lint rule forbids them as a prop).
 */
function withChildren<P extends { children: ReactNode }>(type: FunctionComponent<P>, props: Omit<P, "children">, ...children: ReactNode[]): ReactElement {
  return createElement(type as FunctionComponent<Omit<P, "children">>, props, ...children);
}

function render(node: ReactElement): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = renderToString(node);
  return container;
}

function bar(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>(".tessera-panel-bar");
  if (!element) throw new Error("no panel bar");
  return element;
}

describe("PanelHeader", () => {
  it("is one labelled layout header with a hairline, holding the bars in order", () => {
    const container = render(
      withChildren(
        PanelHeader,
        { label: "Work items" },
        createElement(PanelBar, { size: "subheader", start: "Work items" }),
        createElement(PanelBar, { size: "filters", start: "Filters", hasDivider: true }),
      ),
    );
    const headers = container.querySelectorAll(".astryx-layout-header");
    expect(headers).toHaveLength(1);
    expect(headers[0].getAttribute("aria-label")).toBe("Work items");
    expect(headers[0].getAttribute("data-divider")).toBe("true");
    const bars = [...headers[0].querySelectorAll<HTMLElement>(".tessera-panel-bar")];
    expect(bars.map((element) => element.classList.contains("tessera-panel-bar--subheader"))).toEqual([true, false]);
    expect(bars.map((element) => element.classList.contains("tessera-panel-bar--filters"))).toEqual([false, true]);
  });
});

describe("PanelBar", () => {
  it.each([
    ["header", "tessera-panel-bar--header"],
    ["subheader", "tessera-panel-bar--subheader"],
    ["filters", "tessera-panel-bar--filters"],
  ] as const)("gives the %s size its class", (size, className) => {
    const element = bar(render(createElement(PanelBar, { size, start: "Title" })));
    expect(element.classList.contains(className)).toBe(true);
    expect(element.classList.contains("tessera-panel-bar--divided")).toBe(false);
  });

  it("defaults to the 52px header row", () => {
    expect(bar(render(createElement(PanelBar, { start: "Title" }))).classList.contains("tessera-panel-bar--header")).toBe(true);
  });

  it("draws the hairline above a later row only when asked", () => {
    const element = bar(render(createElement(PanelBar, { size: "filters", start: "Filters", hasDivider: true })));
    expect(element.classList.contains("tessera-panel-bar--divided")).toBe(true);
  });

  it("keeps an extra class next to its own", () => {
    const element = bar(render(createElement(PanelBar, { size: "subheader", start: "WEB-1", className: "tessera-detail-header" })));
    expect(element.classList.contains("tessera-panel-bar--subheader")).toBe(true);
    expect(element.classList.contains("tessera-detail-header")).toBe(true);
  });

  it("puts start and end in their own groups and leaves out an empty end", () => {
    const withEnd = bar(render(createElement(PanelBar, { start: "Title", end: "Actions" })));
    expect(withEnd.querySelector(".tessera-panel-bar-start")?.textContent).toBe("Title");
    expect(withEnd.querySelector(".tessera-panel-bar-end")?.textContent).toBe("Actions");
    const withoutEnd = bar(render(createElement(PanelBar, { start: "Title" })));
    expect(withoutEnd.querySelector(".tessera-panel-bar-end")).toBeNull();
  });
});

describe("PanelTitle", () => {
  it("is the page's level 1 heading at the working size", () => {
    const container = render(withChildren(PanelTitle, {}, "Projects"));
    const heading = container.querySelector("h1, h2, h3, h4, h5, h6, [role='heading']");
    expect(heading?.textContent).toBe("Projects");
    expect(heading?.tagName === "H1" || heading?.getAttribute("aria-level") === "1").toBe(true);
  });
});

describe("PanelPage", () => {
  const header = withChildren(PanelHeader, { label: "Home" }, createElement(PanelBar, { start: withChildren(PanelTitle, {}, "Home") }));

  it("centres the content in the reading column when asked", () => {
    const container = render(withChildren(PanelPage, { header, width: "reading" }, "Body"));
    expect(container.querySelector(".tessera-reading")?.textContent).toBe("Body");
    expect(container.querySelector(".astryx-layout-header")?.getAttribute("aria-label")).toBe("Home");
  });

  it("gives full-width content the panel's width", () => {
    const container = render(withChildren(PanelPage, { header }, "Body"));
    expect(container.querySelector(".tessera-reading")).toBeNull();
    expect(container.textContent).toContain("Body");
  });
});
