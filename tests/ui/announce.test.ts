// @vitest-environment jsdom
/**
 * Screen-reader announcements (Astryx `useAnnounce`) and the entry animation of
 * banners that appear after load.
 *
 * What is pinned here:
 * - A status that the person's own action changes is spoken from that action's
 *   handler through ONE `useAnnounce({ hasReplace: true })` instance, and the
 *   visible status line carries no `aria-live` of its own (PageBodyEditor).
 *   "Saving…" that "Saved" overtakes within a frame is withdrawn, so only
 *   "Saved" is heard.
 * - A conflict says its words once, through its `role="alert"` Banner: the save
 *   status does not also say "Not saved", and a failed save is the toast's.
 * - A banner that is page content (loaded with the page) has no role and says
 *   nothing; a banner the switch brings in is announced from the switch's handler.
 * - The empty outcome of an editor suggestion search is spoken once, from the
 *   renderer's callbacks, and "Searching…" is not.
 * - EntryBanner: Astryx's `useEntryAnimation("slideDown")` through `xstyle`,
 *   decided where the banner mounts (null on the server and while hydrating).
 * Astryx writes a message into its polite or assertive live region one frame
 * after the call, which is why the helpers wait two frames.
 */
import { act, createElement, useImperativeHandle, type ReactNode, type Ref } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Banner } from "@astryxdesign/core/Banner";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => vi.fn());
const pageActions = vi.hoisted(() => ({ update: vi.fn() }));
const relationActions = vi.hoisted(() => ({ add: vi.fn(), remove: vi.fn() }));
const settingsActions = vi.hoisted(() => ({ update: vi.fn(), backup: vi.fn() }));

vi.mock("@astryxdesign/core/Toast", async (importOriginal) => ({ ...(await importOriginal<typeof import("@astryxdesign/core/Toast")>()), useToast: () => toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }));
vi.mock("@/app/actions/pages", () => ({ updatePageBodyAction: pageActions.update }));
vi.mock("@/app/actions/shell", () => ({ refreshAction: vi.fn() }));
vi.mock("@/app/actions/relations-comments", () => ({
  addRelationAction: relationActions.add,
  removeRelationAction: relationActions.remove,
  addReactionAction: vi.fn(),
  removeReactionAction: vi.fn(),
  createCommentAction: vi.fn(),
  updateCommentAction: vi.fn(),
  deleteCommentAction: vi.fn(),
}));
vi.mock("@/app/actions/maintenance", () => ({ createBackupAction: settingsActions.backup }));
vi.mock("@/app/actions/workspace-settings", () => ({ updateWorkspaceSettingsAction: settingsActions.update }));
vi.mock("@/components/workspace-settings/WorkspaceSettingsChrome", () => ({ WorkspaceSettingsChrome: ({ children }: { children: ReactNode }) => createElement("div", null, children) }));

// The Markdown editor is a textarea here: the page body only needs its change, its handle and its mount.
vi.mock("@/components/editor", async () => {
  const { createElement: h } = await import("react");
  type Handle = { setMarkdown: (text: string) => void; setMode: (mode: string) => void; isFocused: () => boolean; hasLocalEdits: () => boolean; getMarkdown: () => string };
  function MarkdownEditor({ ref, onChange, value }: { ref?: Ref<Handle>; onChange: (markdown: string) => void; value: string }) {
    useImperativeHandle(ref, () => ({ setMarkdown: () => {}, setMode: () => {}, isFocused: () => false, hasLocalEdits: () => false, getMarkdown: () => value }), [value]);
    return h("textarea", { "data-testid": "markdown-stub", defaultValue: value, onChange: (event: { target: { value: string } }) => onChange(event.target.value) });
  }
  return { DESCRIPTION_SAVE_DELAY_MS: 400, entityRoute: () => null, MarkdownEditor };
});

// Tiptap's renderer only draws inside a mounted EditorContent; this one draws into its own element and keeps the component's ref.
// Like Tiptap's (flushSync once the editor content is initialised), it has drawn, and the ref is set, when the constructor returns.
vi.mock("@tiptap/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tiptap/react")>();
  const { createElement: h } = await import("react");
  const { flushSync } = await import("react-dom");
  const { createRoot: makeRoot } = await import("react-dom/client");
  class FakeRenderer {
    ref: unknown = null;
    element = document.createElement("div");
    private root = makeRoot(this.element);
    constructor(
      private component: (props: never) => ReactNode,
      private options: { props: Record<string, unknown> },
    ) {
      this.draw();
    }
    private draw() {
      flushSync(() => {
        this.root.render(h(this.component as never, { ...this.options.props, ref: (value: unknown) => (this.ref = value) } as never));
      });
    }
    updateProps(props: Record<string, unknown>) {
      this.options.props = { ...this.options.props, ...props };
      this.draw();
    }
    destroy() {
      flushSync(() => this.root.unmount());
    }
  }
  return { ...actual, ReactRenderer: FakeRenderer };
});

const { EntryBanner } = await import("@/components/shared/EntryBanner");
const { PageBodyEditor } = await import("@/components/pages/PageBodyEditor");
const { BackupsScreen } = await import("@/components/backups/BackupsScreen");
const { RelationsList } = await import("@/components/detail/RelationsList");
const { buildEditorSuggestions } = await import("@/components/editor/mentions");

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const regionText = (politeness: "polite" | "assertive") => document.querySelector(`[data-astryx-live-region="${politeness}"]`)?.textContent ?? "";
/** Lets Astryx write what was announced (one frame after the call) and returns what the polite region holds. */
async function heard(politeness: "polite" | "assertive" = "polite"): Promise<string> {
  await act(async () => {
    await frame();
    await frame();
  });
  return regionText(politeness);
}
async function silence() {
  await heard();
  for (const region of document.querySelectorAll("[data-astryx-live-region]")) region.textContent = "";
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(node: ReactNode): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(node);
  });
  return container;
}

async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => {
    (element as HTMLElement).click();
  });
}

async function type(element: HTMLTextAreaElement | HTMLInputElement, value: string) {
  await act(async () => {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = () => {};
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  if (typeof proto.showModal !== "function") proto.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
  if (typeof proto.close !== "function") proto.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false });
  }
  if (typeof globalThis.ResizeObserver !== "function") {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }
  // Astryx's entry animation counts only what mounts after the first paint.
  await frame();
  await frame();
});

beforeEach(async () => {
  await silence();
});

afterEach(async () => {
  vi.useRealTimers();
  if (root) {
    const current = root;
    await act(async () => {
      current.unmount();
    });
  }
  container?.remove();
  document.body.querySelectorAll(":scope > :not([data-astryx-live-region])").forEach((node) => node.remove());
  root = null;
  container = null;
  toast.mockReset();
  pageActions.update.mockReset();
  relationActions.add.mockReset();
  relationActions.remove.mockReset();
  settingsActions.update.mockReset();
  settingsActions.backup.mockReset();
  vi.unstubAllGlobals();
});

const alerts = () => [...document.querySelectorAll('[role="alert"]')].filter((node) => !node.hasAttribute("data-astryx-live-region"));
const classesOf = (element: Element | null) => (element?.className ?? "").split(/\s+/).filter(Boolean);

describe("EntryBanner", () => {
  it("renders the same markup as a plain Banner on the server, so nothing moves on load", () => {
    const props = { status: "warning", title: "Changed elsewhere", role: "alert" } as const;
    expect(renderToString(createElement(EntryBanner, props))).toBe(renderToString(createElement(Banner, props)));
  });

  it("adds Astryx's slideDown classes when it mounts after the first paint, and keeps role and text", async () => {
    await mount(createElement(Banner, { id: "plain", status: "warning", title: "Changed elsewhere", role: "alert" }));
    const plain = classesOf(document.querySelector("#plain"));
    await act(async () => root?.unmount());
    container?.remove();
    await mount(createElement(EntryBanner, { id: "entry", status: "warning", title: "Changed elsewhere", role: "alert" }));
    const entry = document.querySelector("#entry");
    expect(entry).not.toBeNull();
    const classes = classesOf(entry);
    for (const name of plain) expect(classes).toContain(name);
    expect(classes.length).toBeGreaterThan(plain.length);
    expect(entry?.textContent).toContain("Changed elsewhere");
    expect(alerts()).toHaveLength(1);
  });

  it("is decided where the banner mounts: a banner that comes later animates even inside a screen that loaded earlier", async () => {
    function Screen({ show }: { show: boolean }) {
      return createElement("div", null, show ? createElement(EntryBanner, { id: "later", status: "warning", title: "Later" }) : null);
    }
    await mount(createElement(Screen, { show: false }));
    await act(async () => root?.render(createElement(Screen, { show: true })));
    const later = classesOf(document.querySelector("#later"));
    await act(async () => root?.render(createElement(Screen, { show: false })));
    await act(async () => root?.render(createElement(Banner, { id: "plain", status: "warning", title: "Later" })));
    expect(later.length).toBeGreaterThan(classesOf(document.querySelector("#plain")).length);
  });
});

describe("PageBodyEditor save status", () => {
  const editor = () => createElement(PageBodyEditor, { pageId: "pg-1", text: "Hello", version: 1 });
  const textarea = () => document.querySelector<HTMLTextAreaElement>('[data-testid="markdown-stub"]') as HTMLTextAreaElement;
  // Inside the editor's own container: Astryx's live regions hold the same words.
  const statusLine = () => [...(container?.querySelectorAll("p, span, div") ?? [])].find((node) => node.children.length === 0 && ["Saved", "Unsaved changes", "Saving…", "Not saved"].includes(node.textContent ?? ""));

  it("shows the status as plain text with no live region of its own", async () => {
    await mount(editor());
    const line = statusLine();
    expect(line?.textContent).toBe("Saved");
    expect(line?.closest("[aria-live]")).toBeNull();
    expect(line?.hasAttribute("aria-live")).toBe(false);
  });

  it("says nothing on load, 'Unsaved changes' once when typing starts, and only 'Saved' when the save lands", async () => {
    pageActions.update.mockResolvedValue({ ok: true, data: { description_version: 2 }, cursor: 1 });
    await mount(editor());
    expect(await heard()).toBe("");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await type(textarea(), "Hello there");
    expect(await heard()).toBe("Unsaved changes");
    // A second keystroke is the same status: nothing more is said.
    await silence();
    await type(textarea(), "Hello there, you");
    expect(await heard()).toBe("");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(pageActions.update).toHaveBeenCalledTimes(1);
    // "Saving…" and "Saved" come within a frame: the replacing instance withdraws the first.
    expect(await heard()).toBe("Saved");
    expect(statusLine()?.textContent).toBe("Saved");
  });

  it("answers a conflict with its alert Banner and says no 'Not saved' on top of it", async () => {
    pageActions.update.mockResolvedValue({ ok: false, code: "CONFLICT", message: "Changed", details: { current_version: 5 } });
    await mount(editor());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await type(textarea(), "Hello there");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    const spoken = await heard();
    expect(spoken).not.toContain("Not saved");
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0].textContent).toContain("Changed elsewhere");
    expect(statusLine()?.textContent).toBe("Not saved");
    expect(toast).not.toHaveBeenCalled();
  });

  it("leaves a failed save to its toast", async () => {
    pageActions.update.mockResolvedValue({ ok: false, code: "VALIDATION", message: "Body too long" });
    await mount(editor());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await type(textarea(), "Hello there");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(toast).toHaveBeenCalledWith({ type: "error", body: "Could not save the page: Body too long" });
    expect(await heard()).not.toContain("Not saved");
    expect(alerts()).toHaveLength(0);
  });
});

describe("BackupsScreen stale warning", () => {
  const NOW = "2026-11-09T12:00:00.000Z";
  // One manual copy keeps the table (an empty list shows Astryx's EmptyState, which announces itself); no automatic copy exists, so the warning is due.
  const manual = { path: "/b/manual.db", name: "manual.db", kind: "manual" as const, created_at: "2026-11-08T12:00:00.000Z", size: 2048, check: "ok" };
  const screen = (autoBackup: boolean) => createElement(BackupsScreen, { backups: [manual], autoBackup, now: NOW });
  const warning = () => [...document.querySelectorAll("*")].find((node) => node.children.length === 0 && node.textContent === "No recent automatic backup");

  it("is plain page content when the page loads with it: no role and nothing announced", async () => {
    await mount(screen(true));
    expect(warning()).toBeDefined();
    expect(alerts()).toHaveLength(0);
    expect(await heard()).toBe("");
  });

  it("is told from the switch's handler when turning daily backups on brings it in", async () => {
    settingsActions.update.mockResolvedValue({ ok: true, data: {}, cursor: 1 });
    await mount(screen(false));
    expect(warning()).toBeUndefined();
    await click(document.querySelector('[role="switch"]'));
    expect(settingsActions.update).toHaveBeenCalledWith({ auto_backup: true });
    expect(warning()).toBeDefined();
    expect(alerts()).toHaveLength(0);
    expect(await heard()).toBe("No recent automatic backup. The last automatic backup is older than 48 hours, or none exists yet.");
  });

  it("says nothing more when the switch goes off, or when the save is refused", async () => {
    settingsActions.update.mockResolvedValue({ ok: false, code: "VALIDATION", message: "No" });
    await mount(screen(false));
    await click(document.querySelector('[role="switch"]'));
    expect(toast).toHaveBeenCalledWith({ type: "error", body: "Could not update daily backups. No" });
    expect(await heard()).toBe("");
    expect(warning()).toBeUndefined();
  });
});

describe("RelationsList announcements", () => {
  const PROJECT = "11111111-1111-7111-8111-111111111111";
  const ITEM = "22222222-2222-7222-8222-222222222222";
  const related = { id: "r1", relation_type: "blocked_by" as const, item: { id: "item-r1", key: "WEB-2", name: "Name of WEB-2", project_id: PROJECT, archived: false, state: { name: "In progress", state_group: "started" as const } } };
  const list = (relations = [related]) => createElement(RelationsList, { workItemId: ITEM, projectId: PROJECT, relations, onOpenItem: vi.fn() });
  const buttonNamed = (name: string) => [...document.querySelectorAll("button")].find((entry) => entry.getAttribute("aria-label") === name || entry.textContent?.trim() === name) ?? null;

  it("tells a removal once the engine has taken it, and not a refused one (that is the toast's)", async () => {
    relationActions.remove.mockResolvedValue({ ok: true, data: {}, cursor: 1 });
    await mount(list());
    await click(buttonNamed("Remove relation to WEB-2"));
    expect(await heard()).toBe("Removed relation to WEB-2");

    await silence();
    relationActions.remove.mockResolvedValue({ ok: false, code: "NOT_FOUND", message: "Relation not found" });
    await act(async () => root?.render(list([related])));
    await click(buttonNamed("Remove relation to WEB-2"));
    expect(toast).toHaveBeenCalledWith({ type: "error", body: "Could not remove the relation: Relation not found" });
    expect(await heard()).toBe("");
  });

  it("tells an added relation with its wording and key", async () => {
    relationActions.add.mockResolvedValue({ ok: true, data: {}, cursor: 1 });
    const hits = [{ type: "work_item", id: "other-1", project_id: PROJECT, key: "OPS-4", title: "Rotate keys", subtitle: "Ops · Todo", score: 8 }];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ hits }), { status: 200 })));
    await mount(list([]));
    await click(buttonNamed("Add relation"));
    const dialog = document.querySelector("dialog[open]") as HTMLDialogElement;
    await type(dialog.querySelector("input") as HTMLInputElement, "keys");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    await click([...dialog.querySelectorAll("button")].find((entry) => entry.textContent?.includes("OPS-4 Rotate keys")) ?? null);
    expect(relationActions.add).toHaveBeenCalledTimes(1);
    expect(await heard()).toBe("Added relation: Relates to OPS-4");
  });
});

describe("suggestion popover empty outcome", () => {
  type View = NonNullable<ReturnType<NonNullable<ReturnType<typeof buildEditorSuggestions>["at"]["render"]>>>;
  const row = { id: "a1", label: "Nina Park" };
  const props = (items: unknown[], loading: boolean) => ({ editor: { view: { dom: document.createElement("div") } }, items, loading, mount: () => () => {}, command: vi.fn() }) as never;

  async function openList(view: View, items: unknown[], loading: boolean) {
    await act(async () => view.onStart?.(props(items, loading)));
  }
  async function update(view: View, items: unknown[], loading: boolean) {
    await act(async () => view.onUpdate?.(props(items, loading)));
  }

  it("speaks 'No one matches' once when a finished search has no row, and not 'Searching…'", async () => {
    const view = buildEditorSuggestions().at.render?.() as View;
    await openList(view, [], true);
    expect(await heard()).toBe("");
    expect(document.body.textContent).not.toContain("Searching…");
    await update(view, [], false);
    expect(await heard()).toBe("No one matches");
    // The next keystroke is still empty: the same words are not repeated.
    await silence();
    await update(view, [], false);
    expect(await heard()).toBe("");
    // Rows come back (the editor names the active option itself), then an empty result is news again.
    await update(view, [row], false);
    expect(await heard()).toBe("");
    await update(view, [], false);
    expect(await heard()).toBe("No one matches");
    await act(async () => view.onExit?.({} as never));
  });

  it("starts from an empty list when the trigger matches nothing at once", async () => {
    const view = buildEditorSuggestions().workItem.render?.() as View;
    await openList(view, [], false);
    expect(await heard()).toBe("No work items match");
    await act(async () => view.onExit?.({} as never));
  });

  it("has no role=status text left in the popover", () => {
    const source = readFileSync(join(process.cwd(), "src/components/editor/mentions.tsx"), "utf8");
    expect(source).not.toContain('role="status"');
    expect(source).not.toContain("aria-live");
  });
});

describe("where the hand-rolled live regions went", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

  it("PageBodyEditor and the suggestion popover use useAnnounce and keep no aria-live", () => {
    expect(read("src/components/pages/PageBodyEditor.tsx")).toContain("useAnnounce({ hasReplace: true })");
    expect(read("src/components/pages/PageBodyEditor.tsx")).not.toContain("aria-live");
    expect(read("src/components/editor/mentions.tsx")).toContain("useAnnounce({ hasReplace: true })");
  });

  it("every Banner that asks to be read (role=alert) is an EntryBanner, so it slides in", () => {
    for (const file of ["src/components/detail/DescriptionEditor.tsx", "src/components/pages/PageBodyEditor.tsx", "src/components/detail/CommentComposer.tsx", "src/components/history/VersionHistoryDialog.tsx"]) {
      const source = read(file);
      expect(source, file).toContain("<EntryBanner");
      expect(source, file).not.toMatch(/<Banner\b[^>]*role="alert"/);
    }
  });

  it("the version history panes and the activity feed are ScrollableAreas, and their CSS leaves overflow to the viewport", () => {
    const dialog = read("src/components/history/VersionHistoryDialog.tsx");
    for (const label of ["Versions", "Selected version", "Page activity"]) expect(dialog).toContain(`<ScrollableArea axis="block" label="${label}"`);
    const css = read("src/components/styles/history.css");
    for (const selector of [".tessera-history-pane", ".tessera-history-activity"]) {
      const body = new RegExp(`${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
      expect(body, selector).toMatch(/max-height:\s*70vh/);
      expect(body, selector).not.toMatch(/overflow/);
    }
  });

  it("the folded project tabs rely on Tooltip's own focus rule, not focusTrigger=\"always\"", () => {
    expect(read("src/components/work-items/ProjectFrame.tsx")).not.toMatch(/focusTrigger=/);
  });

  it("an EntryBanner adds no role of its own and passes no StyleX import into Tessera code", () => {
    const source = read("src/components/shared/EntryBanner.tsx").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(source).not.toMatch(/role=/);
    expect(source).not.toContain("@stylexjs");
    expect(source).not.toContain("stylex.create");
    expect(source).toContain('useEntryAnimation("slideDown")');
  });
});
