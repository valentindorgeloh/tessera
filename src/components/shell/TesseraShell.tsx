"use client";

import { Suspense, createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { useHotkeys } from "@astryxdesign/core/hooks";
import { HStack, Layout, LayoutContent, LayoutHeader } from "@astryxdesign/core/Layout";
import { ToastViewport } from "@astryxdesign/core/Toast";

export type ShellContextValue = {
  isNavCollapsed: boolean;
  setNavCollapsed: (collapsed: boolean) => void;
};

const ShellContext = createContext<ShellContextValue | null>(null);

/** Shell state shared between the frame and the Sidebar. */
export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell must be used inside TesseraShell");
  return value;
}

/**
 * Tessera frame (docs/contracts/ui.md "Shell"): AppShell with the SideNav in
 * its side slot, the TabBar pinned above the scrolling content, and the
 * ToastViewport that `useToast()` in any screen renders into. `mod+b`
 * collapses the navigation. The sidebar and the tab bar arrive as
 * server-rendered children (`sideNav`, `tabBar`), so this component never
 * touches the database and the tab bar already knows the project names on
 * its first client render. The TabBar reads `usePathname()`, which is
 * request-bound under Cache Components, so it sits in its own Suspense
 * boundary (an empty strip of the same height in the static shell) instead
 * of blocking the whole route.
 */
export function TesseraShell({ sideNav, tabBar, children }: { sideNav: ReactNode; tabBar: ReactNode; children: ReactNode }) {
  const [isNavCollapsed, setNavCollapsed] = useState(false);

  useHotkeys([
    {
      keys: "mod+b",
      onPress: () => setNavCollapsed((collapsed) => !collapsed),
      allowInInputs: true,
    },
  ]);

  const value = useMemo<ShellContextValue>(() => ({ isNavCollapsed, setNavCollapsed }), [isNavCollapsed]);

  return (
    <ShellContext.Provider value={value}>
      <ToastViewport position="bottomEnd">
        <AppShell height="fill" contentPadding={0} variant="elevated" sideNav={sideNav}>
          <Layout
            height="fill"
            header={
              <LayoutHeader padding={0} hasDivider label="Open pages">
                <Suspense fallback={<HStack className="tessera-tabbar" vAlign="center" />}>{tabBar}</Suspense>
              </LayoutHeader>
            }
            content={<LayoutContent isScrollable>{children}</LayoutContent>}
          />
        </AppShell>
      </ToastViewport>
    </ShellContext.Provider>
  );
}
