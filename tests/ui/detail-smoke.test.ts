// @vitest-environment jsdom
/**
 * Render smoke test of the detail panel (src/components/detail) under jsdom:
 * WorkItemDetail mounts inside ProjectProvider with fake data for every host,
 * shows the header, title, property wrappers, sub-items, links and activity,
 * registers the command context and the recents label, turns the title into
 * an input on click and lists the More menu (copy, copy ID, restore or
 * archive, delete). The peek host records a loaded item in the recents. The
 * Server Action wrappers and the router are mocked so no database or Next
 * runtime is involved.
 */
import { Fragment, act, createElement, useEffect, useLayoutEffect, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ProjectBundle } from "@/components/work-items/types";
import type { ActivityLogEntry, ActorRow, Label, Project, State, WorkItem, WorkItemDetail as WorkItemDetailModel, WorkItemLinkRow } from "@/lib/tessera/types";

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

type SaveResult = import("@/components/editor").UseDescriptionSaveResult;
type SaveInput = import("@/components/editor").UseDescriptionSaveInput;
/** When set, DescriptionEditor sees this save state instead of the real queue's (the real hook still runs, so hook order stays fixed). */
const saveOverride: { current: SaveResult | null } = { current: null };
vi.mock("@/components/editor", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/editor")>();
  function useDescriptionSaveWithOverride(input: SaveInput): SaveResult {
    const result = real.useDescriptionSave(input);
    return saveOverride.current ?? result;
  }
  return { ...real, useDescriptionSave: useDescriptionSaveWithOverride };
});
/** The router, path and query the mocked next/navigation hands out; the PeekHost tests read and set them. */
const nav = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() },
  pathname: "/projects/p/work-items",
  search: "",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const { ProjectProvider } = await import("@/components/work-items/project-provider");
const { WorkItemDetail } = await import("@/components/detail");
const { useCommandContext } = await import("@/components/shell/command-context");
const { useEntityLabels } = await import("@/components/shell/entity-labels");
const { updateWorkItemAction, setAssigneesAction, setLabelsAction, archiveWorkItemAction, unarchiveWorkItemAction } = await import("@/app/actions/work-items");
const { unsubscribeWorkItemAction } = await import("@/app/actions/detail");
const { useDetailActions } = await import("@/components/detail");
const { ARCHIVE_OPEN_ITEM_REASON } = await import("@/components/planning/archive-rules");
type DetailActions = import("@/components/detail").DetailActions;

const PROJECT = "11111111-1111-7111-8111-111111111111";
const ITEM = "22222222-2222-7222-8222-222222222222";
const CHILD = "33333333-3333-7333-8333-333333333333";
const PARENT = "44444444-4444-7444-8444-444444444444";
const USER = "55555555-5555-7555-8555-555555555555";
const STATE_BACKLOG = "66666666-6666-7666-8666-666666666666";
const STATE_STARTED = "77777777-7777-7777-8777-777777777777";
const STATE_DONE = "99999999-9999-7999-8999-999999999999";
const LABEL = "88888888-8888-7888-8888-888888888888";
const NOW = "2026-10-11T10:00:00.000Z";

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

const states: State[] = [
  { id: STATE_BACKLOG, project_id: PROJECT, name: "Backlog", name_key: "backlog", description: "", color: "gray", state_group: "backlog", is_default: true, sort_order: "a0", ...audit },
  { id: STATE_STARTED, project_id: PROJECT, name: "In progress", name_key: "in progress", description: "", color: "blue", state_group: "started", is_default: false, sort_order: "a1", ...audit },
];

const labels: Label[] = [{ id: LABEL, project_id: PROJECT, parent_id: null, name: "Bug", name_key: "bug", color: "red", sort_order: "a0", ...audit }];

const actors: ActorRow[] = [{ id: USER, kind: "user", name: "Valentin", name_key: "valentin", color: "blue", client_name: null, last_seen_at: null, access: "write", ...audit }];

const bundle: ProjectBundle = { project, states, labels, cycles: [], modules: [], actors, cursor: 42, today: "2026-10-17", estimate: null, intake_open: 0, projects: [] };

function workItem(overrides: Partial<WorkItem> & Pick<WorkItem, "id" | "key" | "name" | "sequence_id">): WorkItem {
  return {
    project_id: PROJECT,
    description_md: "",
    description_version: 0,
    state_id: STATE_BACKLOG,
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
    assignee_ids: [],
    sub_items_count: 0,
    links_count: 0,
    intake: null,
    ...audit,
    ...overrides,
  };
}

const link: WorkItemLinkRow = { id: "link-1", work_item_id: ITEM, title: "", url: "https://docs.example.com/spec", metadata: null, sort_order: "a0", ...audit };

const item: WorkItemDetailModel = {
  ...workItem({ id: ITEM, key: "WEB-1", name: "Set up hosting", sequence_id: 1, parent_id: PARENT, label_ids: [LABEL], sub_items_count: 1, links_count: 1, description_md: "Hello", description_version: 1 }),
  subscriber_ids: [USER],
  links: [link],
};

const child = workItem({ id: CHILD, key: "WEB-2", name: "Pick a provider", sequence_id: 2, parent_id: ITEM, assignee_ids: [USER] });

const activity: ActivityLogEntry[] = [
  {
    seq: 7,
    uid: "u7",
    project_id: PROJECT,
    entity_type: "work_item",
    entity_id: ITEM,
    work_item_id: ITEM,
    verb: "updated",
    field: "state_id",
    old_value: STATE_BACKLOG,
    new_value: STATE_STARTED,
    old_identifier: "Backlog",
    new_identifier: "In progress",
    comment: null,
    actor_id: USER,
    created_at: NOW,
    actor_name: "Valentin",
    merged_count: 1,
    last_seq: 7,
  },
  {
    seq: 3,
    uid: "u3",
    project_id: PROJECT,
    entity_type: "work_item",
    entity_id: ITEM,
    work_item_id: ITEM,
    verb: "created",
    field: null,
    old_value: null,
    new_value: null,
    old_identifier: null,
    new_identifier: "WEB-1",
    comment: null,
    actor_id: USER,
    created_at: NOW,
    actor_name: "Valentin",
    merged_count: 1,
    last_seq: 3,
  },
];

const PAGE = "55555555-5555-7555-8555-555555555555";
const comment = {
  id: "66666666-6666-7666-8666-666666666666",
  work_item_id: ITEM,
  parent_id: null,
  actor_id: USER,
  actor_name: "You",
  actor_kind: "user",
  actor_color: "blue",
  body_md: "A comment from the loader",
  body_version: 1,
  created_at: "2026-10-01T10:00:00.000Z",
  updated_at: "2026-10-01T10:00:00.000Z",
  edited_at: null,
  deleted_at: null,
  reactions: [],
  replies: [],
} as unknown as import("@/components/detail/CommentItem").CommentView;
const backlinks = [{ id: PAGE, name: "Launch notes", project_id: PROJECT, archived_at: null }];
const relations = [
  { id: "88888888-8888-7888-8888-888888888801", relation_type: "blocked_by" as const, item: { id: CHILD, key: "WEB-7", name: "Order the domain", project_id: PROJECT, archived: false, state: { name: "In progress", state_group: "started" as const } } },
];
const reactions = [{ reaction: "👍", count: 1, actor_ids: [USER] }];
const data = { item, parent: { id: PARENT, key: "WEB-0", name: "Launch" }, children: [child], activity, comments: [comment], backlinks, relations, reactions, currentActorId: USER, cursor: 42 };

/** Reads the stores the detail registers into, so the test can assert on them without hooks. */
function Probe() {
  const context = useCommandContext();
  const entityLabels = useEntityLabels();
  return createElement("output", { "data-testid": "probe", "data-item": context?.item.key ?? "", "data-actions": Object.keys(context?.actions ?? {}).join(","), "data-label": entityLabels.get(ITEM) ?? "" });
}

type Host = "peek" | "modal" | "page";

function tree(host: Host, extra: ReactNode = null) {
  const detail = createElement(WorkItemDetail, { data, host, onClose: vi.fn(), onHostChange: vi.fn(), onOpenItem: vi.fn() });
  // createElement's typing wants `children` in the props object, the lint rule wants it as an argument; the cast satisfies both.
  const providerProps = { bundle } as ComponentProps<typeof ProjectProvider>;
  return createElement(ProjectProvider, providerProps, createElement(Fragment, null, detail, extra));
}

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

describe("WorkItemDetail", () => {
  it.each<Host>(["peek", "modal", "page"])("renders every section for the %s host", async (host) => {
    const el = await render(tree(host));
    const text = el.textContent ?? "";
    expect(text).toContain("WEB-1");
    expect(text).toContain("Set up hosting");
    expect(text).toContain("Website");
    expect(text).toContain("WEB-0");
    expect(text).toContain("Sub-items (1)");
    expect(text).toContain("WEB-2");
    expect(text).toContain("Pick a provider");
    expect(text).toContain("Links (1)");
    // The loader's comments reach the timeline (collaboration.spec) and the embedding pages list under "Mentioned in" (decision 44).
    expect(text).toContain("A comment from the loader");
    expect(text).toContain("Mentioned in (1)");
    // Relations (decision 55) after the sub-items and reactions (decision 57) under the description, on every host.
    expect(el.querySelector('ul[aria-label="Blocked by"]')?.textContent).toContain("Order the domain");
    expect(text).toContain("Relations (1)");
    expect(Array.from(el.querySelectorAll("button")).some((button) => button.textContent?.trim() === "Add relation")).toBe(true);
    expect(el.querySelector('button[aria-label="thumbs up reaction, 1"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(el.querySelector('[role="group"][aria-label="Reactions to the description"] button[aria-label="Add reaction"]')).not.toBeNull();
    expect(el.querySelector(`a[href="/projects/${PROJECT}/pages/${PAGE}"]`)?.textContent).toBe("Launch notes");
    expect(text).toContain("docs.example.com");
    expect(text).toContain("changed the state from Backlog to In progress");
    expect(text).toContain("created this work item");
    expect(text).toContain("Unsubscribe");
    for (const name of ["state", "priority", "assignees", "labels", "cycle", "modules", "parent"]) {
      expect(el.querySelector(`[data-property="${name}"]`), name).not.toBeNull();
    }
    expect(el.querySelector('[data-property="state"] button')).not.toBeNull();
    expect(el.querySelector(".tessera-detail--" + host)).not.toBeNull();
    expect(el.querySelector(`a[href="https://docs.example.com/spec"][target="_blank"]`)).not.toBeNull();
  });

  it("shows the close control for the peek only when a close handler exists, and the mode menu", async () => {
    const el = await render(tree("peek"));
    expect(el.querySelector('button[aria-label="Close"]')).not.toBeNull();
    const trigger = el.querySelector<HTMLButtonElement>('button[aria-label="Open as"]');
    expect(trigger?.getAttribute("aria-haspopup")).toBe("menu");
    await act(async () => {
      trigger?.click();
    });
    const modes = [...document.querySelectorAll('[role="menuitemradio"]')].map((row) => [row.textContent?.trim(), row.getAttribute("aria-checked")]);
    expect(modes).toEqual([
      ["Side panel", "true"],
      ["Modal", "false"],
      ["Full page", "false"],
    ]);
  });

  it("registers the command context and the recents label", async () => {
    const el = await render(tree("page", createElement(Probe)));
    const probe = el.querySelector('[data-testid="probe"]');
    expect(probe?.getAttribute("data-item")).toBe("WEB-1");
    expect(probe?.getAttribute("data-label")).toBe("WEB-1 Set up hosting");
    const actions = (probe?.getAttribute("data-actions") ?? "").split(",");
    for (const id of ["item.state", "item.priority", "item.assign", "item.assignMe", "item.labels", "item.subscribe", "item.delete", "item.copyId", "item.copyTitle", "item.copyUrl"]) {
      expect(actions).toContain(id);
    }
  });

  it("turns the title into an input on click and saves a changed name on Enter", async () => {
    const el = await render(tree("page"));
    const heading = el.querySelector<HTMLElement>("h1.tessera-detail-title");
    expect(heading).not.toBeNull();
    await act(async () => {
      heading?.click();
    });
    const input = el.querySelector<HTMLInputElement>(".tessera-detail-title-input input, input[aria-label='Title']");
    expect(input).not.toBeNull();
    expect(input?.value).toBe("Set up hosting");
    // React listens for the native input event on the element's value setter.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(input, "Set up hosting on Fly");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(updateWorkItemAction).toHaveBeenCalledWith({ work_item_id: ITEM, name: "Set up hosting on Fly" });
    expect(el.querySelector("h1.tessera-detail-title")).not.toBeNull();
  });

  it("keeps the title a heading (h1 on the page, h2 elsewhere) and edits it from the Edit title button", async () => {
    const page = await render(tree("page"));
    const heading = page.querySelector<HTMLElement>("h1.tessera-detail-title");
    expect(heading?.getAttribute("role")).toBeNull();
    expect(heading?.getAttribute("aria-label")).toBeNull();
    expect(heading?.textContent).toBe("Set up hosting");
    const edit = page.querySelector<HTMLButtonElement>('button[aria-label="Edit title"]');
    expect(edit).not.toBeNull();
    await act(async () => {
      edit?.click();
    });
    expect(page.querySelector(".tessera-detail-title-input input, input[aria-label='Title']")).not.toBeNull();
    await act(async () => {
      root?.unmount();
    });
    root = null;
    container?.remove();
    const peek = await render(tree("peek"));
    expect(peek.querySelector("h2.tessera-detail-title")?.textContent).toBe("Set up hosting");
  });

  /** Opens the header's More menu and returns its rows; the sub-item and link menus have labels of their own. */
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

  it("lists the More menu as copy, copy ID, archive (disabled with the reason on an open item) and delete", async () => {
    const el = await render(tree("page"));
    const rows = await moreMenuRows(el);
    expect(rows.map(rowLabel)).toEqual(["Make a copy", "Copy to project…", "Move to project…", "Copy ID (WEB-1)", "Version history", "Archive", "Delete…"]);
    const archive = rows[5];
    expect(archive?.getAttribute("aria-disabled")).toBe("true");
    expect(archive?.textContent).toContain(ARCHIVE_OPEN_ITEM_REASON);
    expect(el.textContent).not.toContain("This work item is archived");
  });

  it("archives a completed item from the More menu", async () => {
    const done: State = { ...states[1], id: STATE_DONE, name: "Done", name_key: "done", state_group: "completed", sort_order: "a2" };
    const completed = { ...data, item: { ...item, state_id: STATE_DONE } };
    const providerProps = { bundle: { ...bundle, states: [...states, done] } } as ComponentProps<typeof ProjectProvider>;
    vi.mocked(archiveWorkItemAction).mockClear();
    const el = await render(createElement(ProjectProvider, providerProps, createElement(WorkItemDetail, { data: completed, host: "page", onOpenItem: vi.fn() })));
    const archive = (await moreMenuRows(el)).find((row) => rowLabel(row) === "Archive");
    expect(archive?.getAttribute("aria-disabled")).not.toBe("true");
    await act(async () => {
      archive?.click();
    });
    expect(archiveWorkItemAction).toHaveBeenCalledWith({ work_item_id: ITEM });
  });

  it("shows an archived item's Banner and offers Restore instead of copy and archive", async () => {
    const archived = { ...data, item: { ...item, archived_at: NOW } };
    const providerProps = { bundle } as ComponentProps<typeof ProjectProvider>;
    vi.mocked(unarchiveWorkItemAction).mockClear();
    const el = await render(createElement(ProjectProvider, providerProps, createElement(WorkItemDetail, { data: archived, host: "page", onOpenItem: vi.fn() })));
    expect(el.textContent).toContain("This work item is archived");
    const rows = await moreMenuRows(el);
    expect(rows.map(rowLabel)).toEqual(["Copy ID (WEB-1)", "Version history", "Restore", "Delete…"]);
    await act(async () => {
      rows.find((row) => rowLabel(row) === "Restore")?.click();
    });
    expect(unarchiveWorkItemAction).toHaveBeenCalledWith({ work_item_id: ITEM });
  });

  it("shows an archived item's sub-items and links without any write control", async () => {
    const archived = { ...data, item: { ...item, archived_at: NOW } };
    const providerProps = { bundle } as ComponentProps<typeof ProjectProvider>;
    const el = await render(createElement(ProjectProvider, providerProps, createElement(WorkItemDetail, { data: archived, host: "page", onOpenItem: vi.fn() })));
    const text = el.textContent ?? "";
    expect(text).toContain("WEB-2");
    expect(text).toContain("docs.example.com");
    // Relations and reactions stay readable on an archived item, without a way to change them.
    expect(el.querySelector('ul[aria-label="Blocked by"]')?.textContent).toContain("Order the domain");
    expect(el.querySelector('button[aria-label="thumbs up reaction, 1"]')?.hasAttribute("disabled")).toBe(true);
    for (const label of ["Add sub-item", "Add link", "Add relation", "Add reaction", "Remove relation to WEB-7", "Options for WEB-2", "Edit title"]) {
      expect(el.querySelector(`button[aria-label="${label}"]`), label).toBeNull();
      expect(Array.from(el.querySelectorAll("button")).some((button) => button.textContent?.trim() === label), label).toBe(false);
    }
    expect(el.querySelector('button[aria-label^="Link options"]')).toBeNull();
    // The sub-item still opens.
    expect(Array.from(el.querySelectorAll("button")).some((button) => button.textContent?.trim() === "WEB-2")).toBe(true);
  });
});

/** Exposes the hook's latest result to the test through a module variable (set after each commit). */
let harnessActions: DetailActions | null = null;
function Harness() {
  const actions = useDetailActions(item, USER);
  useEffect(() => {
    harnessActions = actions;
  });
  return createElement("output", { "data-testid": "harness", "data-start": actions.view.start_date ?? "", "data-labels": actions.view.label_ids.join(",") });
}

function current(): DetailActions {
  if (!harnessActions) throw new Error("harness not mounted");
  return harnessActions;
}

describe("useDetailActions", () => {
  it("drops a value the control re-fires and a date the input reports twice", async () => {
    await render(createElement(Harness));
    vi.mocked(updateWorkItemAction).mockClear();
    await act(async () => {
      current().update({ state_id: item.state_id });
    });
    expect(updateWorkItemAction).not.toHaveBeenCalled();
    await act(async () => {
      current().update({ start_date: "2026-10-20" });
      current().update({ start_date: "2026-10-20" });
    });
    expect(updateWorkItemAction).toHaveBeenCalledTimes(1);
    expect(updateWorkItemAction).toHaveBeenCalledWith({ work_item_id: ITEM, start_date: "2026-10-20" });
  });

  it("shows a pending write in the view and rolls it back when the action fails", async () => {
    const el = await render(createElement(Harness));
    const failed = { ok: false as const, code: "INTERNAL" as const, message: "Disk full" };
    let settle: (value: typeof failed) => void = () => {};
    vi.mocked(setLabelsAction).mockImplementationOnce(() => new Promise<typeof failed>((resolve) => (settle = resolve)));
    await act(async () => {
      current().setLabels([LABEL, "label-2"]);
    });
    const output = () => el.querySelector('[data-testid="harness"]');
    expect(output()?.getAttribute("data-labels")).toBe(`${LABEL},label-2`);
    expect(setLabelsAction).toHaveBeenLastCalledWith({ work_item_id: ITEM, label_ids: [LABEL, "label-2"] });
    await act(async () => {
      settle(failed);
    });
    expect(output()?.getAttribute("data-labels")).toBe(LABEL);
  });

  it("assigns the current actor once and toggles the subscription off for a subscriber", async () => {
    await render(createElement(Harness));
    vi.mocked(setAssigneesAction).mockClear();
    await act(async () => {
      current().assignMe();
      current().assignMe();
    });
    expect(setAssigneesAction).toHaveBeenCalledTimes(1);
    expect(setAssigneesAction).toHaveBeenCalledWith({ work_item_id: ITEM, actor_ids: [USER] });
    await act(async () => {
      current().toggleSubscribe();
    });
    expect(unsubscribeWorkItemAction).toHaveBeenCalledWith({ work_item_id: ITEM });
  });
});

describe("command context actions", () => {
  it("opens the rail's state control and keeps a picker per property", async () => {
    let context: ReturnType<typeof useCommandContext> = null;
    function Capture() {
      const value = useCommandContext();
      useEffect(() => {
        context = value;
      });
      return null;
    }
    const el = await render(tree("peek", createElement(Capture)));
    const stateButton = el.querySelector<HTMLButtonElement>('[data-property="state"] button');
    expect(stateButton).not.toBeNull();
    await act(async () => {
      context?.actions["item.state"]?.();
    });
    expect(document.activeElement).toBe(stateButton);
    for (const name of ["priority", "assignees", "labels", "cycle", "modules"]) {
      expect(el.querySelector(`[data-property="${name}"] button`), name).not.toBeNull();
    }
  });

  it("keeps an accessible label on the date inputs and shows their placeholder", async () => {
    const el = await render(tree("page"));
    for (const name of ["start_date", "target_date"]) {
      const label = el.querySelector(`[data-property="${name}"] label`);
      // isLabelHidden: Astryx clips the label to 1px (checked in the browser), the rail's own label is the visible one.
      expect(label, name).not.toBeNull();
      expect(el.querySelector(`[data-property="${name}"] input`)?.getAttribute("placeholder")).toMatch(/^No (start|target) date$/);
    }
  });
});

describe("DescriptionEditor banners", () => {
  function fakeSave(state: Partial<SaveResult["state"]>): SaveResult {
    return {
      state: { status: "clean", version: 1, conflict: null, theirs: null, lossy: null, error: null, ...state },
      onChange: vi.fn(),
      flush: vi.fn(async () => {}),
      refreshIfSaved: vi.fn(),
      keepMine: vi.fn(async () => {}),
      loadTheirs: vi.fn(),
      editAnyway: vi.fn(),
      viewSource: vi.fn(),
      onLossyParse: vi.fn(),
    };
  }

  const buttonByText = (root: HTMLElement, text: string) => Array.from(root.querySelectorAll("button")).find((button) => button.textContent?.trim() === text) ?? null;

  afterEach(() => {
    saveOverride.current = null;
  });

  it("shows Changed elsewhere on CONFLICT with Keep mine and Load theirs wired to the queue", async () => {
    const save = fakeSave({ status: "conflict", conflict: { current_version: 2 } });
    saveOverride.current = save;
    const el = await render(tree("page"));
    const description = el.querySelector<HTMLElement>(".tessera-detail-description");
    expect(description?.textContent).toContain("Changed elsewhere");
    expect(description?.textContent).toContain("Someone else saved this description while you were editing.");
    expect(description?.textContent).toContain("Not saved");
    await act(async () => {
      buttonByText(description ?? el, "Keep mine")?.click();
    });
    expect(save.keepMine).toHaveBeenCalledTimes(1);
    await act(async () => {
      buttonByText(description ?? el, "Load theirs")?.click();
    });
    expect(save.loadTheirs).toHaveBeenCalledTimes(1);
  });

  it("shows Updated elsewhere when newer server text arrives during an edit, and nothing once clean", async () => {
    saveOverride.current = fakeSave({ status: "dirty", theirs: { version: 3, text: "Theirs" } });
    const el = await render(tree("peek"));
    expect(el.querySelector(".tessera-detail-description")?.textContent).toContain("Updated elsewhere");
    expect(buttonByText(el, "Keep mine")).not.toBeNull();
    saveOverride.current = fakeSave({ status: "clean" });
    await act(async () => {
      root?.render(tree("peek"));
    });
    const text = el.querySelector(".tessera-detail-description")?.textContent ?? "";
    expect(text).not.toContain("elsewhere");
    expect(text).toContain("Saved");
  });
});

describe("RelativeTime", () => {
  it("leaves the slot empty in the server HTML and fills it after hydration without a mismatch", async () => {
    const { renderToString } = await import("react-dom/server");
    const { hydrateRoot } = await import("react-dom/client");
    const { RelativeTime } = await import("@/components/detail/RelativeTime");
    const element = createElement("p", null, createElement(RelativeTime, { value: NOW }));
    const html = renderToString(element);
    expect(html).not.toContain("<time");
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    const errors: unknown[] = [];
    const roots: Root[] = [];
    await act(async () => {
      roots.push(hydrateRoot(host, element, { onRecoverableError: (error) => void errors.push(error) }));
    });
    expect(errors).toEqual([]);
    expect(host.querySelector("time")?.getAttribute("datetime")).toBe(NOW);
    await act(async () => {
      for (const hydrated of roots) hydrated.unmount();
    });
    host.remove();
  });
});

describe("PeekHost", () => {
  const LIST = "/projects/p/work-items";
  const peekUrl = `${LIST}?peek=${ITEM}`;

  async function host() {
    const { PeekHost } = await import("@/components/detail/PeekHost");
    const providerProps = { bundle } as ComponentProps<typeof ProjectProvider>;
    // children go in as the third argument; the cast covers the props object without them.
    const hostProps = { projectId: PROJECT, peek: { id: ITEM, data } } as ComponentProps<typeof PeekHost>;
    return createElement(
      ProjectProvider,
      providerProps,
      createElement(PeekHost, hostProps, createElement("output", { "data-testid": "list" })),
    );
  }

  beforeAll(() => {
    // The Dialog's scroll lock restores the scroll position; jsdom does not implement scrolling.
    window.scrollTo = () => {};
    // jsdom has no modal dialogs; the Dialog only needs the calls to exist.
    const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
    if (typeof proto.showModal !== "function") {
      proto.showModal = function showModal(this: HTMLDialogElement) {
        this.setAttribute("open", "");
      };
    }
    if (typeof proto.close !== "function") {
      proto.close = function close(this: HTMLDialogElement) {
        this.removeAttribute("open");
      };
    }
  });

  afterEach(async () => {
    const { savePeekPrefs } = await import("@/components/detail/peek-prefs");
    savePeekPrefs({ mode: "side" });
    window.sessionStorage.clear();
    nav.pathname = LIST;
    nav.search = "";
    nav.router.back.mockClear();
    nav.router.replace.mockClear();
  });

  it("moves the same mounted detail between the side panel and the modal", async () => {
    nav.search = `peek=${ITEM}`;
    await render(await host());
    const detail = document.querySelector(".tessera-detail");
    expect(detail?.classList.contains("tessera-detail--peek")).toBe(true);
    expect(detail?.closest('[role="complementary"]')).not.toBeNull();
    expect(detail?.closest(".tessera-peek-card")).not.toBeNull();
    const nextFrame = () => new Promise((resolve) => window.requestAnimationFrame(() => resolve(null)));
    // Picks a mode from the header's "Open as" menu, as a pointer user would.
    const chooseMode = async (label: string) => {
      const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="Open as"]');
      await act(async () => {
        trigger?.focus();
        trigger?.click();
      });
      const row = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((element) => element.textContent?.trim() === label);
      await act(async () => {
        row?.focus();
        row?.click();
        await nextFrame();
      });
      return trigger;
    };
    const modalTrigger = await chooseMode("Modal");
    // Same element: React kept the instance (a remount would build a new one), only the chrome around it changed.
    expect(document.querySelector(".tessera-detail")).toBe(detail);
    expect(detail?.classList.contains("tessera-detail--modal")).toBe(true);
    expect(detail?.closest("dialog")).not.toBeNull();
    // Focus goes back to the menu's trigger, which moved with the detail.
    expect(document.activeElement).toBe(modalTrigger);
    const sideTrigger = await chooseMode("Side panel");
    expect(document.querySelector(".tessera-detail")).toBe(detail);
    expect(detail?.closest("dialog")).toBeNull();
    expect(detail?.closest('[role="complementary"]')).not.toBeNull();
    expect(document.activeElement).toBe(sideTrigger);
  });

  it("closes with Back when the list pushed the peek entry, and with a replace otherwise", async () => {
    const { notePeekPush } = await import("@/components/detail/peek-history");
    nav.search = `peek=${ITEM}`;
    notePeekPush(LIST, peekUrl);
    window.history.pushState(null, "", peekUrl);
    await render(await host());
    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click();
    });
    expect(nav.router.back).toHaveBeenCalledTimes(1);
    expect(nav.router.replace).not.toHaveBeenCalled();

    // Opened from a shared link or after the filters changed: no record of a push (the close above cleared it), so the list URL
    // replaces the entry. The first panel is still leaving, and a second close while it leaves does nothing, so a fresh host
    // stands for this second open.
    await act(async () => root?.unmount());
    container?.remove();
    nav.router.back.mockClear();
    await render(await host());
    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click();
    });
    expect(nav.router.back).not.toHaveBeenCalled();
    expect(nav.router.replace).toHaveBeenCalledWith(LIST, { scroll: false });
  });

  it("closes the modal peek when a navigation hides its route, and opens it again when the route comes back", async () => {
    const { Activity } = await import("react");
    const { savePeekPrefs } = await import("@/components/detail/peek-prefs");
    savePeekPrefs({ mode: "modal" });
    nav.search = `peek=${ITEM}`;
    const element = await host();
    // Cache Components hides a route it leaves with <Activity mode="hidden">. The peek's Dialog comes from
    // @/components/shell/dialogs, which closes the native <dialog> in a layout-effect cleanup at hide time.
    // children go in as the third argument; the cast covers the props object without them.
    // The probe sits outside the route and reads the dialog in the layout phase of every commit, so it sees the
    // state the hide commit itself leaves, before any passive effect could close the dialog.
    const seen: Array<boolean | undefined> = [];
    const Probe = () => {
      useLayoutEffect(() => {
        seen.push(document.querySelector<HTMLDialogElement>('dialog[aria-label="Work item"]')?.open);
      });
      return null;
    };
    const frame = (mode: "visible" | "hidden") =>
      createElement(Fragment, null, createElement(Activity, { mode } as ComponentProps<typeof Activity>, element), createElement(Probe));
    await render(frame("visible"));
    const dialog = document.querySelector<HTMLDialogElement>('dialog[aria-label="Work item"]');
    expect(dialog?.open).toBe(true);

    // A link in the description (a cycle chip) navigates away: new URL, the work items route hidden in the same commit.
    nav.pathname = "/projects/p/cycles/c";
    nav.search = "";
    await act(async () => {
      root?.render(frame("hidden"));
    });
    // Still mounted (Activity keeps the DOM), but no longer open, so it cannot leave the next page inert.
    expect(dialog?.isConnected).toBe(true);
    expect(dialog?.open).toBe(false);
    expect(seen.at(-1)).toBe(false);

    // Back: the route shows again with its ?peek, and the Dialog's own effect opens it again.
    nav.pathname = LIST;
    nav.search = `peek=${ITEM}`;
    await act(async () => {
      root?.render(frame("visible"));
    });
    expect(document.querySelector('dialog[aria-label="Work item"]')).toBe(dialog);
    expect(dialog?.open).toBe(true);
  });

  it("records a loaded peek on a list of its project as a visit to the item's page, ahead of the list", async () => {
    const { RECENTS_STORAGE_KEY } = await import("@/components/shell/recents");
    window.localStorage.removeItem(RECENTS_STORAGE_KEY);
    const cycleList = `/projects/${PROJECT}/cycles/${CHILD}`;
    nav.pathname = cycleList;
    nav.search = `peek=${ITEM}`;
    await render(await host());
    const stored: unknown = JSON.parse(window.localStorage.getItem(RECENTS_STORAGE_KEY) ?? "[]");
    expect(stored).toEqual([`/projects/${PROJECT}/work-items/${ITEM}`, cycleList]);
  });

  it("records nothing for a peek outside its project's lists or one that shows not found", async () => {
    const { RECENTS_STORAGE_KEY } = await import("@/components/shell/recents");
    window.localStorage.removeItem(RECENTS_STORAGE_KEY);
    // LIST belongs to another project id than the host's.
    nav.search = `peek=${ITEM}`;
    await render(await host());
    expect(window.localStorage.getItem(RECENTS_STORAGE_KEY)).toBeNull();
  });

  it("renders a skeleton on the server and the detail after hydration, without a mismatch", async () => {
    const { renderToString } = await import("react-dom/server");
    const { hydrateRoot } = await import("react-dom/client");
    nav.search = `peek=${ITEM}`;
    const element = await host();
    const html = renderToString(element);
    expect(html).not.toContain("tessera-detail ");
    const hostEl = document.createElement("div");
    hostEl.innerHTML = html;
    document.body.append(hostEl);
    const errors: unknown[] = [];
    const roots: Root[] = [];
    await act(async () => {
      roots.push(hydrateRoot(hostEl, element, { onRecoverableError: (error) => void errors.push(error) }));
    });
    expect(errors).toEqual([]);
    expect(hostEl.querySelector(".tessera-detail")).not.toBeNull();
    await act(async () => {
      for (const hydrated of roots) hydrated.unmount();
    });
    hostEl.remove();
  });
});
