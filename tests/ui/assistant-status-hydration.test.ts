// @vitest-environment jsdom
/**
 * The assistant's status in a streamed page (docs/contracts/ui.md "Shell", streamed-subtree rule;
 * decision 155). The page area streams behind the frame's Suspense boundary, which is the shell's
 * children as they came from the server: when the AI status lands, `AssistantProvider` re-renders with
 * a new value, but React's early bailout for a still-dehydrated boundary whose element did not change
 * skips the context propagation, so the boundary is never told. It hydrates later, and a consumer that
 * took `status` from the provider's value hydrated "available" against server HTML rendered with none
 * (error 418: the intake's Triage button, the views page's Describe dialog). `useAssistant()` and
 * `useAssistantController()` now read `status` through `useAiStatus`, a store read with a null server
 * snapshot. Each case streams the boundary from the server, keeps it dehydrated on the client, lets the
 * status land, then lets the boundary hydrate. The negative control carries the status through a context
 * value in the same arrangement and fails, so the cases do reach the gap.
 */
import { act, createContext, createElement, Suspense, use, useContext, type ReactElement, type ReactNode } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToPipeableStream } from "react-dom/server";
import { Writable } from "node:stream";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/actions/ai", () => ({ applyProposalsAction: vi.fn(), discardProposalsAction: vi.fn() }));
vi.mock("@/components/ai/use-assistant-stream", () => ({ streamAssist: vi.fn() }));
vi.mock("@astryxdesign/core/Toast", async (importOriginal) => ({ ...(await importOriginal<typeof import("@astryxdesign/core/Toast")>()), useToast: () => vi.fn() }));

const { AiStatusProvider, useAiStatus } = await import("@/components/ai/AiStatusProvider");
const { AssistantProvider, useAssistant, useAssistantController } = await import("@/components/ai/AssistantProvider");

const roots: Root[] = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  window.localStorage.clear();
  window.sessionStorage.clear();
});

/** `GET /api/ai/status` answers "available" once `land()` is called; the server render never fetches. */
function stubStatus() {
  let land!: () => void;
  const answered = new Promise<void>((resolve) => {
    land = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      await answered;
      return new Response(JSON.stringify({ available: true, model: "fake" }), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  return land;
}

/** Suspends on `gate` until it resolves; the server gate is already resolved. */
function Gated({ gate, children }: { gate: Promise<void>; children?: ReactNode }) {
  use(gate);
  return children;
}

const text = (available: boolean | undefined) => (available === true ? "available" : "none");

/** Outside the boundary and live before it hydrates, like the top bar's Assistant button. */
function LiveProbe() {
  return createElement("p", { id: "live" }, text(useAssistant().status?.available));
}

/** The same for the negative control, which has no AssistantProvider. */
function LiveStatusProbe() {
  return createElement("p", { id: "live" }, text(useAiStatus().status?.available));
}

function AssistantProbe() {
  return createElement("p", { id: "probe" }, text(useAssistant().status?.available));
}

function ControllerProbe() {
  return createElement("p", { id: "probe" }, text(useAssistantController().status?.available));
}

/** The shell's shape: the providers, a live consumer, and the page area as one streamed boundary passed in as children. */
function shellTree(probe: () => ReactElement) {
  return function render(gate: Promise<void>) {
    return createElement(
      AiStatusProvider,
      null,
      createElement(AssistantProvider, null, createElement(LiveProbe), createElement(Suspense, { fallback: null }, createElement(Gated, { gate }, probe()))),
    );
  };
}

const EchoContext = createContext<boolean | undefined>(undefined);

/** The pre-fix shape: the status read once above the boundary and handed down in a context value. */
function Echo({ children }: { children: ReactNode }) {
  return createElement(EchoContext, { value: useAiStatus().status?.available }, children);
}

function EchoProbe() {
  return createElement("p", { id: "probe" }, text(useContext(EchoContext)));
}

function echoTree(gate: Promise<void>) {
  return createElement(
    AiStatusProvider,
    null,
    createElement(Echo, null, createElement(LiveStatusProbe), createElement(Suspense, { fallback: null }, createElement(Gated, { gate }, createElement(EchoProbe)))),
  );
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

/** Streams the tree with the gate open, hydrates it with the gate shut, lands the status, then opens the gate. */
async function hydrateAfterStatus(render: (gate: Promise<void>) => ReactElement) {
  const land = stubStatus();
  const container = document.createElement("div");
  container.innerHTML = await serverHtml(render(Promise.resolve()));
  document.body.append(container);
  const serverProbe = container.querySelector("#probe");
  expect(serverProbe?.textContent).toBe("none");

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const onRecoverableError = vi.fn();
  await act(async () => {
    roots.push(hydrateRoot(container, render(gate), { onRecoverableError }));
  });
  // The status lands while the page area is still dehydrated: the live consumer outside it shows it.
  await act(async () => {
    land();
  });
  expect(container.querySelector("#live")?.textContent).toBe("available");
  expect(serverProbe?.textContent).toBe("none");

  await act(async () => {
    release();
  });
  return { container, serverProbe, onRecoverableError };
}

describe("assistant status in a streamed page", () => {
  it.each([
    ["useAssistant()", AssistantProbe],
    ["useAssistantController()", ControllerProbe],
  ])("a %s consumer hydrates against the server's status, then shows the landed one", async (_name, probe) => {
    const { container, serverProbe, onRecoverableError } = await hydrateAfterStatus(shellTree(() => createElement(probe)));
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.querySelector("#probe")).toBe(serverProbe); // hydrated in place, not client-rendered
    expect(serverProbe?.textContent).toBe("available");
  });

  it("negative control: the status carried in a context value fails to hydrate the streamed boundary", async () => {
    const { container, onRecoverableError } = await hydrateAfterStatus(echoTree);
    expect(onRecoverableError).toHaveBeenCalled();
    expect(String(onRecoverableError.mock.calls[0]?.[0])).toContain("Hydration failed");
    expect(container.querySelector("#probe")?.textContent).toBe("available"); // React client-rendered the boundary instead
  });
});
