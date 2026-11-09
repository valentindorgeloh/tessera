// @vitest-environment jsdom
/**
 * The sidebar preferences and the floating open flag live in module stores
 * read with `useSyncExternalStore` (src/components/shell/nav-prefs.ts,
 * decision 130), so a boundary that hydrates after a value changed still
 * hydrates against the server's snapshot (the defaults; closed). The context
 * negative control shows the failure the stores replace (round 6, error 418).
 * Ported from the collapse store's test, which nav-prefs.ts replaced.
 */
import { act, createContext, createElement, useContext } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_NAV_PREFS,
  isRailShown,
  navOpenStore,
  navPrefsStore,
  setNavOpenFlag,
  setNavPrefs,
  useNavOpen,
  useNavPrefs,
} from "@/components/shell/nav-prefs";

const roots: Root[] = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  // Unmount first: a live root still subscribes to the store, and the reset would re-render it outside act.
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  setNavPrefs(DEFAULT_NAV_PREFS);
  setNavOpenFlag(false);
  localStorage.clear();
  document.body.innerHTML = "";
});

function StoreProbe() {
  return createElement("p", null, isRailShown(useNavPrefs()) ? "collapsed" : "expanded");
}

function OpenProbe() {
  return createElement("p", null, useNavOpen() ? "open" : "closed");
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

describe("nav preferences store", () => {
  it("keeps the server snapshot at the defaults after a set", () => {
    setNavPrefs({ display: "rail", rail: "labels", dock: "floating" });
    expect(navPrefsStore.getSnapshot()).toEqual({ display: "rail", rail: "labels", dock: "floating" });
    expect(navPrefsStore.getServerSnapshot()).toBe(DEFAULT_NAV_PREFS);
    setNavOpenFlag(true);
    expect(navOpenStore.getSnapshot()).toBe(true);
    expect(navOpenStore.getServerSnapshot()).toBe(false);
  });

  it("notifies nobody for an unchanged set and once per change", () => {
    const listener = vi.fn();
    const unsubscribe = navPrefsStore.subscribe(listener);
    setNavPrefs({ display: "full" });
    expect(listener).not.toHaveBeenCalled();
    setNavPrefs({ display: "rail" });
    expect(listener).toHaveBeenCalledTimes(1);
    setNavPrefs({ display: "rail" });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setNavPrefs({ display: "full" });
    expect(listener).toHaveBeenCalledTimes(1);

    const openListener = vi.fn();
    const unsubscribeOpen = navOpenStore.subscribe(openListener);
    setNavOpenFlag(false);
    expect(openListener).not.toHaveBeenCalled();
    setNavOpenFlag(true);
    setNavOpenFlag(true);
    expect(openListener).toHaveBeenCalledTimes(1);
    unsubscribeOpen();
  });

  it("hydrates a consumer against the server value after the preferences changed, without a recoverable error", async () => {
    const html = renderToString(createElement(StoreProbe));
    expect(html).toContain("expanded");
    const container = mount(html);
    setNavPrefs({ display: "rail" }); // the `mod+b` that lands before the streamed boundary hydrates
    const onRecoverableError = vi.fn();
    await act(async () => {
      roots.push(hydrateRoot(container, createElement(StoreProbe), { onRecoverableError }));
    });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.textContent).toBe("collapsed");
  });

  it("hydrates a consumer against the server value after the open flag changed", async () => {
    const html = renderToString(createElement(OpenProbe));
    expect(html).toContain("closed");
    const container = mount(html);
    setNavOpenFlag(true); // the floating sidebar opened by `mod+b` before the boundary hydrates
    const onRecoverableError = vi.fn();
    await act(async () => {
      roots.push(hydrateRoot(container, createElement(OpenProbe), { onRecoverableError }));
    });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.textContent).toBe("open");
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
