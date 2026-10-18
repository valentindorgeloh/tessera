import type { ReactNode } from "react";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { loadProjectBundles } from "@/app/(tessera)/work-items/load-detail";
import { FavoriteButton } from "@/components/shell/FavoriteButton";
import { ViewBar } from "@/components/views/ViewBar";
import { ViewMenu } from "@/components/views/ViewMenu";
import { ViewLockIndicator } from "@/components/views/ViewRow";
import { isViewModified, type ViewState } from "@/components/views/view-state";
import { ProjectScope } from "@/components/work-items/project-provider";
import { BundlesProvider } from "@/components/work-items/row-project";
import type { ProjectBundle, SettingsScope } from "@/components/work-items/types";
import { decodeUrlState, mergeDisplay, mergeFilters } from "@/components/work-items/url-state";
import { WorkItemsScreen } from "@/components/work-items/WorkItemsScreen";
import { DEFAULT_DISPLAY } from "@/lib/tessera/schemas";
import {
  getViewSettings,
  isTrackerError,
  latestSeq,
  listActors,
  listProjects,
  listWorkItems,
  readTessera,
  USER_ACTOR_ID,
  type Display,
  type Filters,
  type ListScope,
  type Project,
  type View,
} from "@/lib/tessera/server";

/**
 * A work-item list whose rows come from many projects (docs/drafts/p9-plan.md
 * U3): profile tabs and workspace views. State, label, cycle and module
 * grouping stay off because those values belong to one project. Each row's
 * controls read that project's bundle.
 */

const LIMIT = 2000;

const HIDDEN_GROUPS = ["state", "labels", "cycle", "module"] as const;

export type CrossProjectWorkListProps = {
  title: string;
  scope: ListScope;
  /** Where the layout switch and the display menu save. Null keeps changes in the URL (a saved view, decision 32). */
  settingsScope: SettingsScope | null;
  /** Filters and display of a saved view, used when nothing is stored in view settings. */
  saved?: { filters: Filters; display: Display };
  query: Record<string, string | string[] | undefined>;
  /** Workspace views are table-only. */
  forceTable?: boolean;
  /** Workspace views show a Project column. */
  showProjectColumn?: boolean;
  /** Saved workspace view. Adds the star, the menu and Update view. */
  view?: View;
  isFavorite?: boolean;
};

function coerceDisplay(display: Display, forceTable: boolean): Display {
  const hidden = (field: string | null) => field !== null && (HIDDEN_GROUPS as readonly string[]).includes(field);
  return {
    ...display,
    layout: forceTable ? "table" : display.layout,
    group_by: hidden(display.group_by) ? null : display.group_by,
    sub_group_by: hidden(display.sub_group_by) ? null : display.sub_group_by,
  };
}

function emptyProject(actorId: string, now: string): Project {
  return {
    id: "workspace",
    name: "Workspace",
    name_key: "workspace",
    identifier: "WS",
    description_md: "",
    logo: null,
    next_sequence: 1,
    cycles_enabled: false,
    modules_enabled: false,
    views_enabled: true,
    pages_enabled: false,
    intake_enabled: false,
    estimates_enabled: false,
    agent_intake_required: false,
    estimate_id: null,
    default_assignee_id: null,
    archive_in_months: null,
    close_in_months: null,
    close_state_id: null,
    archived_at: null,
    sort_order: "a0",
    created_at: now,
    updated_at: now,
    created_by: actorId,
    updated_by: actorId,
    deleted_at: null,
    counts: { total: 0, by_state_group: { backlog: 0, unstarted: 0, started: 0, completed: 0, cancelled: 0, triage: 0 } },
    estimate_type: null,
  };
}

function uniqueById<T extends { id: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

function hostBundle(
  bundles: Record<string, ProjectBundle>,
  projects: Project[],
  actors: ProjectBundle["actors"],
  today: string,
  cursor: number,
  now: string,
): ProjectBundle {
  const list = Object.values(bundles);
  const base = list[0]?.project ?? emptyProject(actors[0]?.id ?? USER_ACTOR_ID, now);
  return {
    project: {
      ...base,
      archived_at: null,
      views_enabled: true,
      estimates_enabled: false,
      cycles_enabled: list.some((bundle) => bundle.project.cycles_enabled),
      modules_enabled: list.some((bundle) => bundle.project.modules_enabled),
    },
    states: uniqueById(list.flatMap((bundle) => bundle.states)),
    labels: uniqueById(list.flatMap((bundle) => bundle.labels)),
    cycles: uniqueById(list.flatMap((bundle) => bundle.cycles)),
    modules: uniqueById(list.flatMap((bundle) => bundle.modules)),
    actors: list[0]?.actors ?? actors,
    cursor,
    today,
    estimate: null,
    intake_open: 0,
    projects: projects.map((project) => ({ id: project.id, name: project.name, identifier: project.identifier })),
  };
}

export async function CrossProjectWorkList({
  title,
  scope,
  settingsScope,
  saved,
  query,
  forceTable = false,
  showProjectColumn = false,
  view,
  isFavorite = false,
}: CrossProjectWorkListProps) {
  const urlState = decodeUrlState(typeof query.q === "string" ? query.q : undefined);
  await io();
  let loaded: Awaited<ReturnType<typeof loadList>> | undefined;
  let missing = false;
  try {
    loaded = await loadList(scope, settingsScope, saved, urlState, forceTable);
  } catch (err) {
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) missing = true;
    else throw err;
  }
  if (missing || loaded === undefined) notFound();
  const savedState: ViewState = { filters: loaded.storedFilters, display: loaded.settingsDisplay };
  const effective: ViewState = { filters: loaded.filters, display: loaded.display };
  const adornment: ReactNode = view ? (
    <>
      <FavoriteButton entityType="view" entityId={view.id} isFavorite={isFavorite} />
      {view.is_locked ? <ViewLockIndicator /> : null}
    </>
  ) : undefined;
  return (
    <ProjectScope bundle={loaded.host}>
      <BundlesProvider bundles={loaded.bundles}>
        <WorkItemsScreen
          projectId={loaded.host.project.id}
          result={loaded.result}
          display={loaded.display}
          filters={loaded.filters}
          settingsDisplay={loaded.settingsDisplay}
          settingsScope={settingsScope}
          createOnOpen={false}
          canCreate={false}
          allowSelection={false}
          hiddenGroupFields={HIDDEN_GROUPS}
          title={title}
          titleAdornment={adornment}
          subheaderEnd={view ? <ViewMenu projectId={null} view={view} placement="header" /> : undefined}
          filtersEnd={view ? <ViewBar projectId={null} view={view} isModified={isViewModified(savedState, effective)} effective={effective} /> : undefined}
          crossProject
          showLayoutSwitch={!forceTable}
          showProjectColumn={showProjectColumn}
          openMode="page"
        />
      </BundlesProvider>
    </ProjectScope>
  );
}

function loadList(
  scope: ListScope,
  settingsScope: SettingsScope | null,
  saved: { filters: Filters; display: Display } | undefined,
  urlState: ReturnType<typeof decodeUrlState>,
  forceTable: boolean,
) {
  return readTessera((ctx) => {
    const stored = settingsScope ? getViewSettings(ctx, settingsScope.scope_type, settingsScope.scope_id) : (saved ?? { filters: {}, display: DEFAULT_DISPLAY });
    const settingsDisplay = coerceDisplay(mergeDisplay(DEFAULT_DISPLAY, stored.display), forceTable);
    const display = coerceDisplay(mergeDisplay(DEFAULT_DISPLAY, stored.display, urlState.display), forceTable);
    const filters = mergeFilters({}, stored.filters, urlState.filters);
    const result = listWorkItems(ctx, { scope, filters, display, limit: LIMIT });
    const ids = [...new Set(result.items.map((item) => item.project_id))];
    const bundles = loadProjectBundles(ctx, ids);
    const host = hostBundle(bundles, listProjects(ctx, {}), listActors(ctx), ctx.today(), latestSeq(ctx), ctx.now());
    return { result, display, filters, settingsDisplay, storedFilters: stored.filters, bundles, host };
  });
}
