// @vitest-environment jsdom
/**
 * How `TesseraShell`/`useShell()` wire the sidebar preferences and the floating
 * open flag (nav-prefs.ts; docs/contracts/ui.md "Shell", streamed-subtree rule). The sidebar sits behind a
 * Suspense boundary that hydrates after the shell is live. Each case streams a
 * boundary from the server, keeps it dehydrated on the client, collapses the nav
 * through the shell (its `mod+b` hotkey, or `useShell().setNavCollapsed` from a
 * consumer outside the boundary, where the top bar's button sits), and only then
 * lets the boundary hydrate: a `useShell()` consumer inside it must hydrate against
 * the server's value (no recoverable error, error 418) and end collapsed (or, while
 * undocked, end with the overlay open after an early `mod+b`). A variant
 * that reads the store in the provider and passes it down through the context value
 * fails here, and so does the pre-fix shape (the negative control). The shell's
 * heavy children are mocked. React's dev build logs "Detected multiple renderers
 * concurrently rendering the same context provider" in every case: the server
 * renderer leaves its mark on the shared context objects, which is harmless here.
 */
import { act, createContext, createElement, Suspense, use, useContext, useState, type ReactElement, type ReactNode } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToPipeableStream } from "react-dom/server";
import { Writable } from "node:stream";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ai/AiStatusProvider", () => ({ AiStatusProvider: ({ children }: { children: unknown }) => children }));
vi.mock("@/components/ai/AssistantPanel", () => ({ AssistantPanel: () => null }));
vi.mock("@/components/ai/AssistantProvider", () => ({
  AssistantProvider: ({ children }: { children: unknown }) => children,
  useAssistant: () => ({ isOpen: false }),
}));
vi.mock("@/components/shell/CommandBar", () => ({ CommandBar: () => null }));
vi.mock("@/components/shell/TopBar", () => ({ TopBar: () => null }));

const { TesseraShell, useShell } = await import("@/components/shell/TesseraShell");
const { DEFAULT_NAV_PREFS, setNavOpenFlag, setNavPrefs } = await import("@/components/shell/nav-prefs");

const roots: Root[] = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia ??= ((query: string) =>
    ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as MediaQueryList);
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

/** Inside the streamed boundary, where the sidebar reads the flag. */
function SideNavProbe() {
  return createElement("p", { id: "flag" }, useShell().isNavCollapsed ? "collapsed" : "expanded");
}

/** Inside the streamed boundary, where the floating sidebar reads its open flag. */
function OpenProbe() {
  return createElement("p", { id: "open" }, useShell().isNavOpen ? "open" : "closed");
}

/** Outside the boundary and live before it hydrates, like the top bar's collapse button. */
function CollapseButton() {
  const { isNavCollapsed, setNavCollapsed: collapse } = useShell();
  return createElement("button", { id: "collapse", type: "button", onClick: () => collapse(true) }, isNavCollapsed ? "collapsed" : "expanded");
}

/** Suspends on `gate` until it resolves; the server gate is already resolved. */
function Gated({ gate, children }: { gate: Promise<void>; children?: ReactNode }) {
  use(gate);
  return children;
}

function shellTree(gate: Promise<void>) {
  const sideNav = createElement(Suspense, { fallback: null }, createElement(Gated, { gate }, createElement(SideNavProbe), createElement(OpenProbe)));
  const props = { sideNav, children: createElement(CollapseButton) };
  return createElement(TesseraShell, props);
}

const PreFixContext = createContext(false);

/** The pre-fix shape: the flag is provider state and travels through the context value. */
function PreFixShell({ sideNav }: { sideNav: ReactNode }) {
  const [isCollapsed, setCollapsed] = useState(false);
  const button = createElement("button", { id: "collapse", type: "button", onClick: () => setCollapsed(true) }, isCollapsed ? "collapsed" : "expanded");
  return createElement(PreFixContext, { value: isCollapsed }, button, sideNav);
}

function PreFixProbe() {
  return createElement("p", { id: "flag" }, useContext(PreFixContext) ? "collapsed" : "expanded");
}

function preFixTree(gate: Promise<void>) {
  const sideNav = createElement(Suspense, { fallback: null }, createElement(Gated, { gate }, createElement(PreFixProbe)));
  return createElement(PreFixShell, { sideNav });
}

function serverHtml(element: ReactElement): Promise<string> {
  return new Promise((resolve, reject) => {
    let html = "";
    const sink = new Writable({
      write(chunk, _encoding, done) {
        html += String(chunk);
        done();
      },
      final(done) {
        resolve(html);
        done();
      },
    });
    const stream = renderToPipeableStream(element, {
      onAllReady: () => stream.pipe(sink),
      onShellError: reject,
    });
  });
}

/**
 * Streams `render(resolved gate)` from the server, then hydrates `render(pending gate)`:
 * everything outside the gated boundary goes live, the boundary stays dehydrated until `open()`.
 */
async function hydrateStreamed(render: (gate: Promise<void>) => ReactElement) {
  const container = document.createElement("div");
  container.innerHTML = await serverHtml(render(Promise.resolve()));
  document.body.append(container);

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const onRecoverableError = vi.fn();
  await act(async () => {
    roots.push(hydrateRoot(container, render(gate), { onRecoverableError }));
  });
  const open = () =>
    act(async () => {
      release();
    });
  return { container, onRecoverableError, open };
}

function textOf(container: HTMLElement, id: string) {
  return container.querySelector(`#${id}`)?.textContent;
}

function click(container: HTMLElement, id: string) {
  container.querySelector(`#${id}`)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

/** `useHotkeys` listens for keydown on window; jsdom's navigator is not Apple, so `mod` is Control. */
function pressModB() {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true, bubbles: true, cancelable: true }));
}

describe("TesseraShell collapse wiring", () => {
  it("hydrates a streamed useShell() consumer against the server value after mod+b", async () => {
    const { container, onRecoverableError, open } = await hydrateStreamed(shellTree);
    const serverFlag = container.querySelector("#flag");
    expect(textOf(container, "collapse")).toBe("expanded");

    // The shell is live, the sidebar boundary is still dehydrated: the user presses mod+b now.
    await act(async () => {
      pressModB();
    });
    expect(textOf(container, "collapse")).toBe("collapsed");
    expect(serverFlag?.textContent).toBe("expanded");

    await open();
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.querySelector("#flag")).toBe(serverFlag); // hydrated in place, not client-rendered
    expect(serverFlag?.textContent).toBe("collapsed");
  });

  it("hydrates a streamed useShell() consumer against the server value after useShell().setNavCollapsed outside it", async () => {
    const { container, onRecoverableError, open } = await hydrateStreamed(shellTree);
    const serverFlag = container.querySelector("#flag");

    // The live consumer outside the boundary collapses the nav before the sidebar hydrates.
    await act(async () => {
      click(container, "collapse");
    });
    expect(textOf(container, "collapse")).toBe("collapsed");
    expect(serverFlag?.textContent).toBe("expanded");

    await open();
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.querySelector("#flag")).toBe(serverFlag);
    expect(serverFlag?.textContent).toBe("collapsed");
  });

  it("hydrates a streamed useShell() consumer against the server value after an early mod+b while undocked", async () => {
    setNavPrefs({ dock: "floating" }); // stored before the page loaded; the server still renders the defaults
    const { container, onRecoverableError, open } = await hydrateStreamed(shellTree);
    const serverOpen = container.querySelector("#open");
    expect(serverOpen?.textContent).toBe("closed");

    await act(async () => {
      pressModB();
    });
    expect(serverOpen?.textContent).toBe("closed");

    await open();
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.querySelector("#open")).toBe(serverOpen);
    expect(serverOpen?.textContent).toBe("open");
    expect(textOf(container, "flag")).toBe("expanded"); // floating always shows the Full view
  });

  it("negative control: provider state passed through the context value fails to hydrate the streamed boundary", async () => {
    const { container, onRecoverableError, open } = await hydrateStreamed(preFixTree);

    await act(async () => {
      click(container, "collapse");
    });
    expect(textOf(container, "collapse")).toBe("collapsed");

    await open();
    expect(onRecoverableError).toHaveBeenCalled();
    expect(String(onRecoverableError.mock.calls[0]?.[0])).toContain("Hydration failed");
    expect(textOf(container, "flag")).toBe("collapsed"); // React client-rendered the boundary instead
  });
});
