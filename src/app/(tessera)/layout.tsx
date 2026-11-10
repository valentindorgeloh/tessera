import { Suspense, cache, type ReactNode } from "react";
import { io } from "next/cache";
import { FavoritesPublisher } from "@/components/favorites/store";
import { EMPTY_FAVORITES, type FavoritesTree } from "@/components/favorites/tree";
import { ChangesPoller } from "@/components/shell/ChangesPoller";
import { PageSkeleton } from "@/components/shell/PageSkeleton";
import { projectFeatureMap } from "@/components/shell/project-features";
import { projectNameMap } from "@/components/shell/recents";
import { RecentsTracker } from "@/components/shell/RecentsTracker";
import { Sidebar } from "@/components/shell/Sidebar";
import { SidebarSkeleton } from "@/components/shell/SidebarSkeleton";
import { TesseraShell } from "@/components/shell/TesseraShell";
import { WorkspaceName } from "@/components/shell/TopBar";
import { WorkspaceSettingsPublisher } from "@/components/workspace-settings/workspace-settings-store";
import * as engineModule from "@/lib/tessera/server";
import { countDrafts, getUnreadCount, latestSeq, listProjects, readTessera } from "@/lib/tessera/server";
import type { WorkspaceSettingsView } from "@/lib/tessera/types";
import { getWorkspaceSettings } from "@/lib/tessera/workspace/settings";
import "../../components/styles/favorites.css";

/**
 * Tessera frame (docs/contracts/ui.md "Shell"): the client shell renders the
 * AppShell, TopBar, SideNav and ToastViewport; the sidebar's data, and the
 * recents tracker (with the project names its labels need) next to the
 * changes poller, stream in as server-rendered children under Suspense so the
 * shell itself stays in the static prerender. The poller sits with the
 * content, not in the sidebar: below the mobile breakpoint the sidebar lives
 * in a drawer whose content React pauses while it is closed.
 *
 * The page boundary sits here, above every route (not inside the pages the
 * navigation experiment covers): a client navigation does not re-trigger a
 * boundary of an already-mounted layout, so React keeps the old page on
 * screen and commits the new one in a single transition, and its 300 ms
 * reveal throttle after a skeleton never applies. A cold load still streams
 * through `PageSkeleton`. See `instant-navigation.md` "Client navigations".
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
      <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
    </TesseraShell>
  );
}

/** One projects read per request, shared by the sidebar and the recents labels. */
const loadProjects = cache(() => readTessera((ctx) => listProjects(ctx, {})));

/**
 * One favourites read per request, shared by the sidebar and the favourites
 * publisher. `listFavorites` is read when the engine exports it; until then
 * the tree is empty.
 */
const loadFavorites = cache(() => readTessera((ctx) => (engineModule as EngineExtras).listFavorites?.(ctx) ?? EMPTY_FAVORITES));

/**
 * Projects, the unread and draft counts, favourites and the workspace name.
 * `getWorkspaceSettings` is read when the engine exports it; until then the
 * name is "Tessera".
 */
async function SidebarData() {
  await io();
  const [projects, favorites, counts] = await Promise.all([
    loadProjects(),
    loadFavorites(),
    readTessera((ctx) => {
      const engine = engineModule as EngineExtras;
      const workspaceSettings = engine.getWorkspaceSettings?.(ctx) ?? getWorkspaceSettings(ctx);
      return {
        unread: getUnreadCount(ctx),
        drafts: countDrafts(ctx),
        workspaceSettings: workspaceSettings,
      };
    }),
  ]);
  return (
    <>
      <WorkspaceName name={counts.workspaceSettings.name} />
      <Sidebar projects={projects} unreadCount={counts.unread} draftCount={counts.drafts} favorites={favorites} />
    </>
  );
}

type EngineExtras = {
  listFavorites?: (ctx: Parameters<Parameters<typeof readTessera>[0]>[0]) => FavoritesTree;
  getWorkspaceSettings?: (ctx: Parameters<Parameters<typeof readTessera>[0]>[0]) => WorkspaceSettingsView;
};

/**
 * The watchers that render nothing: the recents tracker, which reads the
 * request-bound pathname and gets the project names its labels need, the
 * changes poller with the cursor it starts from, and the workspace settings
 * (week start) and favourites publishers. Archived projects leave the sidebar
 * but their recents still resolve, so their names are read too. The
 * publishers live here, not in the sidebar, because below the mobile
 * breakpoint React pauses the sidebar drawer's content, and a paused publisher
 * never emits: a phone's header stars then showed "Add to favorites" for a
 * favourite.
 */
async function WatchersData() {
  await io();
  const [projects, archived, cursor, unread, workspace, favorites] = await Promise.all([
    loadProjects(),
    readTessera((ctx) => listProjects(ctx, { archived: true })),
    readTessera((ctx) => latestSeq(ctx)),
    readTessera((ctx) => getUnreadCount(ctx)),
    readTessera((ctx) => getWorkspaceSettings(ctx)),
    loadFavorites(),
  ]);
  return (
    <>
      <WorkspaceSettingsPublisher settings={{ name: workspace.name, week_start: workspace.week_start }} />
      <FavoritesPublisher tree={favorites} />
      <RecentsTracker projectNames={projectNameMap([...projects, ...archived])} projectFeatures={projectFeatureMap([...projects, ...archived])} />
      <ChangesPoller initialCursor={cursor} initialUnread={unread} />
    </>
  );
}
