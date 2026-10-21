// @vitest-environment jsdom
/**
 * Workspace settings store (src/components/workspace-settings/workspace-settings-store.tsx):
 * publish, subscribe and the server snapshot behind `useWeekStart`. The store
 * is module state that cannot be reset, so the cases run in order, each
 * building on the one before: nothing published, then published, then updated.
 */
import { act, createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { publishWorkspaceSettings, useWeekStart, useWorkspaceSettings, WorkspaceSettingsPublisher } from "@/components/workspace-settings/workspace-settings-store";

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const seen: number[] = [];

function WeekProbe({ fromServer }: { fromServer?: number }) {
  const weekStart = useWeekStart(fromServer);
  seen.push(weekStart);
  return createElement("span", { "data-week": weekStart });
}

function SettingsProbe() {
  const settings = useWorkspaceSettings();
  return createElement("output", { "data-name": settings.name, "data-week": settings.week_start });
}

/** The name and week start the settings probe rendered. */
function settingsOf(el: HTMLElement) {
  const out = el.querySelector("output");
  return { name: out?.getAttribute("data-name"), week_start: Number(out?.getAttribute("data-week")) };
}

async function mount(node: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(node);
  });
  return container;
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) {
    const current = root;
    await act(async () => {
      current.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
  seen.length = 0;
});

describe("useWeekStart before anything is published", () => {
  it("answers with the week start the server rendered, in the server HTML", () => {
    expect(renderToString(createElement(WeekProbe, { fromServer: 0 }))).toContain('data-week="0"');
    expect(renderToString(createElement(WeekProbe, { fromServer: 5 }))).toContain('data-week="5"');
  });

  it("falls back to Monday on the server and on the first client render without a server value", async () => {
    expect(renderToString(createElement(WeekProbe))).toContain('data-week="1"');
    const el = await mount(createElement(WeekProbe));
    expect(el.querySelector("span")?.getAttribute("data-week")).toBe("1");
  });

  it("uses the server value on the client too, so first paint does not flip", async () => {
    const el = await mount(createElement(WeekProbe, { fromServer: 0 }));
    expect(el.querySelector("span")?.getAttribute("data-week")).toBe("0");
    expect(seen).toEqual([0]);
  });

  it("treats a server value outside 0 to 6 as Monday", async () => {
    const el = await mount(createElement(WeekProbe, { fromServer: 9 }));
    expect(el.querySelector("span")?.getAttribute("data-week")).toBe("1");
  });
});

describe("publishing", () => {
  it("the layout's publisher fills the store and every subscriber follows", async () => {
    const el = await mount(createElement("div", null, createElement(WeekProbe, { fromServer: 0 }), createElement(SettingsProbe)));
    expect(el.querySelector("span")?.getAttribute("data-week")).toBe("0");
    await act(async () => {
      publishWorkspaceSettings({ name: "Studio", week_start: 3 });
    });
    expect(el.querySelector("span")?.getAttribute("data-week")).toBe("3");
    expect(settingsOf(el)).toEqual({ name: "Studio", week_start: 3 });
  });

  it("once published, the store wins over the server value", async () => {
    const el = await mount(createElement(WeekProbe, { fromServer: 0 }));
    expect(el.querySelector("span")?.getAttribute("data-week")).toBe("3");
  });

  it("a save from the settings screen reaches mounted pickers at once", async () => {
    const el = await mount(createElement(WeekProbe, { fromServer: 0 }));
    await act(async () => {
      publishWorkspaceSettings({ week_start: 6 });
    });
    expect(el.querySelector("span")?.getAttribute("data-week")).toBe("6");
  });

  it("keeps the other field when only one is published", async () => {
    const el = await mount(createElement(SettingsProbe));
    await act(async () => {
      publishWorkspaceSettings({ name: "Renamed" });
    });
    expect(settingsOf(el)).toEqual({ name: "Renamed", week_start: 6 });
  });

  it("does not re-render subscribers when nothing changed", async () => {
    await mount(createElement(WeekProbe));
    const before = seen.length;
    await act(async () => {
      publishWorkspaceSettings({ week_start: 6, name: "Renamed" });
    });
    expect(seen.length).toBe(before);
  });

  it("the publisher component writes its props and renders nothing", async () => {
    const el = await mount(createElement("div", null, createElement(WeekProbe), createElement(WorkspaceSettingsPublisher, { settings: { name: "Renamed", week_start: 2 } })));
    expect(el.querySelector("span")?.getAttribute("data-week")).toBe("2");
    expect(el.children).toHaveLength(1);
  });

  it("stops notifying a subscriber that unmounted", async () => {
    await mount(createElement(WeekProbe));
    const current = root as Root;
    await act(async () => {
      current.unmount();
    });
    root = null;
    seen.length = 0;
    await act(async () => {
      publishWorkspaceSettings({ week_start: 4 });
    });
    expect(seen).toEqual([]);
  });

  it("an invalid published week start reads as Monday", async () => {
    await act(async () => {
      publishWorkspaceSettings({ week_start: 9 });
    });
    const el = await mount(createElement(WeekProbe));
    expect(el.querySelector("span")?.getAttribute("data-week")).toBe("1");
  });

  it("the server snapshot stays the placeholder after publishing, so hydration matches server HTML", () => {
    expect(renderToString(createElement(WeekProbe))).toContain('data-week="1"');
    expect(renderToString(createElement(WeekProbe, { fromServer: 0 }))).toContain('data-week="0"');
  });
});
