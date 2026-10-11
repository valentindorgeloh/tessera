/**
 * Power K and shortcuts (lane D4): the pure shortcut registry
 * (src/components/shell/shortcuts.ts), its quiet-target check and the
 * palette's search source (src/components/shell/command-source.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchHit } from "@/lib/tessera/types";
import type { CommandContextValue } from "@/components/shell/command-context";
import {
  buildCommands,
  createCommandSource,
  hitItemId,
  hitToItem,
  liveHighlight,
  matchesCommand,
  parseHitId,
  parseHits,
  searchUrl,
  shortcutHint,
  sortBySection,
  SECTION_ORDER,
  THEME_COMMANDS,
  themeCommandScheme,
  type CommandSearchItem,
  type FetchLike,
} from "@/components/shell/command-source";
import {
  CHORD_WINDOW_MS,
  formatKeys,
  isQuietTarget,
  isShortcutId,
  physicalCode,
  QUIET_POPUP_SELECTOR,
  resolveShortcut,
  SHORTCUT_BY_ID,
  SHORTCUTS,
  type KeyLike,
  type ShortcutContext,
  type ShortcutId,
  type ShortcutTargetLike,
} from "@/components/shell/shortcuts";

const ALL_IDS: ShortcutId[] = [
  "palette.open",
  "shortcuts.help",
  "peek.close",
  "item.state",
  "item.priority",
  "item.assign",
  "item.assignMe",
  "item.labels",
  "item.estimate",
  "item.cycle",
  "item.modules",
  "item.subscribe",
  "item.delete",
  "item.copyId",
  "item.copyTitle",
  "item.copyUrl",
  "create.workItem",
  "create.cycle",
  "create.module",
  "create.view",
  "create.page",
  "create.project",
  "nav.home",
  "nav.workItems",
  "nav.cycles",
  "nav.modules",
  "nav.views",
  "nav.pages",
  "nav.inbox",
  "nav.archives",
  "nav.settings",
  "nav.yourWork",
  "nav.analytics",
  "nav.projects",
  "nav.intake",
  "nav.drafts",
];

function key(code: string, mods: Partial<KeyLike> = {}): KeyLike {
  return { code, key: "", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods };
}

const MAC: ShortcutContext = { isMac: true, hasItem: true, isTyping: false, singleKeys: true };
const OTHER: ShortcutContext = { ...MAC, isMac: false };
const NOW = 10_000;

function action(id: ShortcutId) {
  return { kind: "action", id };
}

describe("SHORTCUTS", () => {
  it("lists every ShortcutId exactly once", () => {
    const ids = SHORTCUTS.map((def) => def.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...ALL_IDS].sort());
    for (const id of ALL_IDS) expect(SHORTCUT_BY_ID.get(id)?.id).toBe(id);
  });

  it("gives every shortcut unique keys and marks the work item ones as needing an item", () => {
    const keys = SHORTCUTS.map((def) => def.keys);
    expect(new Set(keys).size).toBe(keys.length);
    for (const def of SHORTCUTS) {
      expect(def.needsItem === true).toBe(def.id.startsWith("item."));
      expect(def.group === "Work item").toBe(def.id.startsWith("item."));
    }
  });

  it("recognises ids and rejects other strings", () => {
    expect(isShortcutId("nav.home")).toBe(true);
    expect(isShortcutId("hit:work_item:abc")).toBe(false);
    expect(isShortcutId("")).toBe(false);
  });
});

describe("resolveShortcut: work item keys", () => {
  it("resolves the single letters by code while an item is open", () => {
    expect(resolveShortcut(key("KeyS"), null, NOW, MAC)).toEqual(action("item.state"));
    expect(resolveShortcut(key("KeyP"), null, NOW, MAC)).toEqual(action("item.priority"));
    expect(resolveShortcut(key("KeyA"), null, NOW, MAC)).toEqual(action("item.assign"));
    expect(resolveShortcut(key("KeyI"), null, NOW, MAC)).toEqual(action("item.assignMe"));
    expect(resolveShortcut(key("KeyL"), null, NOW, MAC)).toEqual(action("item.labels"));
  });

  it("ignores event.key so the layout does not matter", () => {
    expect(resolveShortcut(key("KeyS", { key: "ы" }), null, NOW, MAC)).toEqual(action("item.state"));
    expect(resolveShortcut(key("Period", { key: "…", metaKey: true }), null, NOW, MAC)).toEqual(action("item.copyId"));
  });

  it("needs an open item", () => {
    const noItem = { ...MAC, hasItem: false };
    expect(resolveShortcut(key("KeyS"), null, NOW, noItem)).toBeNull();
    expect(resolveShortcut(key("Period", { metaKey: true }), null, NOW, noItem)).toBeNull();
  });

  it("tells shifted letters apart from plain ones", () => {
    expect(resolveShortcut(key("KeyE", { shiftKey: true }), null, NOW, MAC)).toEqual(action("item.estimate"));
    expect(resolveShortcut(key("KeyC", { shiftKey: true }), null, NOW, MAC)).toEqual(action("item.cycle"));
    expect(resolveShortcut(key("KeyM", { shiftKey: true }), null, NOW, MAC)).toEqual(action("item.modules"));
    expect(resolveShortcut(key("KeyS", { shiftKey: true }), null, NOW, MAC)).toEqual(action("item.subscribe"));
    expect(resolveShortcut(key("KeyE"), null, NOW, MAC)).toBeNull();
    expect(resolveShortcut(key("KeyP", { shiftKey: true }), null, NOW, MAC)).toBeNull();
  });

  it("uses the platform modifier for mod combos", () => {
    expect(resolveShortcut(key("Period", { metaKey: true }), null, NOW, MAC)).toEqual(action("item.copyId"));
    expect(resolveShortcut(key("Period", { ctrlKey: true }), null, NOW, MAC)).toBeNull();
    expect(resolveShortcut(key("Period", { ctrlKey: true }), null, NOW, OTHER)).toEqual(action("item.copyId"));
    expect(resolveShortcut(key("Period", { metaKey: true }), null, NOW, OTHER)).toBeNull();
  });

  it("resolves the shifted mod punctuation and both delete keys", () => {
    expect(resolveShortcut(key("Quote", { metaKey: true, shiftKey: true }), null, NOW, MAC)).toEqual(action("item.copyTitle"));
    expect(resolveShortcut(key("Comma", { metaKey: true, shiftKey: true }), null, NOW, MAC)).toEqual(action("item.copyUrl"));
    expect(resolveShortcut(key("Comma", { metaKey: true }), null, NOW, MAC)).toBeNull();
    expect(resolveShortcut(key("Delete", { metaKey: true }), null, NOW, MAC)).toEqual(action("item.delete"));
    expect(resolveShortcut(key("Backspace", { ctrlKey: true }), null, NOW, OTHER)).toEqual(action("item.delete"));
    expect(resolveShortcut(key("Backspace"), null, NOW, MAC)).toBeNull();
  });

  it("never matches alt combos, so alt+w stays with the tab bar", () => {
    expect(resolveShortcut(key("KeyS", { altKey: true }), null, NOW, MAC)).toBeNull();
    expect(resolveShortcut(key("KeyK", { metaKey: true, altKey: true }), null, NOW, MAC)).toBeNull();
    expect(resolveShortcut(key("KeyW", { altKey: true }), null, NOW, MAC)).toBeNull();
  });
});

describe("resolveShortcut: typing surfaces and the single-key switch", () => {
  const typing = { ...MAC, isTyping: true };

  it("lets only mod+k and mod+/ fire inside inputs", () => {
    expect(resolveShortcut(key("KeyK", { metaKey: true }), null, NOW, typing)).toEqual(action("palette.open"));
    expect(resolveShortcut(key("Slash", { metaKey: true }), null, NOW, typing)).toEqual(action("shortcuts.help"));
    expect(resolveShortcut(key("KeyS"), null, NOW, typing)).toBeNull();
    expect(resolveShortcut(key("Period", { metaKey: true }), null, NOW, typing)).toBeNull();
    expect(resolveShortcut(key("KeyG"), null, NOW, typing)).toBeNull();
  });

  it("keeps mod combos when single keys are off and drops letters and chords", () => {
    const off = { ...MAC, singleKeys: false };
    expect(resolveShortcut(key("KeyS"), null, NOW, off)).toBeNull();
    expect(resolveShortcut(key("KeyG"), null, NOW, off)).toBeNull();
    expect(resolveShortcut(key("KeyE", { shiftKey: true }), null, NOW, off)).toBeNull();
    expect(resolveShortcut(key("Period", { metaKey: true }), null, NOW, off)).toEqual(action("item.copyId"));
    expect(resolveShortcut(key("KeyK", { metaKey: true }), null, NOW, off)).toEqual(action("palette.open"));
  });

  it("never resolves Escape: PeekHost owns it", () => {
    expect(resolveShortcut(key("Escape", { key: "Escape" }), null, NOW, MAC)).toBeNull();
    expect(resolveShortcut(key("Escape", { key: "Escape" }), { prefix: "g", at: NOW }, NOW, MAC)).toBeNull();
  });
});

describe("resolveShortcut: chords", () => {
  it("starts a chord on g and n without modifiers", () => {
    expect(resolveShortcut(key("KeyG"), null, NOW, MAC)).toEqual({ kind: "chord", prefix: "g" });
    expect(resolveShortcut(key("KeyN"), null, NOW, { ...MAC, hasItem: false })).toEqual({ kind: "chord", prefix: "n" });
    expect(resolveShortcut(key("KeyG", { shiftKey: true }), null, NOW, MAC)).toBeNull();
    expect(resolveShortcut(key("KeyG", { metaKey: true }), null, NOW, MAC)).toBeNull();
  });

  it("completes g chords with the contract's letters", () => {
    const chord = { prefix: "g" as const, at: NOW };
    const table: Record<string, ShortcutId> = {
      KeyH: "nav.home",
      KeyI: "nav.workItems",
      KeyC: "nav.cycles",
      KeyM: "nav.modules",
      KeyV: "nav.views",
      KeyD: "nav.pages",
      KeyK: "nav.inbox",
      KeyR: "nav.archives",
      KeyS: "nav.settings",
      KeyJ: "nav.yourWork",
      KeyA: "nav.analytics",
      KeyP: "nav.projects",
      KeyX: "nav.intake",
      KeyY: "nav.drafts",
    };
    for (const [code, id] of Object.entries(table)) {
      expect(resolveShortcut(key(code), chord, NOW + 500, { ...MAC, hasItem: false })).toEqual(action(id));
    }
  });

  it("completes n chords with the contract's letters", () => {
    const chord = { prefix: "n" as const, at: NOW };
    const table: Record<string, ShortcutId> = {
      KeyI: "create.workItem",
      KeyC: "create.cycle",
      KeyM: "create.module",
      KeyV: "create.view",
      KeyD: "create.page",
      KeyP: "create.project",
    };
    for (const [code, id] of Object.entries(table)) {
      expect(resolveShortcut(key(code), chord, NOW + 999, MAC)).toEqual(action(id));
    }
  });

  it("drops an expired chord so the key resolves alone", () => {
    const chord = { prefix: "g" as const, at: NOW };
    expect(resolveShortcut(key("KeyH"), chord, NOW + CHORD_WINDOW_MS, MAC)).toEqual(action("nav.home"));
    expect(resolveShortcut(key("KeyH"), chord, NOW + CHORD_WINDOW_MS + 1, MAC)).toBeNull();
    expect(resolveShortcut(key("KeyS"), chord, NOW + CHORD_WINDOW_MS + 1, MAC)).toEqual(action("item.state"));
  });

  it("drops the chord on a key outside its table and resolves that key on its own", () => {
    const chord = { prefix: "n" as const, at: NOW };
    expect(resolveShortcut(key("KeyS"), chord, NOW + 10, MAC)).toEqual(action("item.state"));
    expect(resolveShortcut(key("KeyZ"), chord, NOW + 10, MAC)).toBeNull();
    expect(resolveShortcut(key("KeyG"), chord, NOW + 10, MAC)).toEqual({ kind: "chord", prefix: "g" });
  });

  it("ignores a shifted second key", () => {
    const chord = { prefix: "g" as const, at: NOW };
    expect(resolveShortcut(key("KeyH", { shiftKey: true }), chord, NOW + 10, MAC)).toBeNull();
  });

  it("does not complete a chord inside an input", () => {
    const chord = { prefix: "g" as const, at: NOW };
    expect(resolveShortcut(key("KeyH"), chord, NOW + 10, { ...MAC, isTyping: true })).toBeNull();
  });
});

describe("resolveShortcut: events without a code", () => {
  it("passes a real code through and maps an empty one from the key", () => {
    expect(physicalCode({ code: "KeyS", key: "ы" })).toBe("KeyS");
    expect(physicalCode({ code: "", key: "s" })).toBe("KeyS");
    expect(physicalCode({ code: "", key: "S" })).toBe("KeyS");
    expect(physicalCode({ code: "", key: "." })).toBe("Period");
    expect(physicalCode({ code: "", key: '"' })).toBe("Quote");
    expect(physicalCode({ code: "", key: "<" })).toBe("Comma");
    expect(physicalCode({ code: "", key: "Backspace" })).toBe("Backspace");
    expect(physicalCode({ code: "", key: "ы" })).toBe("");
    expect(physicalCode({ code: "", key: "Escape" })).toBe("");
  });

  it("still resolves letters, punctuation and chords from the key alone", () => {
    expect(resolveShortcut(key("", { key: "s" }), null, NOW, MAC)).toEqual(action("item.state"));
    expect(resolveShortcut(key("", { key: "S", shiftKey: true }), null, NOW, MAC)).toEqual(action("item.subscribe"));
    expect(resolveShortcut(key("", { key: ".", metaKey: true }), null, NOW, MAC)).toEqual(action("item.copyId"));
    expect(resolveShortcut(key("", { key: '"', metaKey: true, shiftKey: true }), null, NOW, MAC)).toEqual(action("item.copyTitle"));
    expect(resolveShortcut(key("", { key: "g" }), null, NOW, MAC)).toEqual({ kind: "chord", prefix: "g" });
    expect(resolveShortcut(key("", { key: "h" }), { prefix: "g", at: NOW }, NOW + 10, MAC)).toEqual(action("nav.home"));
  });

  it("resolves nothing when neither the code nor the key is known", () => {
    expect(resolveShortcut(key("", { key: "ы" }), null, NOW, MAC)).toBeNull();
    expect(resolveShortcut(key("", { key: "", metaKey: true }), null, NOW, MAC)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Quiet targets
// ---------------------------------------------------------------------------

type FakeNode = { tag: string; attrs?: Record<string, string>; editable?: boolean };

/** A target whose `closest` checks the attribute selectors of QUIET_POPUP_SELECTOR against itself and its ancestors. */
function target(self: FakeNode, ...ancestors: FakeNode[]): ShortcutTargetLike {
  const chain = [self, ...ancestors];
  const matches = (selector: string, node: FakeNode) => {
    const pairs = [...selector.matchAll(/\[([a-z-]+)="([^"]*)"\]/g)];
    return pairs.length > 0 && pairs.every(([, name, value]) => node.attrs?.[name] === value);
  };
  return {
    tagName: self.tag,
    isContentEditable: self.editable === true,
    closest: (selector: string) => chain.find((node) => selector.split(",").some((part) => matches(part.trim(), node))) ?? null,
  };
}

describe("isQuietTarget", () => {
  it("is quiet in inputs, textareas, selects and the contenteditable editor", () => {
    expect(isQuietTarget(target({ tag: "input" }))).toBe(true);
    expect(isQuietTarget(target({ tag: "TEXTAREA" }))).toBe(true);
    expect(isQuietTarget(target({ tag: "select" }))).toBe(true);
    expect(isQuietTarget(target({ tag: "p", editable: true }, { tag: "div", editable: true }))).toBe(true);
  });

  it("is quiet inside an open picker, its expanded trigger, a menu or the delete confirmation", () => {
    expect(isQuietTarget(target({ tag: "div", attrs: { role: "option" } }, { tag: "div", attrs: { role: "listbox" } }))).toBe(true);
    expect(isQuietTarget(target({ tag: "button", attrs: { role: "combobox", "aria-expanded": "true" } }))).toBe(true);
    expect(isQuietTarget(target({ tag: "div", attrs: { role: "menuitem" } }, { tag: "div", attrs: { role: "menu" } }))).toBe(true);
    expect(isQuietTarget(target({ tag: "button" }, { tag: "dialog", attrs: { role: "alertdialog" } }))).toBe(true);
  });

  it("lets shortcuts through on the page, a closed picker trigger and inside a plain dialog (the modal peek)", () => {
    expect(isQuietTarget(null)).toBe(false);
    expect(isQuietTarget(target({ tag: "body" }))).toBe(false);
    expect(isQuietTarget(target({ tag: "button", attrs: { role: "combobox", "aria-expanded": "false" } }))).toBe(false);
    expect(isQuietTarget(target({ tag: "button" }, { tag: "dialog", attrs: { role: "dialog" } }))).toBe(false);
    expect(isQuietTarget({ tagName: "BUTTON" })).toBe(false);
  });

  it("lists exactly the popups the dispatcher stays quiet in", () => {
    expect(QUIET_POPUP_SELECTOR.split(",").map((part) => part.trim())).toEqual([
      '[role="listbox"]',
      '[role="combobox"][aria-expanded="true"]',
      '[role="menu"]',
      '[role="alertdialog"]',
    ]);
  });
});

describe("formatKeys", () => {
  it("renders the platform modifier", () => {
    expect(formatKeys("mod+.", true)).toBe("⌘ .");
    expect(formatKeys("mod+.", false)).toBe("Ctrl .");
    expect(formatKeys("mod+shift+'", true)).toBe("⌘ ⇧ '");
    expect(formatKeys("mod+shift+'", false)).toBe("Ctrl Shift '");
  });

  it("names delete, letters and chords", () => {
    expect(formatKeys("mod+delete", true)).toBe("⌘ ⌫");
    expect(formatKeys("mod+delete", false)).toBe("Ctrl Del");
    expect(formatKeys("shift+e", false)).toBe("Shift E");
    expect(formatKeys("g h", true)).toBe("G then H");
    expect(formatKeys("escape", true)).toBe("Esc");
  });
});

// ---------------------------------------------------------------------------
// Command source
// ---------------------------------------------------------------------------

const PROJECT = "11111111-1111-7111-8111-111111111111";
const ITEM = "22222222-2222-7222-8222-222222222222";

const WEB_1: SearchHit = { type: "work_item", id: ITEM, project_id: PROJECT, key: "WEB-1", title: "Set up hosting", subtitle: "Backlog", score: 1000 };
const WEBSITE: SearchHit = { type: "project", id: PROJECT, project_id: PROJECT, key: "WEB", title: "Website", score: 80 };

const CONTEXT: CommandContextValue = {
  item: { id: ITEM, key: "WEB-1", title: "Set up hosting", projectId: PROJECT, url: `/projects/${PROJECT}/work-items/${ITEM}` },
  actions: { "item.state": () => undefined, "item.delete": () => undefined, "item.copyUrl": () => undefined },
};

function groupsOf(items: readonly CommandSearchItem[]): string[] {
  const seen: string[] = [];
  for (const item of items) {
    const group = item.auxiliaryData?.group;
    if (group && !seen.includes(group)) seen.push(group);
  }
  return seen;
}

describe("hit ids", () => {
  it("round-trips through hitItemId and parseHitId", () => {
    expect(hitItemId(WEB_1)).toBe(`hit:work_item:${ITEM}`);
    expect(parseHitId(hitItemId(WEB_1))).toEqual({ type: "work_item", id: ITEM });
    expect(parseHitId("nav.home")).toBeNull();
    expect(parseHitId("hit:thing:abc")).toBeNull();
    expect(parseHitId("hit:work_item:")).toBeNull();
  });

  it("labels a hit with its key and groups it by type", () => {
    expect(hitToItem(WEB_1)).toMatchObject({ id: `hit:work_item:${ITEM}`, label: "WEB-1 Set up hosting", auxiliaryData: { group: "Work items", kind: "hit" } });
    expect(hitToItem(WEBSITE).auxiliaryData?.group).toBe("Projects");
  });
});

describe("buildCommands", () => {
  it("offers create, navigate and settings without an item, in section order", () => {
    const items = buildCommands(null);
    expect(groupsOf(items)).toEqual(["Create", "Navigate", "Settings"]);
    expect(items.map((item) => item.id)).toContain("create.workItem");
    expect(items.map((item) => item.id)).toContain("nav.home");
    expect(items.map((item) => item.id)).not.toContain("palette.open");
    expect(items.map((item) => item.id)).not.toContain("peek.close");
    expect(items.map((item) => item.id)).not.toContain("item.state");
    const settings = items.filter((item) => item.auxiliaryData?.group === "Settings").map((item) => item.id);
    expect(settings).toEqual(["shortcuts.help", "nav.settings", "theme.dark", "theme.light", "theme.system"]);
  });

  it("offers the palette-only theme commands, labelled like the sidebar menu", () => {
    expect(THEME_COMMANDS.map((item) => item.label)).toEqual(["Theme: Frappé (dark)", "Theme: Latte (light)", "Theme: Match system"]);
    expect(THEME_COMMANDS.every((item) => item.auxiliaryData?.kind === "command" && item.auxiliaryData.keys === undefined)).toBe(true);
    expect(THEME_COMMANDS.some((item) => isShortcutId(item.id))).toBe(false);
    expect(THEME_COMMANDS.find((item) => matchesCommand(item, "frappe"))?.id).toBe("theme.dark");
    expect(THEME_COMMANDS.find((item) => matchesCommand(item, "latte"))?.id).toBe("theme.light");
  });

  it("maps a theme command id to its colour scheme and nothing else", () => {
    expect(themeCommandScheme("theme.dark")).toBe("dark");
    expect(themeCommandScheme("theme.light")).toBe("light");
    expect(themeCommandScheme("theme.system")).toBe("system");
    expect(themeCommandScheme("theme.sepia")).toBeNull();
    expect(themeCommandScheme("nav.settings")).toBeNull();
  });

  it("adds the registered item actions and the open-page command first", () => {
    const items = buildCommands(CONTEXT);
    expect(groupsOf(items)).toEqual(["Actions", "Create", "Navigate", "Settings"]);
    const actions = items.filter((item) => item.auxiliaryData?.group === "Actions").map((item) => item.id);
    expect(actions).toEqual(["item.state", "item.copyUrl", `open:${ITEM}`, "item.delete"]);
    const open = items.find((item) => item.id === `open:${ITEM}`);
    expect(open?.label).toBe("Open full page");
  });

  it("carries the keys and the arrival hint of a command", () => {
    const items = buildCommands(null);
    const view = items.find((item) => item.id === "create.view");
    expect(view?.auxiliaryData).toMatchObject({ kind: "command", keys: "n v", hint: "Arrives in P4" });
    const home = items.find((item) => item.id === "nav.home");
    expect(home?.auxiliaryData).toMatchObject({ kind: "command", keys: "g h", hint: undefined });
  });

  it("ships cycles, modules and archives in P3: no arrival hint, views arrive in P4", () => {
    const items = buildCommands(null);
    const hintOf = (id: string) => items.find((item) => item.id === id)?.auxiliaryData;
    expect(hintOf("create.cycle")).toMatchObject({ kind: "command", keys: "n c", hint: undefined });
    expect(hintOf("create.module")).toMatchObject({ kind: "command", keys: "n m", hint: undefined });
    expect(hintOf("nav.cycles")).toMatchObject({ kind: "command", keys: "g c", hint: undefined });
    expect(hintOf("nav.modules")).toMatchObject({ kind: "command", keys: "g m", hint: undefined });
    expect(hintOf("nav.archives")).toMatchObject({ kind: "command", keys: "g r", hint: undefined });
    expect(hintOf("nav.views")).toMatchObject({ kind: "command", keys: "g v", hint: "Arrives in P4" });
    expect(SHORTCUTS.some((def) => (def.arrives as string | undefined) === "P3")).toBe(false);
  });

  it("shows the subscribe note: the subscription works, notifications arrive in P7", () => {
    const items = buildCommands({ ...CONTEXT, actions: { "item.subscribe": () => undefined } });
    const subscribe = items.find((item) => item.id === "item.subscribe");
    expect(subscribe?.auxiliaryData).toMatchObject({ group: "Actions", kind: "command", keys: "shift+s", hint: "Notifications arrive in P7" });
  });

  it("labels an action from the context's state when the context gives a label (Subscribe / Unsubscribe)", () => {
    const actions = { "item.subscribe": () => undefined, "item.state": () => undefined };
    const subscribed = buildCommands({ ...CONTEXT, actions, labels: { "item.subscribe": "Unsubscribe" } });
    expect(subscribed.find((item) => item.id === "item.subscribe")?.label).toBe("Unsubscribe");
    expect(subscribed.find((item) => item.id === "item.state")?.label).toBe("Change state…");
    const plain = buildCommands({ ...CONTEXT, actions });
    expect(plain.find((item) => item.id === "item.subscribe")?.label).toBe("Subscribe or unsubscribe");
  });

  it("prefers the arrival over the note and gives nothing for a plain shortcut", () => {
    const subscribe = SHORTCUT_BY_ID.get("item.subscribe");
    const estimate = SHORTCUT_BY_ID.get("item.estimate");
    const state = SHORTCUT_BY_ID.get("item.state");
    expect(subscribe && shortcutHint(subscribe)).toBe("Notifications arrive in P7");
    expect(estimate && shortcutHint(estimate)).toBe("Arrives in P8");
    expect(state && shortcutHint(state)).toBeUndefined();
    expect(shortcutHint({ id: "nav.pages", label: "Pages", keys: "g d", group: "Navigate", arrives: "P6", note: "ignored" })).toBe("Arrives in P6");
  });
});

describe("matchesCommand and sortBySection", () => {
  const items = buildCommands(null);
  const byId = (id: string) => items.find((item) => item.id === id) as CommandSearchItem;

  it("matches the label and the keywords, case-insensitively", () => {
    expect(matchesCommand(byId("nav.home"), "HOME")).toBe(true);
    expect(matchesCommand(byId("create.workItem"), "issue")).toBe(true);
    expect(matchesCommand(byId("create.workItem"), "cycle")).toBe(false);
    expect(matchesCommand(byId("nav.home"), "  ")).toBe(true);
    expect(matchesCommand(hitToItem(WEB_1), "web-1")).toBe(true);
    expect(matchesCommand(hitToItem(WEB_1), "nope")).toBe(false);
  });

  it("orders sections by SECTION_ORDER and keeps the order inside a section", () => {
    const mixed = [byId("nav.home"), hitToItem(WEBSITE), byId("create.workItem"), hitToItem(WEB_1), byId("nav.projects")];
    const sorted = sortBySection(mixed);
    expect(groupsOf(sorted)).toEqual(["Work items", "Projects", "Create", "Navigate"]);
    expect(sorted.filter((item) => item.auxiliaryData?.group === "Navigate").map((item) => item.id)).toEqual(["nav.home", "nav.projects"]);
    expect(SECTION_ORDER[0]).toBe("Work items");
  });
});

describe("liveHighlight", () => {
  const rows = [{ disabled: false }, {}, { disabled: true }];

  it("keeps a highlight on an enabled row of the list", () => {
    expect(liveHighlight(0, rows)).toBe(0);
    expect(liveHighlight(1, rows)).toBe(1);
  });

  it("treats no highlight and a disabled row as none", () => {
    expect(liveHighlight(-1, rows)).toBe(-1);
    expect(liveHighlight(2, rows)).toBe(-1);
  });

  it("drops a hover highlight the narrowed list no longer reaches, so Enter opens the first result", () => {
    // Hovered row 1 of the bootstrap list, then typed "Sprint 2": one row is left.
    expect(liveHighlight(1, [{}])).toBe(-1);
    expect(liveHighlight(3, rows)).toBe(-1);
    expect(liveHighlight(0, [])).toBe(-1);
  });
});

describe("searchUrl and parseHits", () => {
  it("encodes the query, the limit and the scope", () => {
    expect(searchUrl("web 1", null)).toBe("/api/search?q=web+1&limit=20");
    expect(searchUrl("x", PROJECT, 8)).toBe(`/api/search?q=x&limit=8&scope=${PROJECT}`);
  });

  it("keeps well-formed hits and drops the rest", () => {
    expect(parseHits({ hits: [WEB_1, { type: "nope", id: "1", project_id: null, title: "x", score: 1 }, "junk"] })).toEqual([WEB_1]);
    expect(parseHits({ error: "bad" })).toEqual([]);
    expect(parseHits(null)).toEqual([]);
  });
});

describe("createCommandSource", () => {
  const ok = (body: unknown) => ({ ok: true, json: async () => body });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("bootstraps with the static commands and never fetches", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ok({ hits: [] }));
    const source = createCommandSource({ commands: () => buildCommands(null), scope: () => null, fetchImpl });
    const items = await source.bootstrap();
    expect(groupsOf(items)).toEqual(["Create", "Navigate", "Settings"]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("waits the debounce, fetches once with the scope and puts the hits before the commands", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ok({ hits: [WEB_1, WEBSITE] }));
    const source = createCommandSource({ commands: () => buildCommands(null), scope: () => PROJECT, fetchImpl });
    const pending = source.search("web");
    await vi.advanceTimersByTimeAsync(149);
    expect(fetchImpl).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(`/api/search?q=web&limit=20&scope=${PROJECT}`);
    expect(fetchImpl.mock.calls[0][1].cache).toBe("no-store");
    const items = await pending;
    expect(items[0].id).toBe(hitItemId(WEB_1));
    expect(items[1].id).toBe(hitItemId(WEBSITE));
    expect(groupsOf(items)).toEqual(["Work items", "Projects"]);
  });

  it("merges the commands whose label or keywords contain the query", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ok({ hits: [] }));
    const source = createCommandSource({ commands: () => buildCommands(null), scope: () => null, fetchImpl });
    const pending = source.search("new");
    await vi.advanceTimersByTimeAsync(200);
    const ids = (await pending).map((item) => item.id);
    expect(ids).toContain("create.workItem");
    expect(ids).toContain("create.project");
    expect(ids).not.toContain("nav.home");
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/search?q=new&limit=20");
  });

  it("drops a superseded search before it fetches", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ok({ hits: [WEB_1] }));
    const source = createCommandSource({ commands: () => [], scope: () => null, fetchImpl });
    const first = source.search("w");
    const second = source.search("we");
    await vi.advanceTimersByTimeAsync(200);
    expect(await first).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/search?q=we&limit=20");
    expect((await second).map((item) => item.id)).toEqual([hitItemId(WEB_1)]);
  });

  it("aborts an in-flight request on cancel and resolves to nothing", async () => {
    const fetchImpl = vi.fn<FetchLike>(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    );
    const source = createCommandSource({ commands: () => buildCommands(null), scope: () => null, fetchImpl });
    const pending = source.search("web");
    await vi.advanceTimersByTimeAsync(150);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(false);
    source.cancel();
    expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
    expect(await pending).toEqual([]);
  });

  it("still returns the matching commands when the request fails", async () => {
    const failing = vi.fn<FetchLike>(async () => {
      throw new Error("offline");
    });
    const source = createCommandSource({ commands: () => buildCommands(null), scope: () => null, fetchImpl: failing });
    const pending = source.search("home");
    await vi.advanceTimersByTimeAsync(200);
    expect((await pending).map((item) => item.id)).toEqual(["nav.home"]);

    const notOk = vi.fn<FetchLike>(async () => ({ ok: false, json: async () => ({ error: "bad" }) }));
    const source2 = createCommandSource({ commands: () => buildCommands(null), scope: () => null, fetchImpl: notOk });
    const pending2 = source2.search("home");
    await vi.advanceTimersByTimeAsync(200);
    expect((await pending2).map((item) => item.id)).toEqual(["nav.home"]);
  });

  it("answers a blank query with the commands alone, without a request", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ok({ hits: [WEB_1] }));
    const source = createCommandSource({ commands: () => buildCommands(null), scope: () => null, fetchImpl });
    const items = await source.search("   ");
    expect(groupsOf(items)).toEqual(["Create", "Navigate", "Settings"]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
