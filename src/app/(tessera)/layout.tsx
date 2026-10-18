import { Suspense, cache, type ReactNode } from "react";
import { io } from "next/cache";
import { ChangesPoller } from "@/components/shell/ChangesPoller";
import { projectFeatureMap } from "@/components/shell/project-features";
import { projectNameMap } from "@/components/shell/recents";
import { RecentsTracker } from "@/components/shell/RecentsTracker";
import { Sidebar } from "@/components/shell/Sidebar";
import { SidebarSkeleton } from "@/components/shell/SidebarSkeleton";
import { TesseraShell } from "@/components/shell/TesseraShell";
import { countDrafts, getUnreadCount, latestSeq, listProjects, readTessera } from "@/lib/tessera/server";

/**
 * Tessera frame (docs/contracts/ui.md "Shell"): the client shell renders the
 * AppShell, TopBar, SideNav and ToastViewport; the sidebar's data, and the
 * recents tracker (with the project names its labels need) next to the
 * changes poller, stream in as server-rendered children under Suspense so the
 * shell itself stays in the static prerender. The poller sits with the
 * content, not in the sidebar: below the mobile breakpoint the sidebar lives
 * in a drawer whose content React pauses while it is closed.
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
        <WatchersData />
      </Suspense>
      {children}
    </TesseraShell>
  );
}

/** One projects read per request, shared by the sidebar and the recents labels. */
const loadProjects = cache(() => readTessera((ctx) => listProjects(ctx, {})));

/** Projects and the caller's unread inbox count for the sidebar. */
async function SidebarData() {
  await io();
  const [projects, counts] = await Promise.all([loadProjects(), readTessera((ctx) => ({ unread: getUnreadCount(ctx), drafts: countDrafts(ctx) }))]);
  return <Sidebar projects={projects} unreadCount={counts.unread} draftCount={counts.drafts} />;
}

/**
 * The two watchers that render nothing: the recents tracker, which reads the
 * request-bound pathname and gets the project names its labels need, and the
 * changes poller with the cursor it starts from. Archived projects leave the
 * sidebar but their recents still resolve, so their names are read too.
 */
async function WatchersData() {
  await io();
  const [projects, archived, cursor] = await Promise.all([
    loadProjects(),
    readTessera((ctx) => listProjects(ctx, { archived: true })),
    readTessera((ctx) => latestSeq(ctx)),
  ]);
  return (
    <>
      <RecentsTracker projectNames={projectNameMap([...projects, ...archived])} projectFeatures={projectFeatureMap([...projects, ...archived])} />
      <ChangesPoller initialCursor={cursor} />
    </>
  );
}
