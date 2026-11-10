// @vitest-environment jsdom
/**
 * Render smoke test of the setup guide (decision 155; src/components/superagent/setup) under jsdom:
 * SetupGuideScreen mounts with a status load and shows the "Where you are" rows, the 12 anchored steps with
 * their Done / To do / Not checked marks, this Tessera's address in step 9, the doctor troubleshooting list
 * and the "Check again" button. The Server Action and the router are mocked, so no runner, database or
 * Next runtime is involved.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DOCTOR_CHECKS, SETUP_STEPS } from "@/components/superagent/setup-guide";
import type { RunnerState, SuperagentSetupLoad } from "@/lib/superagent/types";
import { fixture } from "../superagent/support";

const refreshAction = vi.fn(async () => undefined);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/agents/superagent/setup",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/app/actions/superagent", () => ({
  superagentRefreshAction: (...args: unknown[]) => (refreshAction as (...a: unknown[]) => unknown)(...args),
}));

const { SetupGuideScreen } = await import("@/components/superagent/setup/SetupGuideScreen");

const CHECKS_OK = ["config", "node", "agent account", "api key", "api token", "gitconfig", "gh-agent login", "repo my-app", "sandbox", "disk", "tessera", "github"].map((name) => ({ name, ok: true, detail: null }));

function healthy(over: Partial<SuperagentSetupLoad> = {}): SuperagentSetupLoad {
  const state: RunnerState = { ...fixture<RunnerState>("state"), health: { status: "ok", checks: CHECKS_OK }, intake: { rewound: false, cursor: null, latestSeq: null } };
  return {
    runnerUrl: "http://127.0.0.1:3090",
    tokenFile: "/Users/me/.tessera-agents/api-token",
    token: { kind: "found", isPrivate: true },
    state: { ok: true, data: state },
    mappedProjects: [{ id: "p1", name: "Web", identifier: "WEB", repo: "web-repo" }],
    isConnected: true,
    ...over,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(load: SuperagentSetupLoad, tesseraUrl: string | null = "http://127.0.0.1:3000"): Promise<HTMLElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(SetupGuideScreen, { load, tesseraUrl }));
  });
  return container;
}

/** The text of the mark beside one step's heading ("Done", "To do", "Not checked"), or null when it has none. */
function mark(el: HTMLElement, id: string): string | null {
  const heading = el.querySelector(`#setup-step-${id}`);
  const stack = heading?.parentElement;
  const label = stack?.querySelector('[role="img"], [role="status"]');
  return label ? (stack?.textContent ?? "").replace(heading?.textContent ?? "", "").trim() || null : null;
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }
  window.scrollTo = () => {};
  if (typeof globalThis.ResizeObserver !== "function") {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }
});

beforeEach(() => {
  refreshAction.mockClear();
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
});

describe("SetupGuideScreen", () => {
  it("shows the title, the four rows, 12 anchored steps and the troubleshooting list for a healthy setup", async () => {
    const el = await render(healthy());
    const text = el.textContent ?? "";
    expect(el.querySelector('[aria-level="1"]')?.textContent).toBe("Set up the superagent");
    for (const title of ["Runner token found", "Runner running and healthy", "1 project mapped", "The superagent has connected to Tessera"]) expect(text, title).toContain(title);
    for (const step of SETUP_STEPS) {
      const heading = el.querySelector(`#setup-step-${step.id}`);
      expect(heading?.tagName, step.id).toBe("H2");
    }
    expect(el.querySelectorAll('h2[id^="setup-step-"]')).toHaveLength(12);
    // The steps no check covers have no mark; the rest follow the status.
    for (const id of ["runner", "api-key", "agent-account", "agent-token", "agent-login", "agent-identity", "repos", "connect", "start"]) expect(mark(el, id), id).toBe("Done");
    expect(mark(el, "access")).toBe("Not checked");
    expect(mark(el, "before")).toBeNull();
    expect(mark(el, "first-request")).toBeNull();
    expect(text).toContain("http://127.0.0.1:3000/api/mcp");
    expect(text).toContain("npm run doctor");
    expect(text).toContain("launchctl bootstrap");
    for (const check of DOCTOR_CHECKS) expect(text, check.label).toContain(check.label);
    expect(text).not.toContain("{tessera}");
    expect(text).not.toContain("{runner-repo}");
    expect(text).toContain("<tessera-agents-url>");
    expect(Array.from(el.querySelectorAll("a")).find((a) => a.textContent?.trim() === "Control screen")?.getAttribute("href")).toBe("/agents/superagent");
  });

  it("shows a first run: no token, nothing checked, step 1 to do", async () => {
    const el = await render(healthy({ token: { kind: "missing" }, state: null, mappedProjects: [], isConnected: false }));
    const text = el.textContent ?? "";
    for (const title of ["No runner token yet", "Runner not checked", "No project mapped yet", "The superagent hasn't connected to Tessera yet"]) expect(text, title).toContain(title);
    expect(mark(el, "runner")).toBe("To do");
    expect(mark(el, "api-key")).toBe("Not checked");
  });

  it("links a runner that does not answer to step 10", async () => {
    const down = { ok: false as const, failure: { state: "unreachable" as const, message: "down", status: null, code: null } };
    const el = await render(healthy({ state: down, isConnected: false }));
    expect(el.textContent).toContain("Runner not answering");
    const link = Array.from(el.querySelectorAll("a")).find((a) => a.textContent?.trim() === "Step 10");
    expect(link?.getAttribute("href")).toBe("#setup-step-start");
    expect(el.querySelector("#setup-step-start")?.textContent).toBe("10. Check and start the runner");
  });

  it("shows a placeholder address when the page could not tell its port", async () => {
    const el = await render(healthy(), null);
    expect(el.textContent).toContain("http://127.0.0.1:<port>/api/mcp");
  });

  it("asks Next to reload the status on Check again", async () => {
    const el = await render(healthy());
    const button = Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Check again");
    expect(button).toBeTruthy();
    await act(async () => {
      button?.click();
    });
    expect(refreshAction).toHaveBeenCalledTimes(1);
  });
});
