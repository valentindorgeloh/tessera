// @vitest-environment jsdom
/**
 * The sidebar collapse flag lives in a module store read with
 * `useSyncExternalStore` (src/components/shell/nav-collapse-store.ts), so a
 * boundary that hydrates after the flag changed still hydrates against the
 * server's value. The context negative control shows the failure it replaces.
 */
import { act, createContext, createElement, useContext } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  getNavCollapsed,
  getServerNavCollapsed,
  setNavCollapsed,
  subscribe,
  toggleNavCollapsed,
  useNavCollapsed,
} from "@/components/shell/nav-collapse-store";

const roots: Root[] = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  // Unmount first: a live root still subscribes to the store, and the reset would re-render it outside act.
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  setNavCollapsed(false);
  document.body.innerHTML = "";
});

function StoreProbe() {
  return createElement("p", null, useNavCollapsed() ? "collapsed" : "expanded");
}

const FlagContext = createContext(false);

function ContextProbe() {
  return createElement("p", null, useContext(FlagContext) ? "collapsed" : "expanded");
}

function mount(html: string) {
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.append(container);
  return container;
}

describe("nav collapse store", () => {
  it("keeps the server snapshot false after set(true)", () => {
    setNavCollapsed(true);
    expect(getNavCollapsed()).toBe(true);
    expect(getServerNavCollapsed()).toBe(false);
  });

  it("notifies nobody for an unchanged set and once per toggle", () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    setNavCollapsed(false);
    expect(listener).not.toHaveBeenCalled();
    toggleNavCollapsed();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getNavCollapsed()).toBe(true);
    setNavCollapsed(true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    toggleNavCollapsed();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("hydrates a consumer against the server value after the flag changed, without a recoverable error", async () => {
    const html = renderToString(createElement(StoreProbe));
    expect(html).toContain("expanded");
    const container = mount(html);
    setNavCollapsed(true); // the toggle that lands before the streamed boundary hydrates
    const onRecoverableError = vi.fn();
    await act(async () => {
      roots.push(hydrateRoot(container, createElement(StoreProbe), { onRecoverableError }));
    });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.textContent).toBe("collapsed");
  });

  it("negative control: a context value that differs at hydration is a recoverable error", async () => {
    const html = renderToString(createElement(FlagContext.Provider, { value: false }, createElement(ContextProbe)));
    const container = mount(html);
    const onRecoverableError = vi.fn();
    await act(async () => {
      roots.push(hydrateRoot(container, createElement(FlagContext.Provider, { value: true }, createElement(ContextProbe)), { onRecoverableError }));
    });
    expect(onRecoverableError).toHaveBeenCalled();
  });
});
