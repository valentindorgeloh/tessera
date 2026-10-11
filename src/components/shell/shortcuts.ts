/**
 * Shortcut registry of the Tessera shell (docs/contracts/ui.md "Power K and
 * shortcuts (D4)"). Pure: no React, no DOM, so Vitest exercises
 * `resolveShortcut` and `formatKeys` directly (tests/ui/shortcuts.test.ts).
 *
 * Matching is by `event.code` (the physical key) plus modifiers, never by
 * `event.key`: `mod+shift+'` and `mod+shift+,` would otherwise depend on the
 * keyboard layout. Only an event without a code (some virtual keyboards and
 * input tools send `code: ""`) falls back to its `key` (`physicalCode`). `mod` is the Command key on Apple platforms and Control
 * elsewhere; Alt combos and the other platform's modifier never match, so
 * `alt+w` (close tab) and browser shortcuts stay untouched. Chords (`g` then
 * `h`) have a `CHORD_WINDOW_MS` window and are dropped by any key outside
 * their table; that key then resolves on its own.
 *
 * Ownership: `palette.open` and `shortcuts.help` resolve here (also inside
 * inputs) but CommandBar dispatches them through Astryx `useHotkeys`, so the
 * dispatcher in ./useShortcuts.ts leaves them alone. `peek.close` is listed for
 * the help dialog only and never resolves: PeekHost owns Escape.
 */
import { isTypingTarget } from "./tab-registry";

export type ShortcutId =
  | "palette.open"
  | "shortcuts.help"
  | "peek.close"
  | "item.state"
  | "item.priority"
  | "item.assign"
  | "item.assignMe"
  | "item.labels"
  | "item.estimate"
  | "item.cycle"
  | "item.modules"
  | "item.subscribe"
  | "item.delete"
  | "item.copyId"
  | "item.copyTitle"
  | "item.copyUrl"
  | "create.workItem"
  | "create.cycle"
  | "create.module"
  | "create.view"
  | "create.page"
  | "create.project"
  | "nav.home"
  | "nav.workItems"
  | "nav.cycles"
  | "nav.modules"
  | "nav.views"
  | "nav.pages"
  | "nav.inbox"
  | "nav.archives"
  | "nav.settings"
  | "nav.yourWork"
  | "nav.analytics"
  | "nav.projects"
  | "nav.intake"
  | "nav.drafts";

export type ShortcutGroup = "Global" | "Work item" | "Create" | "Navigate";

export type ShortcutArrival = "P3" | "P5" | "P6" | "P7" | "P8" | "P9";

export type ShortcutDef = {
  id: ShortcutId;
  label: string;
  /** `mod+k`, `shift+e`, `mod+shift+'`, or a chord written with a space: `g h`. */
  keys: string;
  group: ShortcutGroup;
  /** Resolves only while a work item is open (a command context is registered). */
  needsItem?: boolean;
  /** The phase that ships the target; until then the shortcut shows "Arrives in P<n>". */
  arrives?: ShortcutArrival;
  /** A hint for a shortcut that works today but whose follow-up lands later (help dialog and palette). */
  note?: string;
};

/** Every shortcut of the shell in help-dialog order. */
export const SHORTCUTS: readonly ShortcutDef[] = [
  { id: "palette.open", label: "Open the command bar", keys: "mod+k", group: "Global" },
  { id: "shortcuts.help", label: "Keyboard shortcuts", keys: "mod+/", group: "Global" },
  { id: "peek.close", label: "Close the panel", keys: "escape", group: "Global" },

  { id: "item.state", label: "Change state…", keys: "s", group: "Work item", needsItem: true },
  { id: "item.priority", label: "Change priority…", keys: "p", group: "Work item", needsItem: true },
  { id: "item.assign", label: "Assign…", keys: "a", group: "Work item", needsItem: true },
  { id: "item.assignMe", label: "Assign to me", keys: "i", group: "Work item", needsItem: true },
  { id: "item.labels", label: "Labels…", keys: "l", group: "Work item", needsItem: true },
  { id: "item.estimate", label: "Estimate…", keys: "shift+e", group: "Work item", needsItem: true, arrives: "P8" },
  { id: "item.cycle", label: "Cycle…", keys: "shift+c", group: "Work item", needsItem: true },
  { id: "item.modules", label: "Modules…", keys: "shift+m", group: "Work item", needsItem: true },
  { id: "item.subscribe", label: "Subscribe or unsubscribe", keys: "shift+s", group: "Work item", needsItem: true, note: "Notifications arrive in P7" },
  { id: "item.delete", label: "Delete…", keys: "mod+delete", group: "Work item", needsItem: true },
  { id: "item.copyId", label: "Copy ID", keys: "mod+.", group: "Work item", needsItem: true },
  { id: "item.copyTitle", label: "Copy title", keys: "mod+shift+'", group: "Work item", needsItem: true },
  { id: "item.copyUrl", label: "Copy link", keys: "mod+shift+,", group: "Work item", needsItem: true },

  { id: "create.workItem", label: "New work item", keys: "n i", group: "Create" },
  { id: "create.cycle", label: "New cycle", keys: "n c", group: "Create", arrives: "P3" },
  { id: "create.module", label: "New module", keys: "n m", group: "Create", arrives: "P3" },
  { id: "create.view", label: "New view", keys: "n v", group: "Create", arrives: "P3" },
  { id: "create.page", label: "New page", keys: "n d", group: "Create", arrives: "P6" },
  { id: "create.project", label: "New project", keys: "n p", group: "Create" },

  { id: "nav.home", label: "Home", keys: "g h", group: "Navigate" },
  { id: "nav.workItems", label: "Work items", keys: "g i", group: "Navigate" },
  { id: "nav.cycles", label: "Cycles", keys: "g c", group: "Navigate", arrives: "P3" },
  { id: "nav.modules", label: "Modules", keys: "g m", group: "Navigate", arrives: "P3" },
  { id: "nav.views", label: "Views", keys: "g v", group: "Navigate", arrives: "P3" },
  { id: "nav.pages", label: "Pages", keys: "g d", group: "Navigate", arrives: "P6" },
  { id: "nav.inbox", label: "Inbox", keys: "g k", group: "Navigate", arrives: "P7" },
  { id: "nav.archives", label: "Archives", keys: "g r", group: "Navigate", arrives: "P9" },
  { id: "nav.settings", label: "Settings", keys: "g s", group: "Navigate", arrives: "P8" },
  { id: "nav.yourWork", label: "Your work", keys: "g j", group: "Navigate", arrives: "P9" },
  { id: "nav.analytics", label: "Analytics", keys: "g a", group: "Navigate", arrives: "P9" },
  { id: "nav.projects", label: "Projects", keys: "g p", group: "Navigate" },
  { id: "nav.intake", label: "Intake", keys: "g x", group: "Navigate", arrives: "P8" },
  { id: "nav.drafts", label: "Drafts", keys: "g y", group: "Navigate", arrives: "P9" },
];

export const SHORTCUT_BY_ID: ReadonlyMap<ShortcutId, ShortcutDef> = new Map(SHORTCUTS.map((def) => [def.id, def]));

/** True for the id of a registered shortcut (the palette's command ids). */
export function isShortcutId(value: string): value is ShortcutId {
  return SHORTCUT_BY_ID.has(value as ShortcutId);
}

/** How long a chord prefix (`g`, `n`) waits for its second key. */
export const CHORD_WINDOW_MS = 1000;

/** What the resolver reads from a KeyboardEvent; DOM-free so Vitest runs it in Node. */
export type KeyLike = { code: string; key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean };

export type ChordPrefix = "g" | "n";

export type ChordState = { prefix: ChordPrefix; at: number } | null;

export type ShortcutContext = {
  isMac: boolean;
  /** A command context is registered (a work item is open). */
  hasItem: boolean;
  /** The event target is an input, textarea, select or contenteditable. */
  isTyping: boolean;
  /** Single-key shortcuts and chords are enabled (the help dialog's switch). */
  singleKeys: boolean;
};

export type Resolved = { kind: "action"; id: ShortcutId } | { kind: "chord"; prefix: ChordPrefix } | null;

// ---------------------------------------------------------------------------
// Matchers, built once from SHORTCUTS
// ---------------------------------------------------------------------------

/** `event.code` values for the punctuation and named keys the table uses; letters map to `Key<Letter>`. */
const CODES_BY_KEY: Readonly<Record<string, readonly string[]>> = {
  ".": ["Period"],
  "'": ["Quote"],
  ",": ["Comma"],
  "/": ["Slash"],
  delete: ["Delete", "Backspace"],
};

function codesFor(key: string): readonly string[] | null {
  if (/^[a-z]$/.test(key)) return [`Key${key.toUpperCase()}`];
  return CODES_BY_KEY[key] ?? null;
}

type Matcher = { id: ShortcutId; needsItem: boolean; mod: boolean; shift: boolean; codes: readonly string[] };

const MOD_MATCHERS: Matcher[] = [];
const SINGLE_MATCHERS: Matcher[] = [];
const CHORDS: Record<ChordPrefix, Map<string, ShortcutId>> = { g: new Map(), n: new Map() };
const CHORD_CODES: Record<ChordPrefix, string> = { g: "KeyG", n: "KeyN" };

for (const def of SHORTCUTS) {
  const steps = def.keys.split(" ");
  if (steps.length === 2) {
    const [prefix, second] = steps;
    const codes = codesFor(second);
    if ((prefix === "g" || prefix === "n") && codes) CHORDS[prefix].set(codes[0], def.id);
    continue;
  }
  const parts = def.keys.split("+");
  const codes = codesFor(parts[parts.length - 1]);
  // "escape" has no entry on purpose: PeekHost owns it.
  if (!codes) continue;
  const mods = parts.slice(0, -1);
  const matcher: Matcher = { id: def.id, needsItem: def.needsItem === true, mod: mods.includes("mod"), shift: mods.includes("shift"), codes };
  (matcher.mod ? MOD_MATCHERS : SINGLE_MATCHERS).push(matcher);
}

/**
 * Open popups whose own keys win over the shortcuts: a picker's listbox or
 * its expanded trigger (type-ahead: `i` jumps to "In Progress"), a menu
 * (letter navigation) and the delete confirmation. A plain dialog is not in
 * the list: the peek's modal mode is one.
 */
export const QUIET_POPUP_SELECTOR = '[role="listbox"], [role="combobox"][aria-expanded="true"], [role="menu"], [role="alertdialog"]';

/** What the quiet-target check reads from an event target; DOM-free so Vitest runs it in Node. */
export type ShortcutTargetLike = {
  tagName: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
} | null;

/**
 * True when the target is a typing surface (`isTypingTarget`, the TabBar's
 * own check: input, textarea, select, contenteditable such as the
 * description editor) or sits inside one of the
 * `QUIET_POPUP_SELECTOR` popups. The dispatcher passes it as `isTyping`, so
 * only `mod+k` and `mod+/` get through.
 */
export function isQuietTarget(target: ShortcutTargetLike): boolean {
  if (!target) return false;
  if (isTypingTarget(target)) return true;
  return target.closest ? target.closest(QUIET_POPUP_SELECTOR) != null : false;
}

/** Shortcuts that keep working while the focus is in a typing surface. */
const ALLOWED_WHILE_TYPING: ReadonlySet<ShortcutId> = new Set<ShortcutId>(["palette.open", "shortcuts.help"]);

/** US-layout characters for the punctuation codes, shifted and not; used only when `event.code` is empty. */
const CODE_BY_CHARACTER: Readonly<Record<string, string>> = {
  ".": "Period",
  ">": "Period",
  "'": "Quote",
  '"': "Quote",
  ",": "Comma",
  "<": "Comma",
  "/": "Slash",
  "?": "Slash",
  Delete: "Delete",
  Backspace: "Backspace",
};

/**
 * The physical key of an event: `event.code`, or, when a synthetic or
 * virtual-keyboard event leaves it empty, the code its `key` stands for on a
 * US layout (`s` → `KeyS`, `.` → `Period`); "" when neither helps.
 */
export function physicalCode(event: Pick<KeyLike, "code" | "key">): string {
  if (event.code !== "") return event.code;
  if (/^[a-z]$/i.test(event.key)) return `Key${event.key.toUpperCase()}`;
  return CODE_BY_CHARACTER[event.key] ?? "";
}

function findMatch(matchers: readonly Matcher[], code: string, shiftKey: boolean): Matcher | null {
  if (code === "") return null;
  for (const matcher of matchers) {
    if (matcher.shift === shiftKey && matcher.codes.includes(code)) return matcher;
  }
  return null;
}

/**
 * Resolves one keydown against the registry. `chord` is the pending prefix
 * (or null) and `now` the event time; the caller stores a returned chord with
 * `at: now` and clears it on any other result. Item shortcuts need
 * `hasItem`; unmodified keys need `singleKeys` and a non-typing target; only
 * `palette.open` and `shortcuts.help` fire from inside inputs.
 */
export function resolveShortcut(event: KeyLike, chord: ChordState, now: number, context: ShortcutContext): Resolved {
  const mod = context.isMac ? event.metaKey : event.ctrlKey;
  const otherPlatformMod = context.isMac ? event.ctrlKey : event.metaKey;
  if (event.altKey || otherPlatformMod) return null;
  const code = physicalCode(event);

  if (mod) {
    const match = findMatch(MOD_MATCHERS, code, event.shiftKey);
    if (!match) return null;
    if (context.isTyping && !ALLOWED_WHILE_TYPING.has(match.id)) return null;
    if (match.needsItem && !context.hasItem) return null;
    return { kind: "action", id: match.id };
  }

  if (context.isTyping || !context.singleKeys) return null;

  if (chord && now - chord.at <= CHORD_WINDOW_MS && !event.shiftKey) {
    const id = CHORDS[chord.prefix].get(code);
    if (id) return { kind: "action", id };
    // Not in the chord's table: the prefix is dropped and the key resolves on its own.
  }

  if (!event.shiftKey) {
    for (const prefix of ["g", "n"] as const) {
      if (code === CHORD_CODES[prefix]) return { kind: "chord", prefix };
    }
  }

  const match = findMatch(SINGLE_MATCHERS, code, event.shiftKey);
  if (!match) return null;
  if (match.needsItem && !context.hasItem) return null;
  return { kind: "action", id: match.id };
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

const MAC_LABELS: Readonly<Record<string, string>> = { mod: "⌘", shift: "⇧", alt: "⌥", ctrl: "⌃", delete: "⌫", escape: "Esc", enter: "↵" };
const OTHER_LABELS: Readonly<Record<string, string>> = { mod: "Ctrl", shift: "Shift", alt: "Alt", ctrl: "Ctrl", delete: "Del", escape: "Esc", enter: "Enter" };

/**
 * Human form of a `keys` string: `mod+.` → `⌘ .` on a Mac and `Ctrl .`
 * elsewhere; chords read `G then H`.
 */
export function formatKeys(keys: string, isMac: boolean): string {
  const labels = isMac ? MAC_LABELS : OTHER_LABELS;
  return keys
    .split(" ")
    .map((step) =>
      step
        .split("+")
        .map((part) => labels[part] ?? (part.length === 1 ? part.toUpperCase() : part))
        .join(" "),
    )
    .join(" then ");
}
