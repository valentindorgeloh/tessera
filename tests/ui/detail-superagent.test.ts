// @vitest-environment jsdom
/**
 * "Send to superagent" in the detail (decisions 144 and 145; docs/contracts/ui.md
 * "Send to superagent"): the pure state helper, the DetailHeader More menu with
 * and without the entry (disabled with each reason, in its place between "Move
 * to project…" and "Copy ID"), and WorkItemDetail's wiring (a mapped project,
 * the superagent actor, the click that assigns it, the Toasts). Rendered with
 * `createElement` as detail-smoke.test.ts does; the Server Action wrappers, the
 * router and the Toast hook are mocked.
 */
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectBundle } from "@/components/work-items/types";
import type { ActorRow, Project, State, WorkItem, WorkItemDetail as WorkItemDetailModel } from "@/lib/tessera/types";

const ok = { ok: true as const, data: {}, cursor: 1 };
const action = () => vi.fn(async () => ok);

vi.mock("@/app/actions/work-items", () => ({
  createWorkItemAction: action(),
  updateWorkItemAction: action(),
  updateWorkItemDescriptionAction: vi.fn(async () => ({ ok: true as const, data: { description_version: 2 }, cursor: 1 })),
  moveWorkItemAction: action(),
  deleteWorkItemAction: action(),
  archiveWorkItemAction: action(),
  unarchiveWorkItemAction: action(),
  setLabelsAction: action(),
  setAssigneesAction: action(),
  setModulesAction: action(),
}));
vi.mock("@/app/actions/detail", () => ({
  subscribeWorkItemAction: action(),
  unsubscribeWorkItemAction: action(),
  copyWorkItemAction: action(),
  addLinkAction: action(),
  updateLinkAction: action(),
  removeLinkAction: action(),
}));
vi.mock("@/app/actions/relations-comments", () => ({
  addRelationAction: action(),
  removeRelationAction: action(),
  addReactionAction: action(),
  removeReactionAction: action(),
  createCommentAction: action(),
  updateCommentAction: action(),
  deleteCommentAction: action(),
}));
vi.mock("@/app/actions/shell", () => ({ refreshAction: vi.fn(async () => undefined) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/projects/p/work-items",
  useSearchParams: () => new URLSearchParams(""),
}));
/** The Toast hook returns one spy, so a test reads what the detail announced without a viewport. */
const toastSpy = vi.hoisted(() => vi.fn());
vi.mock("@astryxdesign/core/Toast", async (importOriginal) => {
  const real = await importOriginal<typeof import("@astryxdesign/core/Toast")>();
  return { ...real, useToast: () => toastSpy };
});

const { ProjectProvider } = await import("@/components/work-items/project-provider");
const { DetailHeader, WorkItemDetail } = await import("@/components/detail");
const { setAssigneesAction } = await import("@/app/actions/work-items");
const { SUPERAGENT_ALREADY_ASSIGNED, SUPERAGENT_NOT_CONNECTED, sendToSuperagentState, sentToSuperagentText } = await import("@/components/superagent/send-to-superagent");
const { SUPERAGENT_ACTOR_NAME } = await import("@/lib/superagent/types");

const PROJECT = "11111111-1111-7111-8111-111111111111";
const ITEM = "22222222-2222-7222-8222-222222222222";
const USER = "55555555-5555-7555-8555-555555555555";
const AGENT = "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa";
const STATE = "66666666-6666-7666-8666-666666666666";
const NOW = "2026-10-11T10:00:00.000Z";
const REPO = "tessera";

const audit = { created_at: NOW, updated_at: NOW, created_by: USER, updated_by: USER, deleted_at: null };

const project: Project = {
  id: PROJECT,
  name: "Website",
  name_key: "website",
  identifier: "WEB",
  description_md: "",
  logo: { icon: "Globe", color: "blue" },
  next_sequence: 11,
  cycles_enabled: true,
  modules_enabled: true,
  views_enabled: true,
  pages_enabled: true,
  intake_enabled: false,
  estimates_enabled: false,
  agent_intake_required: false,
  estimate_id: null,
  estimate_type: null,
  default_assignee_id: null,
  archive_in_months: null,
  close_in_months: null,
  close_state_id: null,
  archived_at: null,
  sort_order: "a0",
  ...audit,
  counts: { total: 10, by_state_group: { backlog: 4, unstarted: 2, started: 2, completed: 1, cancelled: 1, triage: 0 } },
};
const states: State[] = [{ id: STATE, project_id: PROJECT, name: "Backlog", name_key: "backlog", description: "", color: "gray", state_group: "backlog", is_default: true, sort_order: "a0", ...audit }];
const person: ActorRow = { id: USER, kind: "user", name: "Valentin", name_key: "valentin", color: "blue", client_name: null, last_seen_at: null, access: "write", ...audit };
const superagent: ActorRow = { id: AGENT, kind: "agent", name: SUPERAGENT_ACTOR_NAME, name_key: SUPERAGENT_ACTOR_NAME, color: "purple", client_name: "superagent", last_seen_at: NOW, access: "write", ...audit };

function bundleOf(overrides: Partial<ProjectBundle> = {}): ProjectBundle {
  return { project, states, labels: [], cycles: [], modules: [], actors: [person, superagent], cursor: 42, today: "2026-10-17", estimate: null, intake_open: 0, projects: [], superagent_repo: REPO, ...overrides };
}

function itemOf(overrides: Partial<WorkItem> = {}): WorkItemDetailModel {
  return {
    id: ITEM,
    key: "WEB-1",
    name: "Set up hosting",
    sequence_id: 1,
    project_id: PROJECT,
    description_md: "",
    description_version: 0,
    state_id: STATE,
    priority: "none",
    parent_id: null,
    cycle_id: null,
    estimate_point_id: null,
    start_date: null,
    target_date: null,
    completed_at: null,
    archived_at: null,
    is_draft: false,
    sort_order: "a0",
    external_source: null,
    external_id: null,
    label_ids: [],
    module_ids: [],
    assignee_ids: [USER],
    sub_items_count: 0,
    links_count: 0,
    intake: null,
    ...audit,
    ...overrides,
    subscriber_ids: [],
    links: [],
  };
}

const detailData = (item: WorkItemDetailModel) => ({ item, parent: null, children: [], activity: [], comments: [], backlinks: [], relations: [], reactions: [], currentActorId: USER, cursor: 42 });

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(node: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(node);
  });
  return container;
}

/** Wraps `node` in the project context the detail reads. */
function inProject(bundle: ProjectBundle, node: ReactNode) {
  // createElement's typing wants `children` in the props object, the lint rule wants it as an argument; the cast satisfies both.
  return createElement(ProjectProvider, { bundle } as ComponentProps<typeof ProjectProvider>, node);
}

/** Opens the header's More menu and returns its rows. */
async function moreMenuRows(el: HTMLElement) {
  await act(async () => {
    el.querySelector<HTMLButtonElement>('button[aria-label="More actions"]')?.click();
  });
  return [...document.querySelectorAll<HTMLElement>('[role="menu"][aria-label="More actions"] [role="menuitem"]')];
}

/** A row's label: its first text-only span (the description, when there is one, follows it). */
function rowLabel(row: HTMLElement): string {
  const label = [...row.querySelectorAll("span")].find((span) => span.children.length === 0 && (span.textContent ?? "").trim() !== "");
  return label?.textContent?.trim() ?? "";
}

const sendRow = (rows: HTMLElement[]) => rows.find((row) => rowLabel(row) === "Send to superagent");

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
  toastSpy.mockClear();
  vi.mocked(setAssigneesAction).mockClear();
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

describe("sendToSuperagentState", () => {
  const actors = [person, superagent];

  it("has no row for a read-only item or a project without a mapped repository", () => {
    expect(sendToSuperagentState({ repo: REPO, actors, assigneeIds: [], readOnly: true })).toEqual({ kind: "hidden" });
    expect(sendToSuperagentState({ repo: null, actors, assigneeIds: [], readOnly: false })).toEqual({ kind: "hidden" });
    expect(sendToSuperagentState({ repo: undefined, actors, assigneeIds: [], readOnly: false })).toEqual({ kind: "hidden" });
  });

  it("is blocked until the superagent has connected (an agent named mcp:superagent; a user or a deleted agent of that name does not count)", () => {
    const blocked = { kind: "blocked", reason: SUPERAGENT_NOT_CONNECTED };
    expect(sendToSuperagentState({ repo: REPO, actors: [person], assigneeIds: [], readOnly: false })).toEqual(blocked);
    expect(sendToSuperagentState({ repo: REPO, actors: [person, { ...superagent, kind: "user" }], assigneeIds: [], readOnly: false })).toEqual(blocked);
    expect(sendToSuperagentState({ repo: REPO, actors: [person, { ...superagent, deleted_at: NOW }], assigneeIds: [], readOnly: false })).toEqual(blocked);
    expect(sendToSuperagentState({ repo: REPO, actors: [person, { ...superagent, name: "mcp:other" }], assigneeIds: [], readOnly: false })).toEqual(blocked);
  });

  it("is blocked once the superagent is an assignee", () => {
    expect(sendToSuperagentState({ repo: REPO, actors, assigneeIds: [USER, AGENT], readOnly: false })).toEqual({ kind: "blocked", reason: SUPERAGENT_ALREADY_ASSIGNED });
  });

  it("is ready with the current assignees plus the superagent", () => {
    expect(sendToSuperagentState({ repo: REPO, actors, assigneeIds: [USER], readOnly: false })).toEqual({ kind: "ready", repo: REPO, actorIds: [USER, AGENT] });
    expect(sendToSuperagentState({ repo: REPO, actors, assigneeIds: [], readOnly: false })).toEqual({ kind: "ready", repo: REPO, actorIds: [AGENT] });
    expect(sentToSuperagentText(REPO)).toBe("Sent to the superagent (tessera).");
  });
});

describe("DetailHeader More menu", () => {
  const header = (extra: Partial<ComponentProps<typeof DetailHeader>>) =>
    inProject(
      bundleOf(),
      createElement(DetailHeader, {
        item: itemOf(),
        parent: null,
        host: "page",
        onOpenItem: vi.fn(),
        onCopyItem: vi.fn(),
        onCopyToProject: vi.fn(),
        onMoveToProject: vi.fn(),
        onVersionHistory: vi.fn(),
        ...extra,
      }),
    );

  it("has no Send to superagent row without onSendToSuperagent", async () => {
    const rows = await moreMenuRows(await render(header({})));
    expect(rows.map(rowLabel)).toEqual(["Make a copy", "Copy to project…", "Move to project…", "Copy ID (WEB-1)", "Version history"]);
  });

  it("puts an enabled row after Move to project… and before Copy ID, and calls the handler on a click", async () => {
    const onSend = vi.fn();
    const rows = await moreMenuRows(await render(header({ onSendToSuperagent: onSend })));
    expect(rows.map(rowLabel)).toEqual(["Make a copy", "Copy to project…", "Move to project…", "Send to superagent", "Copy ID (WEB-1)", "Version history"]);
    const row = sendRow(rows);
    expect(row?.getAttribute("aria-disabled")).not.toBe("true");
    await act(async () => {
      row?.click();
    });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it.each([SUPERAGENT_NOT_CONNECTED, SUPERAGENT_ALREADY_ASSIGNED])("shows the row disabled with %s and does not call the handler", async (reason) => {
    const onSend = vi.fn();
    const rows = await moreMenuRows(await render(header({ onSendToSuperagent: onSend, sendToSuperagentBlockedReason: reason })));
    const row = sendRow(rows);
    expect(row?.getAttribute("aria-disabled")).toBe("true");
    expect(row?.textContent).toContain(reason);
    await act(async () => {
      row?.click();
    });
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("WorkItemDetail Send to superagent", () => {
  const detail = (bundle: ProjectBundle, item = itemOf()) => inProject(bundle, createElement(WorkItemDetail, { data: detailData(item), host: "page", onOpenItem: vi.fn() }));

  it("assigns the superagent next to the current assignees and announces it", async () => {
    const rows = await moreMenuRows(await render(detail(bundleOf())));
    const row = sendRow(rows);
    expect(row?.getAttribute("aria-disabled")).not.toBe("true");
    await act(async () => {
      row?.click();
    });
    expect(setAssigneesAction).toHaveBeenCalledWith({ work_item_id: ITEM, actor_ids: [USER, AGENT] });
    expect(toastSpy).toHaveBeenCalledWith({ type: "info", body: "Sent to the superagent (tessera)." });
  });

  it("reports a failed assignment with its message", async () => {
    vi.mocked(setAssigneesAction).mockResolvedValueOnce({ ok: false, code: "RULE", message: "Not allowed" });
    const rows = await moreMenuRows(await render(detail(bundleOf())));
    await act(async () => {
      sendRow(rows)?.click();
    });
    expect(toastSpy).toHaveBeenCalledWith({ type: "error", body: "Could not send to the superagent: Not allowed" });
    expect(toastSpy).not.toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("Sent to the superagent") }));
  });

  it("is disabled with 'not connected' while the project's actors have no mcp:superagent", async () => {
    const row = sendRow(await moreMenuRows(await render(detail(bundleOf({ actors: [person] })))));
    expect(row?.getAttribute("aria-disabled")).toBe("true");
    expect(row?.textContent).toContain(SUPERAGENT_NOT_CONNECTED);
    await act(async () => {
      row?.click();
    });
    expect(setAssigneesAction).not.toHaveBeenCalled();
  });

  it("is disabled with 'already assigned' when the superagent is an assignee", async () => {
    const row = sendRow(await moreMenuRows(await render(detail(bundleOf(), itemOf({ assignee_ids: [USER, AGENT] })))));
    expect(row?.getAttribute("aria-disabled")).toBe("true");
    expect(row?.textContent).toContain(SUPERAGENT_ALREADY_ASSIGNED);
  });

  it("has no row for an unmapped project, a bundle without the field or an archived item", async () => {
    for (const bundle of [bundleOf({ superagent_repo: null }), bundleOf({ superagent_repo: undefined })]) {
      const rows = await moreMenuRows(await render(detail(bundle)));
      expect(sendRow(rows)).toBeUndefined();
      await act(async () => {
        root?.unmount();
      });
      container?.remove();
      root = null;
      container = null;
    }
    const archived = await moreMenuRows(await render(detail(bundleOf(), itemOf({ archived_at: NOW }))));
    expect(sendRow(archived)).toBeUndefined();
  });
});
