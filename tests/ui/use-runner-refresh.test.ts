// @vitest-environment jsdom
/**
 * `useRunnerRefresh` (src/components/superagent/use-runner-refresh.ts): the screens' reload timer. It asks the
 * server to refresh every interval while not paused and the tab is visible, stops while paused or after unmount, and
 * picks up again when un-paused. Fake timers; the Server Action is a spy.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/app/actions/superagent", () => ({ superagentRefreshAction: refresh }));

const { useRunnerRefresh } = await import("@/components/superagent/use-runner-refresh");

let root: Root;
let host: HTMLElement;

function Probe({ intervalMs, isPaused }: { intervalMs: number; isPaused: boolean }) {
  useRunnerRefresh(intervalMs, isPaused);
  return null;
}

async function render(intervalMs: number, isPaused: boolean) {
  await act(async () => {
    root.render(createElement(Probe, { intervalMs, isPaused }));
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
  setVisibility("visible");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("useRunnerRefresh", () => {
  it("refreshes once per interval while visible and not paused", async () => {
    await render(15_000, false);
    await advance(14_999);
    expect(refresh).not.toHaveBeenCalled();
    await advance(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    await advance(30_000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("skips a tick while the tab is hidden and goes on when it is visible again", async () => {
    await render(1_000, false);
    setVisibility("hidden");
    await advance(3_000);
    expect(refresh).not.toHaveBeenCalled();
    setVisibility("visible");
    await advance(1_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does nothing while paused, and starts a fresh interval when un-paused", async () => {
    await render(1_000, true);
    await advance(5_000);
    expect(refresh).not.toHaveBeenCalled();
    await render(1_000, false);
    await advance(999);
    expect(refresh).not.toHaveBeenCalled();
    await advance(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    await render(1_000, true);
    await advance(5_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("stops after unmount and follows a changed interval", async () => {
    await render(1_000, false);
    await render(4_000, false);
    await advance(3_999);
    expect(refresh).not.toHaveBeenCalled();
    await advance(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    await advance(10_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    root = createRoot(host);
  });
});
