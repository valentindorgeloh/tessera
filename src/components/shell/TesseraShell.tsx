"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { Card } from "@astryxdesign/core/Card";
import { useHotkeys, useMediaQuery } from "@astryxdesign/core/hooks";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { ToastViewport } from "@astryxdesign/core/Toast";
import { AiStatusProvider } from "@/components/ai/AiStatusProvider";
import { AssistantPanel } from "@/components/ai/AssistantPanel";
import { AssistantProvider, useAssistant } from "@/components/ai/AssistantProvider";
import { CommandBar, type CommandBarHandle } from "./CommandBar";
import { isSidenavDrawer, sideNavPanel, SIDENAV_DRAWER_QUERY, withWidthMotion } from "./layout-motion";
import {
  getNavOpen,
  getNavPrefs,
  isRailShown,
  navViewPatch,
  setNavOpenFlag,
  setNavPrefs,
  useNavOpen,
  useNavPrefs,
  type NavDock,
  type NavPrefs,
  type NavView,
} from "./nav-prefs";
import { TopBar } from "./TopBar";

export type NavFocusTarget = "panel" | "toggle" | "main" | "none";

export type ShellContextValue = {
  /** The sidebar preferences (decision 130), read in the calling component through `useNavPrefs()`. */
  navPrefs: NavPrefs;
  /** A rail (either kind) is on screen: `isRailShown(navPrefs)`. */
  isNavCollapsed: boolean;
  /** The floating sidebar is open (session only, decision 129). */
  isNavOpen: boolean;
  /** Full ↔ the stored rail kind (`mod+b` and the top bar's toggle while docked; the resize drag with `animate: false`). */
  setNavCollapsed: (collapsed: boolean, options?: { animate?: boolean }) => void;
  setNavView: (view: NavView, options?: { animate?: boolean }) => void;
  setNavDock: (dock: NavDock) => void;
  setNavOpen: (open: boolean, options?: { focus?: NavFocusTarget }) => void;
  /** Opens Power K (the top bar's search field; `mod+k` does the same), optionally with a first query. */
  openCommandBar: (initialQuery?: string) => void;
  /** Opens the keyboard shortcuts dialog (the top bar's help button; `mod+/` does the same). */
  openShortcuts: () => void;
  /** Opens the Create project dialog (the sidebar's Projects "+"; `n p` does the same). */
  openCreateProject: () => void;
};

/** What the context carries: stable callbacks only, so it never changes after mount. */
type ShellContextActions = Omit<ShellContextValue, "navPrefs" | "isNavCollapsed" | "isNavOpen">;

const ShellContext = createContext<ShellContextActions | null>(null);

/**
 * Shell state shared between the frame, the top bar and the sidebar. The
 * sidebar preferences and the floating open flag are not in the context: each
 * consumer reads them from the module stores in `nav-prefs.ts`
 * (`useSyncExternalStore` with a server snapshot), so a change before the
 * streamed sidebar has hydrated cannot make that boundary hydrate against a
 * value its server HTML was not rendered with (React 19.3 gives the
 * dehydrated boundary the new context value, so it throws error 418;
 * docs/contracts/ui.md "Shell").
 */
export function useShell(): ShellContextValue {
  const actions = useContext(ShellContext);
  const navPrefs = useNavPrefs();
  const isNavOpen = useNavOpen();
  if (!actions) throw new Error("useShell must be used inside TesseraShell");
  return { navPrefs, isNavCollapsed: isRailShown(navPrefs), isNavOpen, ...actions };
}

// ---------------------------------------------------------------------------
// Sidebar actions (decisions 128–131). They read the stores at call time, never
// a render closure, so they are module functions and the context stays stable.
// ---------------------------------------------------------------------------

function nextFrame(run: () => void) {
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") return;
  window.requestAnimationFrame(run);
}

function isFocusLost(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body;
}

/**
 * Decision 128: a view or dock change can remount the nav (Full ↔ rail gains or
 * loses the resize wrapper) or unmount what had focus (the menu's trigger, the
 * resize handle). Two frames later, if focus fell to `<body>`, it goes to
 * "Sidebar options", or to the top bar's toggle while that button sits in the
 * inert closed panel. Focus anywhere else is left alone.
 */
function refocusNav() {
  nextFrame(() =>
    nextFrame(() => {
      if (!isFocusLost()) return;
      const options = document.getElementById("tessera-nav-options");
      if (options && !options.closest("[inert]")) {
        options.focus();
        return;
      }
      document.getElementById("tessera-nav-toggle")?.focus();
    }),
  );
}

const PANEL_FOCUS_SELECTORS = [
  '#tessera-sidebar [data-nav-autofocus]:not([disabled]):not([aria-disabled="true"])',
  '#tessera-sidebar [aria-current="page"]',
  "#tessera-sidebar :is(a[href], button:not([disabled]))",
] as const;

function focusTarget(target: NavFocusTarget): HTMLElement | null {
  switch (target) {
    case "panel":
      for (const selector of PANEL_FOCUS_SELECTORS) {
        const element = document.querySelector<HTMLElement>(selector);
        if (element) return element;
      }
      return null;
    case "toggle":
      return document.getElementById("tessera-nav-toggle");
    case "main":
      return document.getElementById("astryx-app-shell-main");
    default:
      return null;
  }
}

function setNavView(view: NavView, options?: { animate?: boolean }) {
  const patch = navViewPatch(view);
  if (options?.animate === false) setNavPrefs(patch);
  else withWidthMotion(sideNavPanel(), () => setNavPrefs(patch));
  refocusNav();
}

function setNavCollapsed(collapsed: boolean, options?: { animate?: boolean }) {
  setNavView(collapsed ? getNavPrefs().rail : "full", options);
}

function setNavDock(dock: NavDock) {
  withWidthMotion(sideNavPanel(), () => {
    setNavPrefs({ dock });
    setNavOpenFlag(false);
  });
  refocusNav();
}

function setNavOpen(open: boolean, options?: { focus?: NavFocusTarget }) {
  setNavOpenFlag(open);
  const focus = options?.focus ?? "none";
  if (focus === "none") return;
  // A close or open in the same frame wins: never focus into a panel that has closed again.
  nextFrame(() => {
    if (getNavOpen() === open) focusTarget(focus)?.focus();
  });
}

/**
 * `mod+b` (decision 131): nothing below `md` (the drawer has its own toggle);
 * floating, it opens or closes the overlay; docked, it switches between Full
 * and the stored rail kind.
 */
function toggleNav() {
  if (isSidenavDrawer()) return;
  if (getNavPrefs().dock === "floating") {
    const isOpen = getNavOpen();
    const focusInside = document.getElementById("tessera-sidebar")?.contains(document.activeElement) ?? false;
    setNavOpen(!isOpen, { focus: isOpen ? (focusInside ? "toggle" : "none") : "panel" });
    return;
  }
  setNavCollapsed(getNavPrefs().display === "full");
}

/** The content panel, with the assistant in the Layout end slot while it is open. */
function ShellFrame({ sideNav, children }: { sideNav: ReactNode; children: ReactNode }) {
  const { isOpen } = useAssistant();
  return (
    <AppShell height="fill" variant="wash" contentPadding={2} topNav={<TopBar />} sideNav={sideNav}>
      <Card padding={0} height="100%" className="tessera-panel">
        <Layout height="fill" content={<LayoutContent isScrollable>{children}</LayoutContent>} end={isOpen ? <AssistantPanel /> : undefined} />
      </Card>
    </AppShell>
  );
}

/**
 * Tessera frame (docs/contracts/ui.md "Shell"): an AppShell on the wash with
 * the TopBar above and the SideNav beside the content, which sits in one
 * rounded panel inset from the wash. Also the ToastViewport that
 * `useToast()` in any screen renders into, and the CommandBar (Power K,
 * `mod+k`; the shortcut dispatcher, the shortcuts dialog and the Create
 * project dialog live inside it). `mod+b` switches the sidebar view, or shows
 * and hides it while undocked. The assistant panel is the content Layout's
 * end slot (`mod+j`). The sidebar arrives as a server-rendered child
 * (`sideNav`), so this component never touches the database.
 */
export function TesseraShell({ sideNav, children }: { sideNav: ReactNode; children: ReactNode }) {
  const commandBar = useRef<CommandBarHandle>(null);

  useHotkeys([
    {
      keys: "mod+b",
      onPress: toggleNav,
      allowInInputs: true,
    },
  ]);

  // An overlay opened before the window narrowed never pops open when it widens again (decision 129).
  const isDrawer = useMediaQuery(SIDENAV_DRAWER_QUERY, false);
  useEffect(() => {
    setNavOpenFlag(false);
  }, [isDrawer]);

  // CommandBar owns its dialogs; the top bar and the sidebar reach them through the same paths as the shortcuts.
  const openCommandBar = useCallback((initialQuery?: string) => commandBar.current?.open(initialQuery), []);
  const openShortcuts = useCallback(() => commandBar.current?.openHelp(), []);
  const openCreateProject = useCallback(() => commandBar.current?.openCreateProject(), []);

  const value = useMemo<ShellContextActions>(
    () => ({ setNavCollapsed, setNavView, setNavDock, setNavOpen, openCommandBar, openShortcuts, openCreateProject }),
    [openCommandBar, openShortcuts, openCreateProject],
  );

  return (
    <ShellContext.Provider value={value}>
      <ToastViewport position="bottomEnd">
        <AiStatusProvider>
          <AssistantProvider>
            <CommandBar ref={commandBar} />
            <ShellFrame sideNav={sideNav}>{children}</ShellFrame>
          </AssistantProvider>
        </AiStatusProvider>
      </ToastViewport>
    </ShellContext.Provider>
  );
}
