// @vitest-environment jsdom
/**
 * The rule change behind docs/contracts/ui.md "Motion": a style object that an
 * Astryx hook returns (`useEntryAnimation`) goes to an Astryx component's
 * `xstyle` and needs no compiler, no `stylex.create` and no `@stylexjs/*`
 * import in Tessera code. The hook returns null on the server render, on the
 * client render that hydrates server HTML and before the first paint, so
 * nothing moves on load; an element that mounts later gets the style.
 */
import { act, createElement } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { Banner } from "@astryxdesign/core/Banner";
import { useEntryAnimation, type EntryAnimationPreset } from "@astryxdesign/core/hooks";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

/** What the hook returned on each render of `Entering`, in order. */
let returned: unknown[] = [];

function Entering({ preset }: { preset: EntryAnimationPreset }) {
  const entry = useEntryAnimation(preset);
  returned.push(entry);
  return createElement(Banner, { id: "banner", status: "error", title: "Could not save", xstyle: entry ?? undefined });
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const classesOf = (host: HTMLElement) => (host.querySelector("#banner")?.className ?? "").split(/\s+/).filter(Boolean);

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  returned = [];
  vi.restoreAllMocks();
});
function newHost(html = ""): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  hosts.push(host);
  return host;
}

describe("useEntryAnimation through xstyle", () => {
  it("is null on the server render, so the server markup carries no entry style", () => {
    const plain = renderToString(createElement(Banner, { id: "banner", status: "error", title: "Could not save" }));
    expect(renderToString(createElement(Entering, { preset: "slideDown" }))).toBe(plain);
  });

  it("stays null while hydrating server HTML", async () => {
    await nextFrame(); // past the first paint: only hydration keeps it null now
    const html = renderToString(createElement(Entering, { preset: "slideDown" }));
    const host = newHost(html);
    const before = classesOf(host);
    returned = []; // the server render above is not the hydration render
    // React never patches an attribute that differs after a hydration mismatch, it only logs (`console.error` in a
    // development build), so the class list alone cannot fail: the check is the log and what the hook returned.
    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
    const recoverable: unknown[] = [];
    await act(async () => {
      hydrateRoot(host, createElement(Entering, { preset: "slideDown" }), { onRecoverableError: (error) => recoverable.push(error) });
    });
    expect(returned.length).toBeGreaterThan(0); // the hydration render ran through the hook
    expect(returned.every((entry) => entry === null)).toBe(true);
    expect(logged.filter((line) => /hydrated but some attributes|didn't match|did not match|Hydration failed/.test(line))).toEqual([]);
    expect(recoverable).toEqual([]);
    expect(classesOf(host)).toEqual(before);
  });

  it("styles an Astryx component that mounts after the first paint, one preset each", async () => {
    await nextFrame();
    const classes: Record<string, string[]> = {};
    const plainHost = newHost();
    const plainRoot = createRoot(plainHost);
    await act(async () => plainRoot.render(createElement(Banner, { id: "banner", status: "error", title: "Could not save" })));
    const plain = classesOf(plainHost);
    for (const preset of ["slideDown", "slideUp", "fadeIn", "scaleIn"] as const) {
      const host = newHost();
      const root = createRoot(host);
      await act(async () => root.render(createElement(Entering, { preset })));
      classes[preset] = classesOf(host);
      // The preset's classes (animation name, duration, easing, fill) are added to the component's own.
      expect(classes[preset].length, preset).toBeGreaterThan(plain.length);
      for (const name of plain) expect(classes[preset], preset).toContain(name);
    }
    // Each preset is its own animation.
    expect(new Set(Object.values(classes).map((list) => list.join(" "))).size).toBe(4);
  });
});
