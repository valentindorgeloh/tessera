import { Suspense, type ReactNode } from "react";
import { io } from "next/cache";
import { ChangesPoller } from "@/components/shell/ChangesPoller";
import { Sidebar } from "@/components/shell/Sidebar";
import { SidebarSkeleton } from "@/components/shell/SidebarSkeleton";
import { TesseraShell } from "@/components/shell/TesseraShell";
import { latestSeq, listProjects, readTessera } from "@/lib/tessera/server";

/**
 * Tessera frame (docs/contracts/ui.md "Shell"): the client shell renders the
 * AppShell, SideNav, TabBar and ToastViewport; the sidebar's data streams in
 * as a server-rendered child under Suspense so the shell itself stays in the
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
      {children}
    </TesseraShell>
  );
}

/** Projects for the sidebar tree and the change cursor the poller starts from, in one read. */
async function SidebarData() {
  await io();
  const { projects, cursor } = await readTessera((ctx) => ({
    projects: listProjects(ctx, {}),
    cursor: latestSeq(ctx),
  }));
  return (
    <>
      <Sidebar projects={projects} />
      <ChangesPoller initialCursor={cursor} />
    </>
  );
}
