// @vitest-environment jsdom
/**
 * The shared motion base (src/components/motion/*, src/components/styles/motion.css):
 * - useEnterFlag: false on the server render and on hydration, true when a
 *   surface opens after mount (a mount that is already open is the caller's to
 *   gate: PeekHost and AssistantProvider do), cleared by the surface's own
 *   animationend;
 * - playExit: resolves at once with no animation or under Reduce Motion, at
 *   the end of the running CSS animation otherwise, rejects on a cancel and
 *   removes the attribute so a reveal does not replay the exit;
 * - motion.css: keyframes on tokens, and `animation: none` under Reduce Motion
 *   for every Tessera motion rule.
 * jsdom runs no animations, so the Web Animations API is stubbed where it matters.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { clearExit, EXITING_ATTRIBUTE, ignoreCancelled, isExitCancelled, playExit } from "@/components/motion/play-exit";
import { useEnterFlag, type EnterFlagProps } from "@/components/motion/use-enter-flag";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

type StubAnimation = { animationName?: string; transitionProperty?: string; finished: Promise<unknown> };

/** An element whose `getAnimations` reports `animations`, as a browser does once the exit rule applies. */
function elementRunning(animations: StubAnimation[]): HTMLElement {
  const element = document.createElement("section");
  (element as unknown as { getAnimations: () => StubAnimation[] }).getAnimations = () => animations;
  return element;
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = () => res(undefined);
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets promise callbacks run. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("playExit", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("marks the element exiting and resolves at once when it runs no animation", async () => {
    const element = document.createElement("section"); // jsdom has no getAnimations: nothing to wait for
    await expect(playExit(element)).resolves.toBeUndefined();
    expect(element.hasAttribute(EXITING_ATTRIBUTE)).toBe(true);
    const idle = elementRunning([]);
    await expect(playExit(idle)).resolves.toBeUndefined();
  });

  it("ignores transitions: only CSS animations hold the exit", async () => {
    const element = elementRunning([{ transitionProperty: "opacity", finished: new Promise(() => {}) }]);
    await expect(playExit(element)).resolves.toBeUndefined();
  });

  it("resolves at once under Reduce Motion, even if an animation is reported", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)" }));
    const element = elementRunning([{ animationName: "tessera-slide-out-end", finished: new Promise(() => {}) }]);
    await expect(playExit(element)).resolves.toBeUndefined();
  });

  it("waits for every running animation to finish, then keeps the attribute", async () => {
    const first = deferred();
    const second = deferred();
    const element = elementRunning([
      { animationName: "tessera-slide-out-end", finished: first.promise },
      { animationName: "tessera-fade-out", finished: second.promise },
    ]);
    let settled = false;
    void playExit(element).then(() => {
      settled = true;
    });
    first.resolve();
    await flush();
    expect(settled).toBe(false);
    second.resolve();
    await flush();
    expect(settled).toBe(true);
    expect(element.hasAttribute(EXITING_ATTRIBUTE)).toBe(true); // the forwards fill holds the surface out until it unmounts
    clearExit(element);
    expect(element.hasAttribute(EXITING_ATTRIBUTE)).toBe(false);
  });

  it("rejects when the animation is cancelled, and takes the attribute back", async () => {
    const running = deferred();
    const element = elementRunning([{ animationName: "tessera-slide-out-end", finished: running.promise }]);
    const result = playExit(element);
    expect(element.hasAttribute(EXITING_ATTRIBUTE)).toBe(true);
    running.reject(new DOMException("cancelled", "AbortError")); // Activity hid the route, or the element unmounted
    const error = await result.then(
      () => null,
      (e: unknown) => e,
    );
    expect(isExitCancelled(error)).toBe(true);
    expect(element.hasAttribute(EXITING_ATTRIBUTE)).toBe(false);
    expect(() => ignoreCancelled(error)).not.toThrow();
    expect(() => ignoreCancelled(new Error("real"))).toThrow("real");
  });

  it("rejects when the caller aborts (a toggle during the exit), and takes the attribute back", async () => {
    const element = elementRunning([{ animationName: "tessera-slide-out-end", finished: new Promise(() => {}) }]);
    const controller = new AbortController();
    const result = playExit(element, { signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toSatisfy(isExitCancelled);
    expect(element.hasAttribute(EXITING_ATTRIBUTE)).toBe(false);
  });

  it("rejects without touching the element when the signal is already aborted", async () => {
    const element = elementRunning([]);
    await expect(playExit(element, { signal: AbortSignal.abort() })).rejects.toSatisfy(isExitCancelled);
    expect(element.hasAttribute(EXITING_ATTRIBUTE)).toBe(false);
  });

  it("does not treat an unrelated rejection as a cancel", async () => {
    const running = deferred();
    const element = elementRunning([{ animationName: "tessera-fade-out", finished: running.promise }]);
    const result = playExit(element);
    running.reject(new Error("boom"));
    const error = await result.then(
      () => null,
      (e: unknown) => e,
    );
    expect(isExitCancelled(error)).toBe(false);
  });
});

describe("useEnterFlag", () => {
  let root: Root | null = null;
  let host: HTMLElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host?.remove();
    host = null;
    returned = [];
    vi.restoreAllMocks();
  });

  /** What the hook returned on each render of the surface, in order (the hydration render included). */
  let returned: EnterFlagProps[] = [];

  function Surface({ open }: { open: boolean }) {
    const enter = useEnterFlag(open);
    returned.push(enter);
    return createElement("section", { id: "surface", ...enter }, createElement("span", { id: "child" }));
  }
  const surface = () => host!.querySelector<HTMLElement>("#surface")!;

  function mountClient(open: boolean) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root!.render(createElement(Surface, { open })));
  }

  function rerender(open: boolean) {
    act(() => root!.render(createElement(Surface, { open })));
  }

  // jsdom's style declaration has no `animation` property, so React listens for the prefixed event name there; a browser fires `animationend`.
  const animationEnd = (target: Element) =>
    act(() => {
      for (const type of ["animationend", "webkitAnimationEnd"]) target.dispatchEvent(new Event(type, { bubbles: true }));
    });

  const HYDRATION_MISMATCH = /hydrated but some attributes|didn't match|did not match|Hydration failed/;

  /**
   * Hydrates the server markup of a surface and reports what React said about it. React never patches an attribute
   * that differs after a hydration mismatch, it only logs, so the DOM alone cannot show one: the check is the log
   * (`console.error` in development builds) plus what the hook returned on every render.
   */
  function hydrate(open: boolean) {
    const html = renderToString(createElement(Surface, { open }));
    returned = []; // the server render above is not the hydration render
    host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    const recoverable: unknown[] = [];
    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
    act(() => {
      root = hydrateRoot(host!, createElement(Surface, { open }), { onRecoverableError: (error) => recoverable.push(error) });
    });
    return { html, recoverable, mismatches: logged.filter((line) => HYDRATION_MISMATCH.test(line)) };
  }

  it("is absent in the server markup and returns nothing while hydrating a surface the server rendered open (a ?peek= deep link)", () => {
    const { html, recoverable, mismatches } = hydrate(true);
    expect(html).not.toContain("data-enter");
    expect(returned.length).toBeGreaterThan(0); // the hydration render ran through the hook
    for (const props of returned) expect(props).not.toHaveProperty("data-enter");
    expect(mismatches).toEqual([]);
    expect(recoverable).toEqual([]);
    expect(surface().hasAttribute("data-enter")).toBe(false);
  });

  it("enters when the open happens after hydration", () => {
    const { mismatches } = hydrate(false);
    expect(mismatches).toEqual([]);
    expect(surface().hasAttribute("data-enter")).toBe(false);
    rerender(true);
    expect(surface().getAttribute("data-enter")).toBe("");
  });

  // The helper cannot tell a mount that is open from a toggle: it enters. A caller that must not slide for a mount that is
  // already open (PeekHost: `hasBeenClosed`; AssistantProvider: the snapshot's `enters`) passes `open` false for it.
  it("enters for a client mount with open true, so a caller that must not slide gates the flag itself", () => {
    mountClient(true);
    expect(surface().getAttribute("data-enter")).toBe("");
  });

  it("does not enter for a mount that is closed, and a close clears it", () => {
    mountClient(false);
    expect(surface().hasAttribute("data-enter")).toBe(false);
    rerender(true);
    expect(surface().hasAttribute("data-enter")).toBe(true);
    rerender(false);
    expect(surface().hasAttribute("data-enter")).toBe(false);
  });

  it("is cleared by the surface's own animationend, not by a child's", () => {
    mountClient(true);
    animationEnd(host!.querySelector("#child")!);
    expect(surface().hasAttribute("data-enter")).toBe(true);
    animationEnd(surface());
    expect(surface().hasAttribute("data-enter")).toBe(false);
  });

  it("enters again on the next open", () => {
    mountClient(true);
    animationEnd(surface());
    expect(surface().hasAttribute("data-enter")).toBe(false);
    rerender(false);
    rerender(true);
    expect(surface().hasAttribute("data-enter")).toBe(true);
  });
});

describe("motion.css", () => {
  const css = readFileSync(path.join(process.cwd(), "src/components/styles/motion.css"), "utf8");
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const reduceAt = code.indexOf("@media (prefers-reduced-motion: reduce)");
  const outside = code.slice(0, reduceAt);
  const reduced = code.slice(reduceAt);

  it("defines the shared keyframes", () => {
    for (const name of ["tessera-fade-in", "tessera-fade-out", "tessera-slide-in-end", "tessera-slide-out-end", "tessera-rise"]) {
      expect(outside, name).toContain(`@keyframes ${name} {`);
    }
  });

  it("runs on tokens: 225 ms in, the exit token out, a fast fade, no raw lengths or colours", () => {
    expect(outside).toMatch(/\[data-enter\][^}]*animation: tessera-slide-in-end var\(--duration-medium-min\) var\(--ease-entrance\) backwards/);
    expect(outside).toMatch(/\[data-exiting\][^}]*animation: tessera-slide-out-end var\(--duration-exit\) var\(--ease-exit\) forwards/);
    expect(outside).toMatch(/tessera-fade-in var\(--duration-fast-max\) var\(--ease-entrance\)/);
    expect(outside).toMatch(/tessera-fade-out var\(--duration-exit\) var\(--ease-exit\)/);
    expect(code).not.toMatch(/\d+(\.\d+)?(px|ms|s)\b/);
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/\bbounce|cubic-bezier|spring/);
  });

  it("is animation: none for every Tessera motion rule under Reduce Motion", () => {
    // Every selector that sets an animation outside the media block is listed in it, with the same selector.
    const animated = [...outside.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((rule) => /\banimation:/.test(rule[2]))
      .map((rule) => rule[1].trim());
    expect(animated.length).toBeGreaterThan(0);
    const body = reduced.slice(reduced.indexOf("{") + 1);
    const listed = body.slice(0, body.indexOf("{")).split(",").map((selector) => selector.trim());
    expect(listed.sort()).toEqual([...animated].sort());
    expect(body).toMatch(/animation: none;/);
  });

  it("is imported once, from globals.css", () => {
    const globals = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(globals.match(/styles\/motion\.css/g)).toHaveLength(1);
  });
});
