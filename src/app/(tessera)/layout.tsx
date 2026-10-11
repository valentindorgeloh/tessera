import { Suspense, cache, type ReactNode } from "react";
import { io } from "next/cache";
import { ChangesPoller } from "@/components/shell/ChangesPoller";
import { projectNameMap } from "@/components/shell/recents";
import { RecentsTracker } from "@/components/shell/RecentsTracker";
import { Sidebar } from "@/components/shell/Sidebar";
import { SidebarSkeleton } from "@/components/shell/SidebarSkeleton";
import { TesseraShell } from "@/components/shell/TesseraShell";
import { latestSeq, listProjects, readTessera } from "@/lib/tessera/server";

/**
 * Tessera frame (docs/contracts/ui.md "Shell"): the client shell renders the
 * AppShell, TopBar, SideNav and ToastViewport; the sidebar's data and the
 * recents tracker (with the project names its labels need) stream in as
 * server-rendered children under Suspense so the shell itself stays in the
 * static prerender.
 */
export default function TesseraLayout({ children }: { children: ReactNode }) {
  return (
    <TesseraShell
      sideNav={
        <Suspense fallback={<SidebarSkeleton />}>
          <SidebarData />
        </Suspense>
      }
    >
      <Suspense fallback={null}>
        <RecentsData />
      </Suspense>
      {children}
    </TesseraShell>
  );
}

/** One projects read per request, shared by the sidebar and the recents labels. */
const loadProjects = cache(() => readTessera((ctx) => listProjects(ctx, {})));

/** Projects for the sidebar and the change cursor the poller starts from. */
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
 * Records visits for Home's and Power K's recents. The tracker reads the
 * request-bound pathname and search params, so it streams in its own
 * Suspense boundary with the project names its labels need.
 */
async function RecentsData() {
  await io();
  const projects = await loadProjects();
  return <RecentsTracker projectNames={projectNameMap(projects)} />;
}
