"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { Card } from "@astryxdesign/core/Card";
import { useHotkeys } from "@astryxdesign/core/hooks";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { ToastViewport } from "@astryxdesign/core/Toast";
import { AiStatusProvider } from "@/components/ai/AiStatusProvider";
import { AssistantPanel } from "@/components/ai/AssistantPanel";
import { AssistantProvider, useAssistant } from "@/components/ai/AssistantProvider";
import { CommandBar, type CommandBarHandle } from "./CommandBar";
import { TopBar } from "./TopBar";

export type ShellContextValue = {
  isNavCollapsed: boolean;
  setNavCollapsed: (collapsed: boolean) => void;
  /** Opens Power K (the top bar's search field; `mod+k` does the same), optionally with a first query. */
  openCommandBar: (initialQuery?: string) => void;
  /** Opens the keyboard shortcuts dialog (the top bar's help button; `mod+/` does the same). */
  openShortcuts: () => void;
  /** Opens the Create project dialog (the sidebar's Projects "+"; `n p` does the same). */
  openCreateProject: () => void;
};

const ShellContext = createContext<ShellContextValue | null>(null);

/** Shell state shared between the frame, the top bar and the sidebar. */
export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell must be used inside TesseraShell");
  return value;
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
 * project dialog live inside it). `mod+b` collapses the navigation. The
 * assistant panel is the content Layout's end slot (`mod+j`). The sidebar
 * arrives as a server-rendered child (`sideNav`), so this component never
 * touches the database.
 */
export function TesseraShell({ sideNav, children }: { sideNav: ReactNode; children: ReactNode }) {
  const [isNavCollapsed, setNavCollapsed] = useState(false);
  const commandBar = useRef<CommandBarHandle>(null);

  useHotkeys([
    {
      keys: "mod+b",
      onPress: () => setNavCollapsed((collapsed) => !collapsed),
      allowInInputs: true,
    },
  ]);

  // CommandBar owns its dialogs; the top bar and the sidebar reach them through the same paths as the shortcuts.
  const openCommandBar = useCallback((initialQuery?: string) => commandBar.current?.open(initialQuery), []);
  const openShortcuts = useCallback(() => commandBar.current?.openHelp(), []);
  const openCreateProject = useCallback(() => commandBar.current?.openCreateProject(), []);

  const value = useMemo<ShellContextValue>(
    () => ({ isNavCollapsed, setNavCollapsed, openCommandBar, openShortcuts, openCreateProject }),
    [isNavCollapsed, openCommandBar, openShortcuts, openCreateProject],
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
