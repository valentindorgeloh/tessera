// @vitest-environment jsdom
/**
 * The superagent chat screen (decision 153; src/components/superagent/chat) under
 * jsdom: the pure helpers of chat-format.ts, then a render smoke test of
 * SuperagentChat with `createElement` (a `.test.tsx` never runs): not connected,
 * an open item with bubbles on both sides and the header's buttons, not found,
 * and the archived composer. The Server Actions and the router are mocked, so no
 * runner, database or Next runtime is involved.
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fixture } from "../superagent/support";
import { chatHref, chatTitle, composerStatus, entryName, lastMessageLine } from "@/components/superagent/chat-format";
import type { ChatEntry, ChatOpen, RequestSummary, RunnerFailure, RunnerFailureState, RunnerResult, SuperagentChatLoad } from "@/lib/superagent/types";

const done = { ok: true as const, data: {}, cursor: 1 };
const push = vi.fn();
const requestAction = vi.fn(async () => ({ ok: true as const, data: {} }));
const refreshAction = vi.fn(async () => undefined);
const createComment = vi.fn<(input: unknown) => Promise<unknown>>(async () => done);
const createWorkItem = vi.fn<(input: unknown) => Promise<unknown>>(async () => ({ ok: true as const, data: { key: "TES-200" }, cursor: 1 }));
/** The Toast hook returns one spy, so a test reads what the screen announced without a viewport. */
const toastSpy = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/agents/superagent/chat",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/app/actions/superagent", () => ({
  superagentRefreshAction: (...args: unknown[]) => (refreshAction as (...a: unknown[]) => unknown)(...args),
  superagentRequestAction: (...args: unknown[]) => (requestAction as (...a: unknown[]) => unknown)(...args),
  superagentResizeAction: vi.fn(async () => ({ ok: true as const, data: {} })),
  superagentBudgetAction: vi.fn(async () => ({ ok: true as const, data: {} })),
}));
vi.mock("@/app/actions/relations-comments", () => ({ createCommentAction: (input: unknown) => createComment(input) }));
vi.mock("@/app/actions/work-items", () => ({ createWorkItemAction: (input: unknown) => createWorkItem(input) }));
vi.mock("@astryxdesign/core/Toast", async (importOriginal) => {
  const real = await importOriginal<typeof import("@astryxdesign/core/Toast")>();
  return { ...real, useToast: () => toastSpy };
});

const { SuperagentChat } = await import("@/components/superagent/chat/SuperagentChat");

const CONTEXT = { tokenFile: "/Users/me/.tessera-agents/api-token", runnerUrl: "http://127.0.0.1:3391" };
const USER = "00000000-0000-7000-8000-000000000001";
const AGENT = "0192f6a8-3000-7000-8000-000000000001";
const PROJECT = "0192f6a8-0000-7000-8000-00000000a001";
const ITEM = "0192f6a8-1000-7000-8000-000000000142";
const AT = "2026-11-09T08:12:00.000Z";

const failure = (state: RunnerFailureState): RunnerFailure => ({ state, message: "boom", status: null, code: null });
const failed = (state: RunnerFailureState): RunnerResult<never> => ({ ok: false, failure: failure(state) });

describe("chatHref", () => {
  it("encodes the key under the chat path", () => {
    expect(chatHref("TES-142")).toBe("/agents/superagent/chat/TES-142");
    expect(chatHref("a b/c")).toBe("/agents/superagent/chat/a%20b%2Fc");
  });
});

describe("chatTitle", () => {
  it("takes the first line with text", () => {
    expect(chatTitle("Add dark mode\nand make it fast")).toBe("Add dark mode");
    expect(chatTitle("\n \r\n  Second line\nthird")).toBe("Second line");
  });
  it("drops leading Markdown markers and spaces", () => {
    expect(chatTitle("## Plan the release")).toBe("Plan the release");
    expect(chatTitle("> - * Quoted item")).toBe("Quoted item");
    expect(chatTitle("-Dash")).toBe("Dash");
    expect(chatTitle("A - dash inside")).toBe("A - dash inside");
  });
  it("keeps a line of exactly 80 characters", () => {
    const line = "x".repeat(80);
    expect(chatTitle(line)).toBe(line);
  });
  it("clips at the last space before 80 and adds an ellipsis", () => {
    const words = "word ".repeat(30).trim();
    const title = chatTitle(words);
    expect(title.endsWith("…")).toBe(true);
    expect(title).toBe(`${"word ".repeat(16).trim()}…`);
    expect(title.length).toBeLessThanOrEqual(80);
  });
  it("clips at 80 when the line has no space", () => {
    expect(chatTitle("y".repeat(120))).toBe(`${"y".repeat(80)}…`);
  });
  it("falls back when no text is left", () => {
    expect(chatTitle("")).toBe("Chat with the superagent");
    expect(chatTitle("  \n \n")).toBe("Chat with the superagent");
    expect(chatTitle("### >")).toBe("Chat with the superagent");
  });
});

describe("entryName and lastMessageLine", () => {
  const entry = { actorId: AGENT, actorName: "mcp:superagent" };
  it("names the superagent actor Superagent and anyone else by name", () => {
    expect(entryName(entry, AGENT)).toBe("Superagent");
    expect(entryName({ actorId: USER, actorName: "Valentin" }, AGENT)).toBe("Valentin");
    expect(entryName(entry, null)).toBe("mcp:superagent");
  });
  it("words a list row's second line", () => {
    expect(lastMessageLine(null)).toBe("No messages yet");
    expect(lastMessageLine({ actorName: "mcp:superagent", snippet: "On it", at: AT })).toBe("Superagent: On it");
    expect(lastMessageLine({ actorName: "Valentin", snippet: "Thanks", at: AT })).toBe("Valentin: Thanks");
  });
});

describe("composerStatus", () => {
  it("is null while the runner's list loaded", () => {
    expect(composerStatus({ ok: true, data: [] }, CONTEXT)).toBeNull();
  });
  it.each(["unreachable", "timeout", "unavailable"] as const)("says the runner is offline for %s", (state) => {
    expect(composerStatus(failed(state), CONTEXT)).toEqual({ type: "warning", message: "Runner offline. It will read this when it's back." });
  });
  it.each([
    ["not_set_up", "Runner not set up"],
    ["token_unreadable", "Token file unreadable"],
    ["unauthorized", "Token rejected"],
    ["forbidden", "Request refused"],
    ["not_found", "Not found"],
    ["validation", "Not accepted"],
    ["conflict", "Changed elsewhere"],
    ["bad_response", "Unexpected answer"],
    ["http_error", "Runner error"],
  ] as const)("names the failure for %s", (state, title) => {
    expect(composerStatus(failed(state), CONTEXT)).toEqual({ type: "warning", message: `${title}. The runner reads this once it is running.` });
  });
});

const signoff = fixture<{ requests: RequestSummary[] }>("requests").requests.find((request) => request.id === "rq_signoff") as RequestSummary;

function entry(overrides: Partial<ChatEntry>): ChatEntry {
  return { id: "c1", kind: "comment", actorId: AGENT, actorName: "mcp:superagent", actorKind: "agent", actorColor: "blue", bodyMd: "A comment", createdAt: AT, isEdited: false, ...overrides };
}

function item(overrides: Partial<Extract<ChatOpen, { kind: "item" }>> = {}): Extract<ChatOpen, { kind: "item" }> {
  return {
    kind: "item",
    workItemId: ITEM,
    itemKey: "TES-142",
    title: "Add a keyboard shortcut",
    projectId: PROJECT,
    projectName: "Tessera",
    isArchived: false,
    entries: [
      entry({ id: "description", kind: "description", actorId: USER, actorName: "Valentin", actorKind: "user", actorColor: "green", bodyMd: "Please add the shortcut" }),
      entry({ id: "c1", bodyMd: "Plan ready for sign-off", isEdited: true }),
      entry({ id: "c2", kind: "reply", actorId: USER, actorName: "Valentin", actorKind: "user", actorColor: "green", bodyMd: "Looks good" }),
    ],
    mentionActors: [{ id: AGENT, name: "mcp:superagent" }],
    request: signoff,
    detail: null,
    replyToCommentId: null,
    ...overrides,
  };
}

function loaded(overrides: Partial<SuperagentChatLoad> = {}): SuperagentChatLoad {
  return {
    ...CONTEXT,
    requests: { ok: true, data: [signoff] },
    superagentActorId: AGENT,
    userActorId: USER,
    projects: [{ id: PROJECT, name: "Tessera", identifier: "TES", repo: "tessera" }],
    conversations: [
      {
        workItemId: ITEM,
        itemKey: "TES-142",
        title: "Add a keyboard shortcut",
        projectId: PROJECT,
        projectName: "Tessera",
        isArchived: false,
        lastMessage: { actorName: "mcp:superagent", snippet: "Plan ready", at: AT },
        lastActivityAt: AT,
        request: signoff,
      },
    ],
    open: null,
    ...overrides,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(load: SuperagentChatLoad, isNew = false): Promise<HTMLElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const node: ReactNode = createElement(SuperagentChat, { load, isNew });
  await act(async () => {
    root?.render(node);
  });
  return container;
}

function control(el: HTMLElement, name: string): HTMLElement {
  const found = Array.from(el.querySelectorAll<HTMLElement>("button, a")).find((candidate) => candidate.getAttribute("aria-label") === name || candidate.textContent?.trim() === name);
  if (!found) throw new Error(`No button or link named ${name}`);
  return found;
}

const isOff = (node: HTMLElement) => (node as HTMLButtonElement).disabled === true || node.getAttribute("aria-disabled") === "true";

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
  const proto = HTMLDialogElement.prototype as { showModal?: () => void; close?: () => void };
  proto.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  proto.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
  window.scrollTo = () => {};
  Element.prototype.scrollTo = () => {};
  Element.prototype.scrollIntoView = () => {};
  if (typeof globalThis.ResizeObserver !== "function") {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }
  if (typeof globalThis.IntersectionObserver !== "function") {
    class IntersectionObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    globalThis.IntersectionObserver = IntersectionObserverStub as unknown as typeof IntersectionObserver;
  }
});

beforeEach(() => {
  for (const spy of [push, requestAction, refreshAction, createComment, createWorkItem, toastSpy]) spy.mockClear();
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

describe("SuperagentChat", () => {
  it("says the superagent has not connected and turns New chat off", async () => {
    const el = await render(loaded({ superagentActorId: null, conversations: [] }));
    expect(el.querySelector('[aria-level="1"]')?.textContent).toBe("Superagent chat");
    const text = el.textContent ?? "";
    expect(text).toContain("The superagent hasn't connected yet");
    expect(text).toContain("It shows up after the runner first connects to Tessera.");
    expect(text).toContain("No chats yet");
    expect(isOff(control(el, "New chat"))).toBe(true);
    expect(control(el, "Control screen").getAttribute("href")).toBe("/agents/superagent");
    // Nothing is open, so the layout is the list-only one and the new-chat pane is the content.
    expect(el.querySelector(".tessera-chat--open")).toBeNull();
  });

  it("enables New chat once the superagent and a project exist, and opens the new-chat pane for ?new=1", async () => {
    const list = await render(loaded());
    expect(isOff(control(list, "New chat"))).toBe(false);
    expect(control(list, "New chat").getAttribute("href")).toBe("/agents/superagent/chat?new=1");
    expect(list.textContent).toContain("TES-142 Add a keyboard shortcut");
    expect(list.textContent).toContain("Superagent: Plan ready");
    expect(list.textContent).toContain("Needs sign-off");
    await act(async () => {
      root?.unmount();
    });
    root = null;
    container?.remove();
    const fresh = await render(loaded(), true);
    expect(fresh.querySelector(".tessera-chat--open")).not.toBeNull();
    expect(fresh.textContent).toContain("Start a chat");
    expect(fresh.textContent).toContain("Pick a project and say what you need.");
  });

  it("shows an open item with bubbles on both sides and the request's buttons", async () => {
    const el = await render(loaded({ open: item() }));
    expect(el.querySelector(".tessera-chat--open")).not.toBeNull();
    const heading = Array.from(el.querySelectorAll("h2")).find((node) => node.textContent?.includes("Add a keyboard shortcut"));
    expect(heading?.querySelector('a[href="/work-items/0192f6a8-1000-7000-8000-000000000142"]')?.textContent).toBe("TES-142");
    const text = el.textContent ?? "";
    expect(text).toContain("Please add the shortcut");
    expect(text).toContain("Plan ready for sign-off");
    expect(text).toContain("Looks good");
    // The agent's side is named "Superagent"; the user's own bubbles carry no name.
    expect(text).toContain("Superagent");
    expect(text).toContain("Description");
    expect(text).toContain("In a thread");
    expect(text).toContain("edited");
    const senders = Array.from(el.querySelectorAll("[data-sender]")).map((node) => node.getAttribute("data-sender"));
    expect(senders).toEqual(expect.arrayContaining(["user", "assistant"]));
    // The request row: stage, cost and the listed actions, the first of approve/lift/retry primary.
    expect(text).toContain("$0.84 of $6.00");
    for (const name of ["Approve TES-142", "Stop… TES-142", "Resize… TES-142"]) expect(control(el, name)).toBeTruthy();
    const approve = control(el, "Approve TES-142");
    await act(async () => {
      approve.click();
    });
    expect(requestAction).toHaveBeenCalledWith({ request_id: "rq_signoff", action: "approve" });
    expect(toastSpy).toHaveBeenCalledWith({ type: "info", body: "Approve sent for TES-142" });
    expect(el.querySelector('[aria-label="Message input"]')?.getAttribute("contenteditable")).toBe("true");
    expect(text).toContain("Message the superagent");
    expect(text).not.toContain("Replies in the question's thread");
  });

  it("says when the item has no runner request, and names the thread when a question waits", async () => {
    const el = await render(loaded({ open: item({ request: null, replyToCommentId: "c1" }) }));
    expect(el.textContent).toContain("No runner request yet.");
    expect(el.textContent).toContain("Replies in the question's thread");
  });

  it("leaves the runner part of the header out and warns in the composer when the runner failed", async () => {
    const el = await render(loaded({ requests: failed("unreachable"), open: item({ request: null }) }));
    const text = el.textContent ?? "";
    expect(text).not.toContain("No runner request yet.");
    expect(text).toContain("Runner not answering: stages and costs are hidden.");
    expect(text).toContain("Runner offline. It will read this when it's back.");
  });

  it("shows No such work item for an unknown key", async () => {
    const el = await render(loaded({ open: { kind: "not_found", itemKey: "TES-999" } }));
    expect(Array.from(el.querySelectorAll("h2")).some((node) => node.textContent === "No such work item")).toBe(true);
    expect(el.textContent).toContain("TES-999 does not exist or was deleted.");
    expect(control(el, "All chats").getAttribute("href")).toBe("/agents/superagent/chat");
  });

  it("turns the composer off on an archived item", async () => {
    const el = await render(loaded({ open: item({ isArchived: true }) }));
    expect(el.textContent).toContain("Archived work items take no comments.");
    const input = el.querySelector<HTMLElement>('[aria-label="Message input"]');
    expect(input).not.toBeNull();
    expect(input?.getAttribute("contenteditable") === "false" || input?.getAttribute("aria-disabled") === "true").toBe(true);
  });

  it("sends a message as a reply in the question's thread, and puts the text back on a failure", async () => {
    const el = await render(loaded({ open: item({ replyToCommentId: "c1" }) }));
    const input = el.querySelector<HTMLElement>('[aria-label="Message input"]') as HTMLElement;
    await act(async () => {
      input.focus();
      input.textContent = "Only live projects";
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "Only live projects" }));
    });
    const send = control(el, "Send");
    await act(async () => {
      send.click();
    });
    expect(createComment).toHaveBeenCalledWith({ work_item_id: ITEM, body_md: "Only live projects", parent_comment_id: "c1" });
    createComment.mockResolvedValueOnce({ ok: false, code: "ARCHIVED", message: "It is archived" });
    await act(async () => {
      input.textContent = "Second try";
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "Second try" }));
    });
    await act(async () => {
      control(el, "Send").click();
    });
    expect(toastSpy).toHaveBeenCalledWith({ type: "error", body: "Could not send. It is archived" });
    expect(input.textContent).toContain("Second try");
  });

  it("starts a chat as a work item assigned to the superagent and opens it, or keeps the text on a failure", async () => {
    const el = await render(loaded(), true);
    const input = el.querySelector<HTMLElement>('[aria-label="Message input"]') as HTMLElement;
    const type = async (value: string) => {
      await act(async () => {
        input.focus();
        input.textContent = value;
        input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      });
    };
    createWorkItem.mockResolvedValueOnce({ ok: false, code: "VALIDATION", message: "Name is required" });
    await type("# Weekly digest\nWhich projects count?");
    await act(async () => {
      control(el, "Send").click();
    });
    expect(createWorkItem).toHaveBeenCalledWith({ project_id: PROJECT, name: "Weekly digest", description_md: "# Weekly digest\nWhich projects count?", assignee_ids: [AGENT] });
    expect(toastSpy).toHaveBeenCalledWith({ type: "error", body: "Could not start the chat. Name is required" });
    expect(push).not.toHaveBeenCalled();
    expect(input.textContent).toContain("Weekly digest");
    await act(async () => {
      control(el, "Send").click();
    });
    expect(push).toHaveBeenCalledWith("/agents/superagent/chat/TES-200");
  });

  it("disables New chat's pane when no project is mapped and links to settings", async () => {
    const el = await render(loaded({ projects: [] }), true);
    expect(isOff(control(el, "New chat"))).toBe(true);
    expect(control(el, "Open settings").getAttribute("href")).toBe("/agents/superagent");
    expect(el.textContent).toContain("Map a project to a repository first.");
  });
});
