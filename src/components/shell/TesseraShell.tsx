"use client";

import { Suspense, createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { useHotkeys } from "@astryxdesign/core/hooks";
import { HStack, Layout, LayoutContent, LayoutHeader } from "@astryxdesign/core/Layout";
import { ToastViewport } from "@astryxdesign/core/Toast";
import { TabBar } from "./TabBar";

/** Project names by id, registered by the Sidebar so the TabBar can label project tabs. */
export type ShellProjectNames = Readonly<Record<string, string>>;

export type ShellContextValue = {
  isNavCollapsed: boolean;
  setNavCollapsed: (collapsed: boolean) => void;
  projectNames: ShellProjectNames;
  registerProjectNames: (names: ShellProjectNames) => void;
};

const ShellContext = createContext<ShellContextValue | null>(null);

/** Shell state shared between the frame, the Sidebar and the TabBar. */
export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell must be used inside TesseraShell");
  return value;
}

function sameNames(a: ShellProjectNames, b: ShellProjectNames): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => a[key] === b[key]);
}

const EMPTY_NAMES: ShellProjectNames = {};

/**
 * Tessera frame (docs/contracts/ui.md "Shell"): AppShell with the SideNav in
 * its side slot, the TabBar pinned above the scrolling content, and the
 * ToastViewport that `useToast()` in any screen renders into. `mod+b`
 * collapses the navigation. The sidebar arrives as a server-rendered child
 * (`sideNav`) so this component never touches the database. The TabBar reads
 * `usePathname()`, which is request-bound under Cache Components, so it sits
 * in its own Suspense boundary (an empty strip of the same height in the
 * static shell) instead of blocking the whole route.
 */
export function TesseraShell({ sideNav, children }: { sideNav: ReactNode; children: ReactNode }) {
  const [isNavCollapsed, setNavCollapsed] = useState(false);
  const [projectNames, setProjectNames] = useState<ShellProjectNames>(EMPTY_NAMES);

  const registerProjectNames = useCallback((names: ShellProjectNames) => {
    setProjectNames((previous) => (sameNames(previous, names) ? previous : names));
  }, []);

  useHotkeys([
    {
      keys: "mod+b",
      onPress: () => setNavCollapsed((collapsed) => !collapsed),
      allowInInputs: true,
    },
  ]);

  const value = useMemo<ShellContextValue>(
    () => ({ isNavCollapsed, setNavCollapsed, projectNames, registerProjectNames }),
    [isNavCollapsed, projectNames, registerProjectNames],
  );

  return (
    <ShellContext.Provider value={value}>
      <ToastViewport position="bottomEnd">
        <AppShell height="fill" contentPadding={0} variant="elevated" sideNav={sideNav}>
          <Layout
            height="fill"
            header={
              <LayoutHeader padding={0} hasDivider label="Open pages">
                <Suspense fallback={<HStack className="tessera-tabbar" vAlign="center" />}>
                  <TabBar />
                </Suspense>
              </LayoutHeader>
            }
            content={<LayoutContent isScrollable>{children}</LayoutContent>}
          />
        </AppShell>
      </ToastViewport>
    </ShellContext.Provider>
  );
}
