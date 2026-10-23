// @vitest-environment jsdom
/**
 * The Relations section of the work item detail (decision 55): rows grouped by
 * display type from the open item's side, the key that opens the related item
 * (a full-page link across projects), optimistic remove with a revert and a
 * toast on failure, the "Add relation" dialog (search any project, the item
 * itself left out, the picked hit added at once), and the read-only forms.
 * The model helpers are tested as pure functions. The Server Action wrappers,
 * the toast and the search route are mocked; jsdom has no layout.
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { RELATION_DISPLAY_TYPES } from "@/lib/tessera/schemas";

const ok = { ok: true as const, data: {}, cursor: 1 };
const toast = vi.hoisted(() => vi.fn());
const actions = vi.hoisted(() => ({ add: vi.fn(), remove: vi.fn() }));

vi.mock("@/app/actions/relations-comments", () => ({
  addRelationAction: actions.add,
  removeRelationAction: actions.remove,
  addReactionAction: vi.fn(),
  removeReactionAction: vi.fn(),
  createCommentAction: vi.fn(),
  updateCommentAction: vi.fn(),
  deleteCommentAction: vi.fn(),
}));
vi.mock("@astryxdesign/core/Toast", async (importOriginal) => ({ ...(await importOriginal<typeof import("@astryxdesign/core/Toast")>()), useToast: () => toast }));

const { RelationsList } = await import("@/components/detail/RelationsList");
const { RELATION_CHOICES, RELATION_LABELS, applyRelationEdit, groupRelations, optimisticRelationRow, toRelationCandidates } = await import("@/components/detail/relation-model");
type RelationRowView = import("@/components/detail/relation-model").RelationRowView;

const PROJECT = "11111111-1111-7111-8111-111111111111";
const OTHER_PROJECT = "11111111-1111-7111-8111-222222222222";
const ITEM = "22222222-2222-7222-8222-222222222222";

function row(id: string, relation_type: RelationRowView["relation_type"], key: string, overrides: Partial<RelationRowView["item"]> = {}): RelationRowView {
  return { id, relation_type, item: { id: `item-${id}`, key, name: `Name of ${key}`, project_id: PROJECT, archived: false, state: { name: "In progress", state_group: "started" }, ...overrides } };
}

const rows: RelationRowView[] = [
  row("r1", "blocked_by", "WEB-2"),
  row("r2", "relates_to", "WEB-3"),
  row("r3", "blocked_by", "OPS-7", { project_id: OTHER_PROJECT }),
  row("r4", "implements", "WEB-9", { archived: true, state: { name: "Done", state_group: "completed" } }),
];

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const onOpenItem = vi.fn();

async function mount(node: ReactNode): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(node);
  });
  return container;
}

function list(props: { relations?: RelationRowView[]; readOnly?: boolean } = {}) {
  return createElement(RelationsList, { workItemId: ITEM, projectId: PROJECT, relations: props.relations ?? rows, readOnly: props.readOnly, onOpenItem });
}

function buttonNamed(name: string): HTMLButtonElement | null {
  return [...document.querySelectorAll("button")].find((entry) => entry.getAttribute("aria-label") === name || entry.textContent?.trim() === name) ?? null;
}

async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => {
    (element as HTMLElement).click();
  });
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = () => {};
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
  document.body.replaceChildren();
  root = null;
  container = null;
  actions.add.mockReset();
  actions.remove.mockReset();
  toast.mockReset();
  onOpenItem.mockReset();
  vi.unstubAllGlobals();
});

describe("relation model", () => {
  it("offers every display type of the engine, each with its own wording", () => {
    expect(RELATION_CHOICES.map((choice) => choice.value)).toEqual([...RELATION_DISPLAY_TYPES]);
    expect(new Set(RELATION_CHOICES.map((choice) => choice.label)).size).toBe(RELATION_DISPLAY_TYPES.length);
    expect(RELATION_LABELS.blocked_by).toBe("Blocked by");
    expect(RELATION_LABELS.blocking).toBe("Blocking");
  });

  it("groups rows by display type in the picker's order and leaves empty types out", () => {
    const groups = groupRelations(rows);
    expect(groups.map((group) => [group.type, group.rows.map((entry) => entry.item.key)])).toEqual([
      ["blocked_by", ["WEB-2", "OPS-7"]],
      ["relates_to", ["WEB-3"]],
      ["implements", ["WEB-9"]],
    ]);
    expect(groupRelations([])).toEqual([]);
  });

  it("removes a row by id and lets an added row replace the item's earlier one", () => {
    expect(applyRelationEdit(rows, { kind: "remove", id: "r2" }).map((entry) => entry.id)).toEqual(["r1", "r3", "r4"]);
    const replaced = applyRelationEdit(rows, { kind: "add", row: { ...row("new", "blocking", "WEB-2"), item: { ...rows[0].item } } });
    expect(replaced.filter((entry) => entry.item.id === rows[0].item.id).map((entry) => entry.relation_type)).toEqual(["blocking"]);
    expect(replaced).toHaveLength(rows.length);
  });

  it("reads work item hits and ignores malformed rows and answers", () => {
    expect(
      toRelationCandidates({
        hits: [
          { type: "work_item", id: "a", project_id: "p", key: "WEB-1", title: "One", subtitle: "Web · Backlog", score: 1 },
          { type: "work_item", id: 7, title: "broken" },
          { type: "work_item", id: "b", title: "No key" },
        ],
      }),
    ).toEqual([
      { id: "a", key: "WEB-1", title: "One", project_id: "p", subtitle: "Web · Backlog" },
      { id: "b", key: "", title: "No key", project_id: null, subtitle: null },
    ]);
    expect(toRelationCandidates({ error: "q is required" })).toEqual([]);
    expect(toRelationCandidates(null)).toEqual([]);
  });

  it("builds the optimistic row in the picked project, or the open one when the hit has none", () => {
    const withProject = optimisticRelationRow("blocking", { id: "x", key: "OPS-1", title: "Ops", project_id: OTHER_PROJECT, subtitle: null }, PROJECT);
    expect(withProject.item.project_id).toBe(OTHER_PROJECT);
    expect(withProject.relation_type).toBe("blocking");
    expect(optimisticRelationRow("blocking", { id: "x", key: "OPS-1", title: "Ops", project_id: null, subtitle: null }, PROJECT).item.project_id).toBe(PROJECT);
  });
});

describe("RelationsList", () => {
  it("lists the rows in one named list per display type, with key, title, state and a remove button", async () => {
    await mount(list());
    const blocked = document.querySelector('ul[aria-label="Blocked by"]');
    expect(blocked?.querySelectorAll("li")).toHaveLength(2);
    expect(blocked?.textContent).toContain("WEB-2");
    expect(blocked?.textContent).toContain("Name of WEB-2");
    expect(document.querySelector('ul[aria-label="Relates to"]')?.textContent).toContain("WEB-3");
    expect(document.querySelector('ul[aria-label="Implements"]')?.textContent).toContain("Archived");
    expect(blocked?.querySelector('[role="img"][aria-label="In progress"], [aria-label="In progress"]')).not.toBeNull();
    expect(buttonNamed("Remove relation to WEB-2")).not.toBeNull();
    expect(document.body.textContent).toContain("Relations (4)");
  });

  it("opens an item of this project through onOpenItem and one of another project as a full-page link", async () => {
    await mount(list());
    await click(buttonNamed("WEB-2"));
    expect(onOpenItem).toHaveBeenCalledWith("item-r1");
    const other = [...document.querySelectorAll("a")].find((entry) => entry.textContent?.trim() === "OPS-7");
    expect(other?.getAttribute("href")).toBe(`/projects/${OTHER_PROJECT}/work-items/item-r3`);
  });

  it("with no relation renders the heading and the Add control only", async () => {
    await mount(list({ relations: [] }));
    expect(document.querySelectorAll("ul")).toHaveLength(0);
    expect(buttonNamed("Add relation")).not.toBeNull();
    expect(document.body.textContent).toContain("Relations");
    expect(document.body.textContent).not.toContain("Relations (");
  });

  it("is read-only on an archived item: rows open, nothing is added or removed, and an empty section vanishes", async () => {
    await mount(list({ readOnly: true }));
    expect(buttonNamed("Add relation")).toBeNull();
    expect(buttonNamed("Remove relation to WEB-2")).toBeNull();
    expect(buttonNamed("WEB-2")).not.toBeNull();
    await act(async () => {
      root?.render(list({ relations: [], readOnly: true }));
    });
    expect(container?.textContent).toBe("");
  });

  it("removes a row at once, then keeps it gone once the action succeeds", async () => {
    let finish: (value: typeof ok) => void = () => {};
    actions.remove.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await mount(list());
    await click(buttonNamed("Remove relation to WEB-3"));
    expect(actions.remove).toHaveBeenCalledWith({ work_item_id: ITEM, related_work_item_id: "item-r2" });
    expect(document.querySelector('ul[aria-label="Relates to"]')).toBeNull();
    await act(async () => finish(ok));
    expect(toast).not.toHaveBeenCalled();
  });

  it("puts the row back and toasts when the removal fails (decision 13)", async () => {
    let finish: (value: { ok: false; code: string; message: string }) => void = () => {};
    actions.remove.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await mount(list());
    await click(buttonNamed("Remove relation to WEB-3"));
    expect(document.querySelector('ul[aria-label="Relates to"]')).toBeNull();
    await act(async () => finish({ ok: false, code: "NOT_FOUND", message: "Relation not found" }));
    expect(document.querySelector('ul[aria-label="Relates to"]')?.textContent).toContain("WEB-3");
    expect(toast).toHaveBeenCalledWith({ type: "error", body: "Could not remove the relation: Relation not found" });
  });

  describe("Add relation", () => {
    const hits = [
      { type: "work_item", id: ITEM, project_id: PROJECT, key: "WEB-1", title: "The open item", subtitle: "Website · Backlog", score: 9 },
      { type: "work_item", id: "other-1", project_id: OTHER_PROJECT, key: "OPS-4", title: "Rotate keys", subtitle: "Ops · Todo", score: 8 },
    ];

    async function openDialogAndSearch(query: string) {
      const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => new Response(JSON.stringify({ hits }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      await click(buttonNamed("Add relation"));
      const dialog = document.querySelector("dialog[open]");
      expect(dialog?.getAttribute("aria-label")).toBe("Add relation");
      const input = dialog?.querySelector("input[type='text'], input:not([type])") as HTMLInputElement;
      expect(input).not.toBeNull();
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, query);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
      });
      return fetchMock;
    }

    it("searches every project, leaves the open item out and adds the picked hit with the default type", async () => {
      actions.add.mockResolvedValue(ok);
      await mount(list({ relations: [] }));
      const fetchMock = await openDialogAndSearch("keys");
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/search?q=keys&types=work_item&limit=8");
      const dialog = document.querySelector("dialog[open]") as HTMLDialogElement;
      expect(dialog.textContent).not.toContain("The open item");
      expect(dialog.textContent).toContain("Ops · Todo");
      // The key is part of the result's name, so a keyboard or screen-reader user can pick it by key (decision 55).
      const pick = [...dialog.querySelectorAll("button")].find((entry) => entry.textContent?.includes("OPS-4 Rotate keys"));
      expect(pick).toBeDefined();
      await click(pick ?? null);
      expect(actions.add).toHaveBeenCalledWith({ work_item_id: ITEM, related_work_item_id: "other-1", relation_type: "relates_to" });
      expect(document.querySelector("dialog[open]")).toBeNull();
    });

    it("shows the new row before the action answers and takes it back with a toast when it fails", async () => {
      let finish: (value: { ok: false; code: string; message: string }) => void = () => {};
      actions.add.mockReturnValue(new Promise((resolve) => (finish = resolve)));
      await mount(list({ relations: [] }));
      await openDialogAndSearch("keys");
      const dialog = document.querySelector("dialog[open]") as HTMLDialogElement;
      await click([...dialog.querySelectorAll("button")].find((entry) => entry.textContent?.includes("Rotate keys")) ?? null);
      expect(document.querySelector('ul[aria-label="Relates to"]')?.textContent).toContain("OPS-4");
      await act(async () => finish({ ok: false, code: "ARCHIVED", message: "Archived work items cannot be related" }));
      expect(document.querySelector('ul[aria-label="Relates to"]')).toBeNull();
      expect(toast).toHaveBeenCalledWith({ type: "error", body: "Could not add the relation: Archived work items cannot be related" });
    });
  });
});
