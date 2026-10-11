import { Suspense, cache, type ReactNode } from "react";
import { io } from "next/cache";
import { ChangesPoller } from "@/components/shell/ChangesPoller";
import { Sidebar } from "@/components/shell/Sidebar";
import { SidebarSkeleton } from "@/components/shell/SidebarSkeleton";
import { projectNameMap } from "@/components/shell/tab-registry";
import { TabBar } from "@/components/shell/TabBar";
import { TesseraShell } from "@/components/shell/TesseraShell";
import { latestSeq, listProjects, readTessera } from "@/lib/tessera/server";

/**
 * Tessera frame (docs/contracts/ui.md "Shell"): the client shell renders the
 * AppShell, SideNav, TabBar and ToastViewport; the sidebar's data and the tab
 * bar's project names stream in as server-rendered children under Suspense
 * so the shell itself stays in the static prerender.
 */
export default function TesseraLayout({ children }: { children: ReactNode }) {
  return (
    <TesseraShell
      sideNav={
        <Suspense fallback={<SidebarSkeleton />}>
          <SidebarData />
        </Suspense>
      }
      tabBar={<TabBarData />}
    >
      {children}
    </TesseraShell>
  );
}

/** One projects read per request, shared by the sidebar tree and the tab bar labels. */
const loadProjects = cache(() => readTessera((ctx) => listProjects(ctx, {})));

/** Projects for the sidebar tree and the change cursor the poller starts from. */
async function SidebarData() {
  await io();
  const [projects, cursor] = await Promise.all([loadProjects(), readTessera((ctx) => latestSeq(ctx))]);
  return (
    <>
      <Sidebar projects={projects} />
      <ChangesPoller initialCursor={cursor} />
    </>
  );
}

/**
 * Project names for the tab labels. Server-rendered into the TabBar (which
 * the shell wraps in its own Suspense boundary) so the first client render
 * already labels "/projects/[id]/..." tabs with the project's name instead
 * of waiting for the sidebar to register them from an effect. Archived
 * projects leave the sidebar but keep their tabs, so their names are read too.
 */
async function TabBarData() {
  await io();
  const [projects, archived] = await Promise.all([loadProjects(), readTessera((ctx) => listProjects(ctx, { archived: true }))]);
  return <TabBar projectNames={projectNameMap([...projects, ...archived])} />;
}
