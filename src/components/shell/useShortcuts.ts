"use client";

/**
 * Shortcut dispatcher (docs/contracts/ui.md "Power K and shortcuts (D4)"):
 * one window keydown listener, resolved through the pure registry in
 * ./shortcuts.ts and dispatched to the registered command context (item
 * shortcuts open D2's property pickers), the router (navigation and create
 * chords) or a toast ("Arrives in P3"). Mounted once by CommandBar, which also
 * owns `mod+k`, `mod+/` and the help dialog through Astryx `useHotkeys`; those
 * two ids are left to it here, and Escape belongs to PeekHost. Nothing fires
 * from a typing surface (input, textarea, select, the contenteditable editor)
 * or from inside an open picker, menu or the delete confirmation
 * (`isQuietTarget`, a superset of the TabBar's `isTypingTarget`).
 *
 * Also holds the single-key preference (`tessera.shortcuts.v1`,
 * `{ "singleKeys": boolean }`) that the help dialog's switch writes, the
 * off switch WCAG 2.1.4 asks for.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { LAST_PROJECT_STORAGE_KEY } from "@/components/work-items/project-provider";
import { useCommandContext, type CommandContextValue } from "./command-context";
import { isQuietTarget, resolveShortcut, SHORTCUT_BY_ID, type ChordState, type ShortcutId } from "./shortcuts";

// ---------------------------------------------------------------------------
// Preferences store (localStorage), read after mount so server and client
// render the same markup during hydration.
// ---------------------------------------------------------------------------

export const SHORTCUTS_STORAGE_KEY = "tessera.shortcuts.v1";

export type ShortcutPrefs = { singleKeys: boolean };

const DEFAULT_PREFS: ShortcutPrefs = { singleKeys: true };

let prefs: ShortcutPrefs = DEFAULT_PREFS;
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ShortcutPrefs {
  return prefs;
}

function getServerSnapshot(): ShortcutPrefs {
  return DEFAULT_PREFS;
}

function loadPrefs() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(SHORTCUTS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (typeof parsed === "object" && parsed !== null && typeof (parsed as { singleKeys?: unknown }).singleKeys === "boolean") {
      prefs = { singleKeys: (parsed as { singleKeys: boolean }).singleKeys };
      emit();
    }
  } catch {
    // Unreadable storage: the defaults stay.
  }
}

/** Turns the single-key shortcuts (letters and the `g` / `n` chords) on or off and remembers the choice. */
export function setSingleKeys(enabled: boolean): void {
  if (prefs.singleKeys === enabled) return;
  prefs = { singleKeys: enabled };
  try {
    window.localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Not persisted in private mode; the session still honours it.
  }
  emit();
}

/** The shortcut preferences; the server snapshot is the default so hydration matches. */
export function useShortcutPrefs(): ShortcutPrefs {
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    loadPrefs();
  }, []);
  return value;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export type ShortcutDispatchOptions = {
  /** True while the command bar or a shell dialog is open: the page's shortcuts stay quiet. */
  isDisabled?: boolean;
  push: (href: string) => void;
  notify: (message: string) => void;
  openCommandBar: () => void;
  openHelp: () => void;
  openCreateProject: () => void;
};

/** Runs a shortcut by id, the same path the palette's command items take. */
export type ShortcutRunner = (id: ShortcutId) => void;

/** Ids CommandBar dispatches through Astryx `useHotkeys`; the keydown path never fires them twice. */
const DELEGATED: ReadonlySet<ShortcutId> = new Set<ShortcutId>(["palette.open", "shortcuts.help"]);

/** Project id from `/projects/[id]/...`, else null (same rule as the Sidebar). */
function projectIdFromPath(pathname: string): string | null {
  const match = /^\/projects\/([^/]+)/.exec(pathname);
  return match ? match[1] : null;
}

/** The project of the current route, else the last visited one (`tessera.lastProject.v1`), else null. */
function currentOrLastProjectId(): string | null {
  const current = projectIdFromPath(window.location.pathname);
  if (current) return current;
  try {
    return window.localStorage.getItem(LAST_PROJECT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || nav.platform || "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

function runShortcut(id: ShortcutId, options: ShortcutDispatchOptions, context: CommandContextValue | null): void {
  const def = SHORTCUT_BY_ID.get(id);
  const arrival = def?.arrives ? `Arrives in ${def.arrives}` : null;
  switch (id) {
    case "palette.open":
      options.openCommandBar();
      return;
    case "shortcuts.help":
      options.openHelp();
      return;
    case "peek.close":
      // PeekHost handles Escape itself.
      return;
    case "create.workItem": {
      const project = currentOrLastProjectId();
      if (project) options.push(`/projects/${project}/work-items?create=1`);
      else options.notify("Create a project first");
      return;
    }
    case "create.project":
      options.openCreateProject();
      return;
    case "nav.home":
      options.push("/home");
      return;
    case "nav.projects":
      options.push("/projects");
      return;
    case "nav.workItems": {
      const project = currentOrLastProjectId();
      if (project) options.push(`/projects/${project}/work-items`);
      else options.notify("Open a project first");
      return;
    }
    default:
      break;
  }
  if (id.startsWith("item.")) {
    if (!context) {
      options.notify("Open a work item first");
      return;
    }
    const action = context.actions[id];
    if (action) action();
    else options.notify(arrival ?? "Not available here");
    return;
  }
  options.notify(arrival ?? "Not available yet");
}

/**
 * Registers the window keydown listener once and returns a runner for the
 * palette's command items. The listener reads the latest options, context
 * and preferences through a ref, like Astryx's own `useHotkeys`.
 */
export function useShortcuts(options: ShortcutDispatchOptions): ShortcutRunner {
  const context = useCommandContext();
  const { singleKeys } = useShortcutPrefs();
  const latest = useRef({ options, context, singleKeys });
  const chordRef = useRef<ChordState>(null);

  useEffect(() => {
    latest.current = { options, context, singleKeys };
  });

  const run = useCallback<ShortcutRunner>((id) => {
    runShortcut(id, latest.current.options, latest.current.context);
  }, []);

  useEffect(() => {
    const isMac = isApplePlatform();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const { options: current, context: item, singleKeys: single } = latest.current;
      if (current.isDisabled) {
        chordRef.current = null;
        return;
      }
      const target = event.target instanceof HTMLElement ? event.target : null;
      const now = Date.now();
      const resolved = resolveShortcut(event, chordRef.current, now, {
        isMac,
        hasItem: item !== null,
        // Inputs, textareas, selects, the contenteditable editor and open pickers or menus.
        isTyping: isQuietTarget(target),
        singleKeys: single,
      });
      if (resolved === null) {
        chordRef.current = null;
        return;
      }
      if (resolved.kind === "chord") {
        chordRef.current = { prefix: resolved.prefix, at: now };
        event.preventDefault();
        return;
      }
      chordRef.current = null;
      if (DELEGATED.has(resolved.id)) return;
      event.preventDefault();
      runShortcut(resolved.id, current, item);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return run;
}
