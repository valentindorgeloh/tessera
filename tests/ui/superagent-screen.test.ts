// @vitest-environment jsdom
/**
 * Render smoke test of the Superagent screen (decision 151; src/components/superagent)
 * under jsdom: SuperagentScreen mounts with the fixtures the fake runner serves
 * and shows the banners, the requests table with its actions, the triage rows,
 * Health, History, Routing and the settings sections; a failed state shows one
 * banner and "Not available" in every runner section. The Server Actions and
 * the router are mocked, so no runner, database or Next runtime is involved.
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fixture } from "../superagent/support";
import type { RequestDetail, RequestSummary, RunnerPromptsDoc, RunnerResult, RunnerSettingsDoc, RunnerState, RunnerStats, SuperagentLoad, TriageRow } from "@/lib/superagent/types";

const done = { ok: true as const, data: {} };
const push = vi.fn();
const requestAction = vi.fn(async () => done);
const retryTriage = vi.fn(async () => done);
const pause = vi.fn(async () => ({ ok: true as const, data: { paused: true } }));
const refreshAction = vi.fn(async () => undefined);
const resizeAction = vi.fn(async () => done);
const budgetAction = vi.fn(async () => done);
/** The Toast hook returns one spy, so a test reads what the screen announced without a viewport. */
const toastSpy = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/agents/superagent",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/app/actions/superagent", () => ({
  superagentRefreshAction: (...args: unknown[]) => (refreshAction as (...a: unknown[]) => unknown)(...args),
  superagentPauseAction: (...args: unknown[]) => (pause as (...a: unknown[]) => unknown)(...args),
  superagentRequestAction: (...args: unknown[]) => (requestAction as (...a: unknown[]) => unknown)(...args),
  superagentResizeAction: (...args: unknown[]) => (resizeAction as (...a: unknown[]) => unknown)(...args),
  superagentBudgetAction: (...args: unknown[]) => (budgetAction as (...a: unknown[]) => unknown)(...args),
  superagentRetryTriageAction: (...args: unknown[]) => (retryTriage as (...a: unknown[]) => unknown)(...args),
  superagentSaveSettingsAction: vi.fn(async () => done),
  superagentSavePromptsAction: vi.fn(async () => done),
}));
vi.mock("@/app/actions/workspace-settings", () => ({ setAgentSettingsAction: vi.fn(async () => ({ ok: true as const, data: {}, cursor: 1 })) }));
vi.mock("@astryxdesign/core/Toast", async (importOriginal) => {
  const real = await importOriginal<typeof import("@astryxdesign/core/Toast")>();
  return { ...real, useToast: () => toastSpy };
});

const { SuperagentScreen } = await import("@/components/superagent/SuperagentScreen");

const CONTEXT = { tokenFile: "/Users/me/.tessera-agents/api-token", runnerUrl: "http://127.0.0.1:3391" };

function ok<T>(data: T): RunnerResult<T> {
  return { ok: true, data };
}

function loaded(overrides: Partial<SuperagentLoad> = {}): SuperagentLoad {
  return {
    ...CONTEXT,
    state: ok(fixture<RunnerState>("state")),
    requests: ok(fixture<{ requests: RequestSummary[] }>("requests").requests),
    triage: ok(fixture<{ triage: TriageRow[] }>("triage").triage),
    stats: ok(fixture<RunnerStats>("stats")),
    settings: ok(fixture<RunnerSettingsDoc>("settings")),
    prompts: ok(fixture<RunnerPromptsDoc>("prompts")),
    request: null,
    ...overrides,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(runner: SuperagentLoad, extra: { scope?: "open" | "recent" | "all"; requestId?: string | null } = {}): Promise<HTMLElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const node: ReactNode = createElement(SuperagentScreen, {
    runner,
    agents: { runner_url: "http://127.0.0.1:3391", projects: [{ project_id: "0192f6a8-0000-7000-8000-00000000a001", repo: "tessera" }] },
    projects: [{ id: "0192f6a8-0000-7000-8000-00000000a001", name: "Tessera", identifier: "TES", archived: false }],
    scope: extra.scope ?? "open",
    requestId: extra.requestId ?? null,
  });
  await act(async () => {
    root?.render(node);
  });
  return container;
}

/** The item of one row's Actions menu: the trigger's `aria-controls` names its menu (every row keeps its hidden menu in the DOM). */
function menuItem(el: HTMLElement, itemKey: string, name: string): HTMLElement {
  const menuId = button(el, `Actions for ${itemKey}`).getAttribute("aria-controls");
  const menu = menuId === null ? null : el.ownerDocument.getElementById(menuId);
  const found = Array.from(menu?.querySelectorAll('[role="menuitem"]') ?? []).find((candidate) => candidate.textContent?.includes(name));
  if (!found) throw new Error(`No menu item named ${name} for ${itemKey}`);
  return found as HTMLElement;
}

function button(el: HTMLElement, name: string): HTMLButtonElement {
  const found = Array.from(el.querySelectorAll("button")).find((candidate) => candidate.getAttribute("aria-label") === name || candidate.textContent?.trim() === name);
  if (!found) throw new Error(`No button named ${name}`);
  return found;
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
  // jsdom has no modal <dialog>: open and close by attribute, as the other dialog tests do.
  const proto = HTMLDialogElement.prototype as { showModal?: () => void; close?: () => void };
  proto.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  proto.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
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
  push.mockClear();
  requestAction.mockClear();
  retryTriage.mockClear();
  pause.mockClear();
  refreshAction.mockClear();
  resizeAction.mockClear();
  budgetAction.mockClear();
  toastSpy.mockClear();
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
  vi.useRealTimers();
});

describe("SuperagentScreen", () => {
  it("shows every section from the fixtures", async () => {
    const el = await render(loaded());
    const text = el.textContent ?? "";
    // The panel title is the page's level 1 (Astryx renders it with aria-level).
    expect(el.querySelector('[aria-level="1"]')?.textContent).toBe("Superagent");
    for (const heading of ["Needs you", "Health", "History", "Routing", "Settings", "Team sections"]) {
      expect(Array.from(el.querySelectorAll("h2")).some((node) => node.textContent === heading), heading).toBe(true);
    }
    // Needs you: the count, the scope control, the sorted rows and their texts.
    expect(Array.from(el.querySelectorAll("h2")).find((node) => node.textContent === "Needs you")?.parentElement?.textContent).toBe("Needs you7");
    expect(Array.from(el.querySelectorAll('[role="radio"]')).map((node) => node.getAttribute("aria-label") ?? node.textContent)).toEqual(expect.arrayContaining(["Open", "Recent", "All"]));
    const keys = Array.from(el.querySelectorAll('a[href^="/work-items/"]')).map((node) => node.textContent);
    expect(keys.slice(0, 3)).toEqual(["TES-119", "TES-150", "TES-142"]);
    expect(keys).toEqual(expect.arrayContaining(["TES-142", "TES-138", "TES-131"]));
    expect(text).toContain("Needs sign-off");
    expect(text).toContain("$0.84 of $6.00");
    expect(el.querySelector('a[href="https://github.com/example/tessera/pull/214"]')?.textContent).toContain("#214 draft"); // hex-ok: a pull request number
    // The triage row that gave up.
    expect(text).toContain("Triage unavailable");
    expect(text).toContain("TES-149");
    expect(text).toContain("Tried 3 times");
    expect(button(el, "Re-triage TES-149")).toBeTruthy();
    // Health, Routing and History with nothing selected.
    expect(text).toContain("Degraded");
    expect(text).toContain("Dependencies of tessera-agents");
    expect(text).toContain("1 of 2 running");
    expect(text).toContain("1 queued, 0 running");
    expect(text).toContain("cursor 412, Tessera at 412");
    expect(text).toContain("$6.40 of $20.00");
    expect(button(el, "Pause")).toBeTruthy();
    expect(text).toContain("By size");
    expect(text).toContain("By model");
    expect(text).toContain("4 of 25 requests");
    expect(text).toContain("64%");
    expect(text).toContain("review_failed: 3, tests_failed: 2");
    expect(text).toContain("Select a request to see its history.");
    // Nothing is wrong, so no banner.
    for (const banner of ["The daily cap is reached", "Tessera history rewound", "Runner setup failed", "Runner not set up"]) expect(text, banner).not.toContain(banner);
  });

  it("names each primary action after its item and runs it at once", async () => {
    const el = await render(loaded());
    expect(button(el, "Approve TES-142").textContent).toBe("Approve");
    expect(button(el, "Lift hold TES-138").textContent).toBe("Lift hold");
    expect(button(el, "Retry TES-119").textContent).toBe("Retry");
    expect(button(el, "Actions for TES-142")).toBeTruthy();
    await act(async () => {
      button(el, "Approve TES-142").click();
    });
    expect(requestAction).toHaveBeenCalledWith({ request_id: "rq_signoff", action: "approve" });
    await act(async () => {
      button(el, "Re-triage TES-149").click();
    });
    expect(retryTriage).toHaveBeenCalledWith({ triage_id: "tri_unavailable" });
  });

  it("asks before it stops a request, then sends Stop", async () => {
    const el = await render(loaded());
    await act(async () => {
      button(el, "Actions for TES-142").click();
    });
    await act(async () => {
      menuItem(el, "TES-142", "Stop…").click();
    });
    expect(requestAction).not.toHaveBeenCalled();
    const dialog = el.ownerDocument.querySelector("dialog");
    expect(dialog?.textContent).toContain("Stop TES-142?");
    expect(dialog?.textContent).toContain("Stop is final: the session is aborted and late results are discarded.");
    await act(async () => {
      button(dialog as HTMLElement, "Stop request").click();
    });
    expect(requestAction).toHaveBeenCalledWith({ request_id: "rq_signoff", action: "stop" });
    expect(el.ownerDocument.querySelector("dialog")).toBeNull();
  });

  it("resizes from a dialog that starts on the current size", async () => {
    const el = await render(loaded());
    await act(async () => {
      button(el, "Actions for TES-142").click();
    });
    await act(async () => {
      menuItem(el, "TES-142", "Resize…").click();
    });
    const dialog = el.ownerDocument.querySelector("dialog") as HTMLElement;
    expect(dialog.getAttribute("aria-label")).toBe("Resize TES-142");
    const sizes = Array.from(dialog.querySelectorAll('[role="radio"]'));
    expect(sizes.map((node) => node.getAttribute("aria-label") ?? node.textContent)).toEqual(["S", "M", "L"]);
    // The current size (M) is the selected segment.
    expect(sizes.map((node) => node.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(button(dialog, "Resize").disabled).toBe(true);
    await act(async () => {
      (sizes[2] as HTMLElement).click();
    });
    await act(async () => {
      button(dialog, "Resize").click();
    });
    expect(resizeAction).toHaveBeenCalledWith({ request_id: "rq_signoff", size: "L" });
  });

  it("sets a budget from a dialog that starts on the current budget", async () => {
    const el = await render(loaded());
    await act(async () => {
      button(el, "Actions for TES-131").click();
    });
    await act(async () => {
      menuItem(el, "TES-131", "Budget…").click();
    });
    const dialog = el.ownerDocument.querySelector("dialog") as HTMLElement;
    expect(dialog.getAttribute("aria-label")).toBe("Budget for TES-131");
    const input = dialog.querySelector("input") as HTMLInputElement;
    expect(input.value).toContain("12");
    expect(button(dialog, "Set budget").disabled).toBe(true);
  });

  it("selects a request on a row click, but not on a click in its own links or buttons", async () => {
    const el = await render(loaded(), { scope: "recent" });
    const row = Array.from(el.querySelectorAll("tbody tr")).find((candidate) => candidate.textContent?.includes("TES-142"));
    expect(row).toBeTruthy();
    expect(row?.getAttribute("tabindex")).toBe("0");
    await act(async () => {
      (row?.querySelector("td") as HTMLElement).click();
    });
    expect(push).toHaveBeenCalledWith("/agents/superagent?scope=recent&request=rq_signoff", { scroll: false });
    push.mockClear();
    await act(async () => {
      button(el, "Approve TES-142").click();
    });
    expect(push).not.toHaveBeenCalled();
  });

  it("marks the selected row and shows its history, events newest first", async () => {
    const detail = fixture<{ request: RequestDetail }>("request-detail").request;
    const el = await render(loaded({ request: ok(detail) }), { requestId: detail.id });
    expect(el.querySelector('tr[aria-current="true"]')?.textContent).toContain(detail.itemKey);
    const text = el.textContent ?? "";
    expect(text).toContain(`${detail.itemKey} ${detail.title}`);
    expect(text).toContain("Scope");
    expect(text).toContain(detail.scope);
    expect(text).toContain("Open question");
    expect(text).toContain(detail.question ?? "");
    expect(text).toContain("Sessions");
    expect(text).toContain("planner");
    expect(el.querySelector(`a[href="/pages/${detail.planPageId}"]`)).not.toBeNull();
    const events = Array.from(el.querySelectorAll('ul[aria-label="Events"] li')).map((node) => node.textContent ?? "");
    expect(events.length).toBe(detail.events.length);
    expect(events[0]).toContain(detail.events[detail.events.length - 1].text);
    expect(events[events.length - 1]).toContain(detail.events[0].text);
  });

  it("shows a failed detail load inline", async () => {
    const el = await render(loaded({ request: { ok: false, failure: { state: "not_found", message: "No such request: rq_gone", status: 404, code: "NOT_FOUND" } } }), { requestId: "rq_gone" });
    expect(el.textContent).toContain("No such request: rq_gone");
  });

  it("says Paused, history rewound and setup failed in banners", async () => {
    const state = fixture<RunnerState>("state");
    const el = await render(
      loaded({
        state: ok({
          ...state,
          paused: true,
          pauseReason: "daily_cap",
          intake: { rewound: true, cursor: 500, latestSeq: 412 },
          health: { ...state.health, status: "setup_failed" },
        }),
      }),
    );
    const text = el.textContent ?? "";
    expect(text).toContain("The daily cap is reached; new work waits until tomorrow.");
    expect(text).toContain("Tessera history rewound");
    expect(text).toContain("The runner's cursor (500) is past Tessera's newest change (412)");
    expect(text).toContain("Runner setup failed");
    expect(text).toContain("Failed checks: Dependencies of tessera-agents (node_modules is missing; run npm install there).");
    expect(button(el, "Resume")).toBeTruthy();
  });

  it("pauses the runner from Health", async () => {
    const el = await render(loaded());
    await act(async () => {
      button(el, "Pause").click();
    });
    expect(pause).toHaveBeenCalledWith({ paused: true });
  });

  it("shows one banner and Not available in each section while the state failed", async () => {
    const down = { ok: false as const, failure: { state: "not_set_up" as const, message: "No runner token file", status: null, code: null } };
    const el = await render(loaded({ state: down, requests: down, triage: down, stats: down, settings: down, prompts: down, request: null }));
    const text = el.textContent ?? "";
    expect(text).toContain("Runner not set up");
    expect(text).toContain("Tessera reads the runner's token from /Users/me/.tessera-agents/api-token.");
    // Needs you, Health and Routing each say it, History too.
    expect(text.split("Not available: Runner not set up.").length - 1).toBeGreaterThanOrEqual(4);
    expect(el.querySelector("table")).toBeNull();
    expect(text).not.toContain("Triage unavailable");
  });

  it("shows the failure title of a part whose own load failed while the state is fine", async () => {
    const el = await render(loaded({ requests: { ok: false, failure: { state: "timeout", message: "slow", status: null, code: null } } }));
    const text = el.textContent ?? "";
    expect(text).toContain("Runner timed out");
    expect(text).not.toContain("Not available: Runner timed out.");
    expect(text).toContain("Degraded");
  });

  it("shows the empty state when there are no requests", async () => {
    const el = await render(loaded({ requests: ok([]) }));
    expect(el.textContent).toContain("No requests");
    expect(el.textContent).toContain("Assign or mention the superagent on a work item in a mapped project.");
  });

  it("reloads every 15 seconds while the tab is visible", async () => {
    vi.useFakeTimers();
    await render(loaded());
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    expect(refreshAction).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(refreshAction).toHaveBeenCalledTimes(3);
  });

  it("does not reload while one of the screen's dialogs is open, and picks the reload up again once it closes", async () => {
    vi.useFakeTimers();
    const el = await render(loaded());
    await act(async () => {
      button(el, "Actions for TES-142").click();
    });
    await act(async () => {
      menuItem(el, "TES-142", "Stop…").click();
    });
    const dialog = el.ownerDocument.querySelector("dialog") as HTMLElement;
    expect(dialog.textContent).toContain("Stop TES-142?");
    await act(async () => {
      vi.advanceTimersByTime(45_000);
    });
    expect(refreshAction).not.toHaveBeenCalled();
    await act(async () => {
      button(dialog, "Cancel").click();
    });
    expect(el.ownerDocument.querySelector("dialog")).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    expect(refreshAction).toHaveBeenCalledTimes(1);
  });

  it("does not reload while the tab is hidden", async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await render(loaded());
    await act(async () => {
      vi.advanceTimersByTime(45_000);
    });
    expect(refreshAction).not.toHaveBeenCalled();
    visibility.mockRestore();
  });
});

describe("SuperagentScreen Toasts", () => {
  const unavailable = { ok: false as const, failure: { state: "unavailable" as const, message: "The runner is shutting down.", status: 503, code: "UNAVAILABLE" } };
  const rejected = { ok: false as const, failure: { state: "unauthorized" as const, message: "Bad token", status: 401, code: "UNAUTHORIZED" } };

  it("says '<Action> sent for <item>' after a row action that went through", async () => {
    const el = await render(loaded());
    await act(async () => {
      button(el, "Approve TES-142").click();
    });
    expect(toastSpy).toHaveBeenCalledWith({ type: "info", body: "Approve sent for TES-142" });
    await act(async () => {
      button(el, "Retry TES-119").click();
    });
    expect(toastSpy).toHaveBeenLastCalledWith({ type: "info", body: "Retry sent for TES-119" });
    await act(async () => {
      button(el, "Re-triage TES-149").click();
    });
    expect(toastSpy).toHaveBeenLastCalledWith({ type: "info", body: "Re-triage sent for TES-149" });
  });

  it("says 'Stop sent for <item>' once the Stop dialog's call went through", async () => {
    const el = await render(loaded());
    await act(async () => {
      button(el, "Actions for TES-142").click();
    });
    await act(async () => {
      menuItem(el, "TES-142", "Stop…").click();
    });
    await act(async () => {
      button(el.ownerDocument.querySelector("dialog") as HTMLElement, "Stop request").click();
    });
    expect(toastSpy).toHaveBeenCalledWith({ type: "info", body: "Stop sent for TES-142" });
  });

  it("says 'Runner paused' after Pause and 'Runner resumed' after Resume", async () => {
    const el = await render(loaded());
    await act(async () => {
      button(el, "Pause").click();
    });
    expect(pause).toHaveBeenCalledWith({ paused: true });
    expect(toastSpy).toHaveBeenCalledWith({ type: "info", body: "Runner paused" });
    await act(async () => {
      root?.unmount();
    });
    container?.remove();
    toastSpy.mockClear();
    const state = fixture<RunnerState>("state");
    const paused = await render(loaded({ state: ok({ ...state, paused: true, pauseReason: "manual" }) }));
    await act(async () => {
      button(paused, "Resume").click();
    });
    expect(pause).toHaveBeenLastCalledWith({ paused: false });
    expect(toastSpy).toHaveBeenCalledWith({ type: "info", body: "Runner resumed" });
  });

  it("words a failed action as '<what was tried>. <title>. <body>'", async () => {
    requestAction.mockResolvedValueOnce(unavailable as unknown as typeof done);
    const el = await render(loaded());
    await act(async () => {
      button(el, "Approve TES-142").click();
    });
    expect(toastSpy).toHaveBeenCalledWith({ type: "error", body: "Could not approve TES-142. Runner unavailable. The runner is shutting down." });
    expect(toastSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: "info" }));
  });

  it("names the screen's real token file in a failure's Toast", async () => {
    requestAction.mockResolvedValueOnce(rejected as unknown as typeof done);
    const el = await render(loaded());
    await act(async () => {
      button(el, "Lift hold TES-138").click();
    });
    expect(toastSpy).toHaveBeenCalledWith({
      type: "error",
      body: "Could not lift the hold on TES-138. Token rejected. The runner rejected Tessera's token. Restart the runner or check /Users/me/.tessera-agents/api-token.",
    });
  });

  it("keeps the Stop dialog open and words a failed Stop", async () => {
    requestAction.mockResolvedValueOnce(unavailable as unknown as typeof done);
    const el = await render(loaded());
    await act(async () => {
      button(el, "Actions for TES-142").click();
    });
    await act(async () => {
      menuItem(el, "TES-142", "Stop…").click();
    });
    await act(async () => {
      button(el.ownerDocument.querySelector("dialog") as HTMLElement, "Stop request").click();
    });
    expect(toastSpy).toHaveBeenCalledWith({ type: "error", body: "Could not stop TES-142. Runner unavailable. The runner is shutting down." });
    expect(el.ownerDocument.querySelector("dialog")).not.toBeNull();
  });
});
