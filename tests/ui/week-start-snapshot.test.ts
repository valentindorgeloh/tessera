// @vitest-environment jsdom
/**
 * `useWeekStart` subscribes with a number (decision 142). The workspace publisher's first write replaces
 * the store object even when the weekday is the one the page already rendered; with the object as snapshot
 * that re-rendered every date control right after hydration. With the number, a publish that changes
 * nothing re-renders nobody. Each case loads a fresh store (it is module state).
 */
import { act, createElement } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Store = typeof import("@/components/workspace-settings/workspace-settings-store");

let store: Store;
let renders: number[] = [];
let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(async () => {
  vi.resetModules();
  store = await import("@/components/workspace-settings/workspace-settings-store");
  renders = [];
});

afterEach(async () => {
  const current = root;
  if (current) await act(async () => current.unmount());
  container?.remove();
  root = null;
  container = null;
});

/** A subscriber that records every render's value. */
function Counter({ fromServer }: { fromServer?: number }) {
  renders.push(store.useWeekStart(fromServer));
  return null;
}

async function mount(fromServer?: number) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(Counter, { fromServer }));
  });
}

describe("useWeekStart", () => {
  it("does not re-render on a first publish that keeps the week start the page rendered", async () => {
    await mount(3);
    expect(renders).toEqual([3]);
    await act(async () => store.publishWorkspaceSettings({ name: "Tessera", week_start: 3 }));
    expect(renders).toEqual([3]);
  });

  it("does not re-render when only the workspace name changes later", async () => {
    await mount(3);
    await act(async () => store.publishWorkspaceSettings({ name: "Tessera", week_start: 3 }));
    await act(async () => store.publishWorkspaceSettings({ name: "Renamed" }));
    expect(renders).toEqual([3]);
  });

  it("re-renders with the new value when the week start changes, and the store wins over the server value after the first publish", async () => {
    await mount(3);
    await act(async () => store.publishWorkspaceSettings({ week_start: 5 }));
    expect(renders).toEqual([3, 5]);
    await act(async () => store.publishWorkspaceSettings({ week_start: 0 }));
    expect(renders).toEqual([3, 5, 0]);
  });

  it("answers the server value before anything is published, and Monday without one", async () => {
    await mount(4);
    expect(renders).toEqual([4]);
    await act(async () => root?.unmount());
    root = null;
    container?.remove();
    renders = [];
    await mount(undefined);
    expect(renders).toEqual([1]);
  });

  it("renders the same value on the server and on the hydrating client, then follows a publish that changes it", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = renderToString(createElement(Counter, { fromServer: 6 }));
    expect(renders).toEqual([6]);
    await act(async () => {
      root = hydrateRoot(container as HTMLDivElement, createElement(Counter, { fromServer: 6 }));
    });
    expect(renders).toEqual([6, 6]);
    await act(async () => store.publishWorkspaceSettings({ name: "Tessera", week_start: 6 }));
    expect(renders).toEqual([6, 6]);
    await act(async () => store.publishWorkspaceSettings({ week_start: 2 }));
    expect(renders).toEqual([6, 6, 2]);
  });

  it("useWorkspaceSettings still follows a name change (the object snapshot is unchanged)", async () => {
    const names: string[] = [];
    function NameCounter() {
      names.push(store.useWorkspaceSettings().name);
      return null;
    }
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(createElement(NameCounter)));
    await act(async () => store.publishWorkspaceSettings({ name: "Renamed", week_start: 1 }));
    expect(names).toEqual(["Tessera", "Renamed"]);
  });
});
