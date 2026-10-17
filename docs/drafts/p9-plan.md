## P9: Workspace surfaces (phase plan)

Draft by the phase planner, 2026-10-17, on `main` at `e03e664`. It assumes the P4
contract (docs/drafts/p4-ui.md, p4-service-api.md, p4-tools.md, p4-plan-notes.md)
and the P5–P8 plans (docs/drafts/p5-plan.md … p8-plan.md) are delivered:
- the registry and work items are folders (`tools/registry/<domain>.ts`, `TOOLS` in
  `registry/index.ts`; `work-items/*.ts`); `db/schema/` is a folder (P5 lane 0) and
  `db/schema/workspace.ts` holds the six P9 tables that `0000_init` already created;
  migrations `0002_ai` … `0005_*` exist, so P9's migration is `0006`;
- decisions 29–71 are in docs/PLAN.md;
- Home lives at `/` (P6 moved it from `/home`, `/home` is a 308 redirect);
- P5: `ai_digest`, `DigestKindSchema`, `digestInputs`, `getStoredDigest`,
  `currentDigestSeq`, `generateDigest`, `POST /api/ai/digest`, `GET /api/ai/status`,
  `DigestCard`; P6: pages with `page.logo`, `entityRoute`, the Wiki sidebar item;
  P7: `notify()`, `notifyFromActivity`, `NotificationKindSchema`, the `actor:<id>`
  link scheme, the Inbox sidebar item; P8: `actor.access`, the Drafts sidebar item,
  points-only progress (decision 66), `scripts/mcp-call.ts --client`.

This is a plan, one level lighter than a contract. A planner refreshes it into the
full P9 contract right before the build. Items marked **refresh before build**
depend on code that P4–P8 have not written yet, or on a line count only their
results can give.

Sources: docs/PLAN.md decisions 1, 4, 15, 18, 20–23; §1 rows "Assignees, Your work",
"Favourites with folders, recents", "Home …, stickies page", "Workspace views,
active cycles page", "Analytics"; §2 "Workspace (P9)"; §4 tool row "Workspace";
§5 routes `/`, `/your-work`, `/agents`, `/workspace-views`, `/active-cycles`,
`/analytics/[tab]`; §6 sidebar; §8 "Digests and narratives"; §9 P9 row (exit:
"Home renders from one `getHomeSummary`; analytics numbers equal `getCounts`").
Deferrals inherited: p4-ui.md lines 55–70 (workspace and static views, view
favourites, view logo picker, views list sort and filter, cycles and modules list
search/sort/filter, actor activity feed, sidebar project `…` menu and drag, Power K
retired-identifier search), p5-plan.md lines 63–64 (Home digest, analytics narrative,
`/settings/ai`), p6-plan.md lines 73–77 (page favourites, recent pages, page logo
picker), p7-plan.md lines 93–101 (Subscribed tab and static view, module
notifications, mention chip → profile), p8-plan.md lines 97–98 (sidebar "Draft work
item", points in analytics). Astryx props checked in
`node_modules/@astryxdesign/core/dist/*/*.d.ts` 0.6.8 (§6). Recharts 3.10.1 (MIT) is
installed (`recharts/types/chart/{BarChart,LineChart,AreaChart,PieChart}.d.ts`, the
`responsive` prop in `types/util/types.d.ts:1284`).

What already exists (verified on `e03e664`):
- Tables `favorite_folder`, `favorite` (unique `(entity_type, entity_id)` partial),
  `recent_visit`, `sticky` (name, description_md, color default `yellow`,
  sort_order), `quick_link` (title, url, sort_order), `workspace_settings` (singleton
  id `workspace`: name, `home_widgets` JSON, `ai` JSON, `last_seen_at`) in
  `db/schema.ts:680–742`; `FavoriteEntityTypeSchema` (`project|cycle|module|view|page`),
  `HomeWidgetsSchema` (`{ widget: string, enabled }[]`), `WorkspaceAiSettingsSchema`
  (`model`, `effort`, `digest_enabled`) in `schemas.ts:46,264,274`.
- `listWorkItems` scopes `workspace` and `profile { actor_id, tab:
  assigned|created|subscribed }` (`work-items.ts:534–549`); `GROUPABLE_FIELDS`
  includes `state_group` and `project` (`core/group.ts:7`); `FiltersSchema.project`
  ("only meaningful for workspace views", `schemas.ts:103`).
- `getCounts(ctx, scope)` with scopes `workspace | project | cycle | module | view |
  profile { actor_id }` (assigned only), `Counts` = total, by_state_group, by_state,
  by_priority, by_assignee, by_label, overdue, due_this_week, total_points,
  completed_points (`counts.ts:25–55,290`).
- Views engine: `listViews({ project_id: null })` = workspace views,
  `WORKSPACE_VIEW_LAYOUT = "table"` enforced on create/update (`views.ts:35,100`).
- `view_settings` scope `workspace` requires `scope_id "workspace"` (refine in
  `view-settings.ts:108–122`); scope `profile` exists.
- `listActivity({ work_item_id } | { project_id }, since_seq, limit)`
  (`changes.ts:102–163`; P5 adds `cycle_id`/`module_id`); `activity_actor_seq_idx`.
- `getActiveCycles(ctx)` (`cycles.ts:511`), tool `list_active_cycles`;
  `ActiveCycleSummary({ projectId, data: CycleDetailData })` and `loadCycleDetail` in
  `projects/[projectId]/cycles/cycle-data.ts:34`.
- Recharts pattern: `BurndownChart.tsx` (`LineChart responsive`, a Skeleton until
  hydrated), `chart-colors.ts` (`useChartColors()` resolves token names through
  `useTheme().tokens`); data tokens `--color-data-categorical-{blue,orange,purple,
  green,pink,cyan,red,teal,brown,indigo}` in `themes/catppuccin/palette.ts:217–226`.
- Logo: `LogoSchema { icon, color }`, `PROJECT_LOGO_ICONS`, `resolveLogoIcon` in
  `icons.tsx:266–297`; the only picker is inline in `CreateProjectDialog.tsx:80–170`
  (icon `Selector` + colour `Selector`).
- Shortcuts `g j` Your work and `g a` Analytics are registered with `arrives: "P9"`
  (`shortcuts.ts:129–130`).

### 1. Scope and deferrals

In scope:
- **Home** (`/`): widgets "Since you were last here" (agent and automation activity
  since the last visit, with a P5 digest), Quick links, Recents, Your work summary,
  Stickies; "Manage widgets" (show/hide and order); everything server-side comes
  from one `getHomeSummary` (exit criterion).
- **Stickies page** (`/stickies`): grid of coloured notes, inline markdown editing,
  search, colour, delete.
- **Favourites with folders**: star on projects, cycles, modules, views and pages;
  the sidebar Favorites section with one level of folders, drag to reorder and move
  into folders, plus Move up / Move down / Move to folder menus (keyboard path,
  decision 14).
- **Sidebar pass** (P4 deferral): workspace items Your work, Workspace views, Active
  cycles, Analytics, Agents, Archives; the project row `…` menu (Settings, Archives,
  Copy link, Add to/Remove from favorites, Draft work item, Archive project); project
  drag order (`reorder_project`).
- **Your work and agent profiles**: `/your-work/[tab]` and `/agents/[actorId]/[tab]`
  with tabs Summary, Assigned, Created, Subscribed, Activity; `/agents` list; mention
  chips link to the profile.
- **Workspace views and static views**: `/workspace-views` (four static views + saved
  workspace views) and `/workspace-views/[viewId]`, table-only (decisions 18, 20).
- **Active cycles page** (`/active-cycles`).
- **Analytics** (`/analytics/[tab]`, tabs overview, work-items, cycles, modules) with
  Recharts, a data table under every chart, project and range filters, a points
  measure (P8 deferral) and a stored AI narrative per tab.
- **Workspace settings** (`/settings/general`, `/settings/ai`), tools
  `get_workspace_settings` / `update_workspace_settings` (P5 deferral).
- **Logo picker** for views and pages (shared with projects).
- **List controls**: views list sort and filter; cycles and modules list search,
  sort and filter (P4/P3 deferrals).
- **Power K**: retired-identifier key search (P4 deferral), navigation commands for
  the new surfaces, "Add to favorites".
- **Module notifications** (P7 deferral): the module lead and members are notified
  of module changes.

Deferred (each with its phase):

| Item | Phase | Note |
|---|---|---|
| Pointer drag reorder for stickies, quick links and Home widgets | P10 | P9 orders them with Move up / Move down; P10 already owns drag for views, states and labels |
| Estimate totals in list/board group headers (P8 deferral) | P10 | Analytics gets the points measure in P9; group headers belong to the layouts P10 reworks for calendar and gantt |
| Analytics export (CSV of a chart's table) | P10 | With exports (`export_csv`) |
| Calendar and gantt layouts on profiles | P10 | Decision 18; profiles get list, board and table |
| Rich filters (AND/OR/NOT) on workspace views | P10 | Decision 20 |
| Analytics for intake and estimates tabs (Plane commercial) | — (not built) | Plane CE ships overview and work items; cycles and modules tabs are the PLAN's addition |
| Cycle notifications | — (not built) | Cycles have no lead or members to notify; work item notifications already cover membership changes (P7) |
| An agent's own notifications on its profile (p7-plan.md:93) | — (not built) | Decision 58 scopes notification tools to the caller; the profile's Activity tab shows what the agent did |
| Server-side recents and `list_recents` | — (dropped, decision 74) | Recents stay per browser (decision 15) |
| Home "Your work" widget charts beyond counts | P11 polish | P9 shows counts and a state-group bar |

### 2. New decisions (lane A writes them into docs/PLAN.md after row 71)

| # | Decision |
|---|---|
| 72 | **Home summary.** One read `getHomeSummary(ctx)` (tool `get_home_summary`) returns every server-side widget: the widget list, "since last visit", quick links, the Your work numbers, the six most recently updated stickies and the stored home digest. The Recents widget is the only client-side widget (decision 15). Widget ids are fixed: `since_last_visit`, `quick_links`, `recents`, `your_work`, `stickies` (`HomeWidgetIdSchema`). `workspace_settings.home_widgets` stores order and on/off; `normalizeHomeWidgets` drops unknown ids and appends missing ids enabled, in the default order above. |
| 73 | **Since you were last here.** The anchor is `workspace_settings.last_seen_seq` (new column; null on a fresh database = "the last 7 days"). The widget lists activity rows with `seq > anchor` whose actor kind is not `user`, newest first, collapsed per (actor, target) where the target is the work item, page, cycle, module or project the row is about, at most 20 entries (from at most 2000 rows) plus a "+N more" count. The anchor moves forward (never back) to the newest seq the widget showed when Home is hidden or the tab unloads: `navigator.sendBeacon("/api/home/seen", { seq })`, and with the widget's "Mark as seen" button. Moving the anchor is viewer bookkeeping like decision 34: `setHomeSeen` is not a tool, writes no activity and does not move the change cursor. The AI summary is P5's digest with kind `home`, entity id `workspace`, over the same rows, generated only on click (decision 37). |
| 74 | **Recents stay per browser.** Decision 15 (localStorage `tessera.recents.v1`) is the only recents store. Migration 0006 drops the unused `recent_visit` table; `list_recents` leaves the tools contract and §7 "Every detail read writes `recent_visit`" is struck. The Home Recents widget filters the same list by route icon: All, Work items, Pages, Projects. |
| 75 | **Favourites.** At most one live favourite per entity (existing partial unique index). Folders are one level deep; names are free text and need not be unique. The top level mixes folders and unfoldered favourites in one `sort_order` key space; inside a folder favourites have their own keys. Deleting a folder moves its favourites to the top level (appended), so `delete_favorite_folder` is not destructive. Favourites resolve at read time: `listFavorites` joins each row to its entity and drops rows whose entity is deleted, archived, or in an archived or deleted project (no edits to the delete paths of `cycles.ts`/`modules.ts`; P6's page cleanup stays). Static workspace views cannot be favourited. |
| 76 | **Sidebar.** Order of the Workspace section: Home, Your work, Inbox, Drafts, Workspace views, Active cycles, Analytics, Agents, Projects, Archives (→ `/projects/archives`); Wiki stays where P6 put it (**refresh before build**). Favorites (hidden when empty) sits between Workspace and Projects. Project rows drag to reorder (`reorder_project`, fractional keys, decision 4) and carry a `…` menu; Move up / Move down in that menu are the keyboard path. The top bar brand shows `workspace_settings.name` (default "Tessera"). |
| 77 | **Static workspace views** are virtual (decision 20): `all` → scope `workspace`, `assigned`/`created`/`subscribed` → scope `profile` of the user actor with that tab. They cannot be renamed, locked, deleted or favourited. They remember filters and display in `view_settings` scope `workspace` under `scope_id` `workspace` (all) or `static:<key>`; the refine in `ViewSettingsScopeInput` accepts exactly those four ids. Saved workspace views follow decision 32 (URL until "Update view"). Every workspace-scope list is table-only and shows a Project column. |
| 78 | **Profiles.** `/your-work/[tab]` is the profile of the user actor; `/agents/[actorId]/[tab]` of any other actor (`/agents/<user id>/*` redirects to `/your-work/*`). Tabs `summary`, `assigned`, `created`, `subscribed`, `activity` (`ProfileTabSchema`). The three work tabs use list, board and table, and remember one display per actor in `view_settings` scope `profile`, `scope_id` = actor id. Activity is `listActivity({ actor_id })`, newest first, 50 per page with "Load more" (`before_seq`). Summary comes from `getProfileSummary` whose numbers are `getCounts` profile scopes (assigned, created, subscribed). |
| 79 | **Analytics population and filters.** Distributions are point-in-time over the `getCounts` population (live projects, not archived, not drafts, not pending intake; decision 21). The filters are `?projects=<id>,<id>` (empty = all live projects; `getCounts` scope `workspace` gains optional `project_ids`) and `?range=7d|30d|90d|365d` (default `30d`). The range applies only to trend series (created vs completed per day, per ISO week for `365d`, from `created_at`/`completed_at` in server local dates, decision 6; this population includes archived items) and to the cycles tab (cycles that overlap the range). Vitest asserts every number a tab shares with `Counts` equals `getCounts` for the workspace, a single project and a two-project filter. |
| 80 | **Analytics breakdown.** The work-items tab charts one dimension (`x_axis`) with an optional second (`segment`, never equal to `x_axis`) and a measure `count` or `points`. Dimensions: `state_group`, `state` (only with exactly one project), `priority`, `assignee`, `label`, `cycle`, `module`, `project`, `created_by`, `target_week`. Multi-valued dimensions (assignee, label, module) count an item once per value, as `Counts.by_assignee` does, plus a `none` bucket. `points` needs an active points estimate in every project in scope (decision 66), otherwise `RULE points_unavailable`. The engine returns every bucket; the chart shows the top 11 plus "Other" and the table shows all. Colours: state groups and priorities use their fixed palette mapping (decision 22), labels and projects their own palette keys, everything else the ten `--color-data-categorical-*` tokens in a fixed order; every series is also named in the legend and the table (WCAG 1.4.1). |
| 81 | **Analytics narrative.** P5's digest with kind `analytics`, entity id `<tab>:<project ids sorted and joined by "," or "all">:<range>`, input = the tab's `AnalyticsResult` (numbers and names only, no descriptions), `input_seq` = `latestSeq`. On click only (decision 37). |
| 82 | **Stickies.** Workspace-level notes (decision 1). New stickies go first (`sort_order` before the first). The body is markdown in the shared `MarkdownEditor` (decision 10) edited in place; saves are debounced 800 ms and flushed on blur, last write wins (no version column, no version rows). Colours are palette keys (decision 22). Stickies are not in `search_all`, counts or notifications; `/stickies?q=` searches name and body with `LIKE`. |
| 83 | **Quick links.** `url` is `http(s)://…` or an app path starting with `/`; anything else is `VALIDATION`. `title` is optional; the UI shows the URL's host (or the path) when it is empty. External links open in a new tab. Removing a link is not destructive (no confirm). |
| 84 | **Workspace settings.** `get_workspace_settings` / `update_workspace_settings { name?, home_widgets?, ai? }` on the singleton row. P5's AI client reads `workspace_settings.ai.model` / `.effort` first and the env (decision 17) second; `digest_enabled: false` hides every Summarise button and the home digest. |
| 85 | **One logo picker** (`LogoFields`: icon `Selector` + colour `Selector`) for projects, views and pages, over `PROJECT_LOGO_ICONS` and the palette keys; views and pages without a logo draw their default icon. |
| 86 | **Retired identifiers in Power K.** `searchAll` resolves a key query `OLD-n` through decision 29 when no live project holds `OLD`; the hit shows the current key and the note "was OLD-n". |
| 87 | **Module notifications.** `notifyFromActivity` sends `module_updated` (new `NotificationKind`) to the module's lead and members, except the acting actor, for module rows with verbs `updated` (status, dates, lead, name), `archived`, `unarchived` and work items added or removed. One notification per recipient per module collapses through P7's `event_count` (**refresh before build**: P7's collapse rule). |
| 88 | **List controls are URL state.** Views list `?sort=manual|name|created|updated&q=`; cycles list `?q=&sort=manual|name|start|end`; modules list `?q=&sort=manual|name|progress|target|created&status=<ModuleStatus>,…&lead=<actorId>`. All filtering and sorting is client-side over the loaded list; nothing is remembered; Move up/down is disabled unless sort is `manual`. |

### 3. Data model changes

Migration `drizzle/0006_workspace.sql` (generated by `drizzle-kit generate` from
`db/schema/workspace.ts`; lane A):

| Change | Detail |
|---|---|
| `workspace_settings.last_seen_seq` | `integer("last_seen_seq")`, nullable (decision 73). `last_seen_at` stays and is written alongside it (shown as "Last visit …"). |
| Drop `recent_visit` | Table and `recent_visit_visited_idx` (decision 74). Remove the table from `db/schema/workspace.ts` and `RecentVisitRow` from `types.ts`. |
| Index `favorite_folder_sort_idx` | `favorite (folder_id, sort_order)`, for sidebar reads. |
| Index `sticky_updated_idx` | `sticky (updated_at)`, for the Home widget. |
| Index `work_item_completed_idx` | `work_item (completed_at)`, for analytics trends (the `created_at` trend uses a scan of the scope; small databases). |

Seed: `ensureWorkspaceSettings(db)` (lane A, in `workspace/settings.ts`, called next
to `ensureSystemActors` at startup) inserts the singleton row with the default widget
list when it is missing.

Zod-only additions (no migration):
- `schemas.ts` (lane 0, client-safe): `HomeWidgetIdSchema`, `HomeWidgetsSchema`
  tightened to `widget: HomeWidgetIdSchema` (parse with `.catch` in
  `normalizeHomeWidgets`, not in the column type), `StaticViewKeySchema` (`all,
  assigned, created, subscribed`) and `STATIC_WORKSPACE_VIEWS` (key, name,
  description), `ProfileTabSchema`, `AnalyticsTabSchema` (`overview, work-items,
  cycles, modules`), `AnalyticsRangeSchema`, `AnalyticsDimensionSchema`,
  `AnalyticsMeasureSchema`, `QuickLinkUrlSchema`.
- `types.ts` (lane 0): `FavoriteView`, `FavoriteFolderView`, `FavoritesTree`,
  `StickyView`, `QuickLinkView`, `HomeSummary`, `SinceEntry`, `YourWorkNumbers`,
  `ProfileSummary`, `AgentProfileRow`, `AnalyticsResult` (union by tab),
  `AnalyticsBucket`, `TrendPoint`, `WorkspaceSettingsView` (shapes in §4).
- `DigestKindSchema` gains `home`, `analytics`; `NotificationKindSchema` gains
  `module_updated` (lane A; both live where P5/P7 put them, **refresh before build**).

### 4. Engine additions (lane A)

New folder `src/lib/tessera/workspace/` and `src/lib/tessera/analytics/`, each with
an `index.ts` re-exported from the barrel. Every function takes `ctx` first; every
input is a strict zod object with `.describe()` on every field.

**`workspace/favorites.ts`**
```ts
listFavorites(ctx): FavoritesTree
// { folders: (FavoriteFolderView & { items: FavoriteView[] })[], items: FavoriteView[], order: ({kind:"folder",id}|{kind:"favorite",id})[] }
// FavoriteView = { id, entity_type, entity_id, folder_id, sort_order, name, href, logo: Logo|null, project_id: string|null, project_name: string|null }
AddFavoriteInput { entity_type: FavoriteEntityType, entity_id: Id, folder_id?: Id|null }   // CONFLICT favorite_exists; NOT_FOUND for a missing, deleted or archived entity or folder
addFavorite(ctx, input): FavoriteView                        // appended at the end of its level
RemoveFavoriteInput { entity_type, entity_id }
removeFavorite(ctx, input): void                              // soft delete; NOT_FOUND when not a favourite
MoveFavoriteInput { favorite_id: Id, folder_id: Id|null, before_id?: Id, after_id?: Id }  // ids of siblings at the target level (favourites or, at top level, folders)
moveFavorite(ctx, input): FavoriteView
CreateFavoriteFolderInput { name: string(1..80) }
createFavoriteFolder(ctx, input): FavoriteFolderView          // appended at the top level
RenameFavoriteFolderInput { folder_id, name }
renameFavoriteFolder(ctx, input): FavoriteFolderView
MoveFavoriteFolderInput { folder_id, before_id?, after_id? }
moveFavoriteFolder(ctx, input): FavoriteFolderView
deleteFavoriteFolder(ctx, { folder_id }): void                // its favourites move to the top level (decision 75)
isFavorite(ctx, entity_type, entity_id): boolean              // server read for headers
favoriteIds(ctx, entity_type): Set<string>                    // server read for list rows (one query)
```
Activity: `entity_type` `favorite` / `favorite_folder`, verbs `created`, `deleted`,
`moved`, `updated`, no `project_id`. `href` comes from one `favoriteHref(type, row)`
(projects `/projects/<id>/work-items`, cycles and modules the project routes, views
the project or workspace view route, pages `/pages/<id>`).

**`workspace/stickies.ts`**: `listStickies(ctx, { q?, limit? (1..500, default 200) })`
(sort_order), `recentStickies(ctx, limit)` (updated_at desc), `createSticky(ctx, {
name?, description_md?, color? })`, `updateSticky(ctx, sticky_id, { name?,
description_md?, color? })`, `moveSticky(ctx, { sticky_id, before_id?, after_id? })`,
`deleteSticky(ctx, sticky_id)`. Activity entity `sticky` (description edits are not
diffed: one `updated` row with `field = "description_md"` and no values).

**`workspace/quick-links.ts`**: `listQuickLinks(ctx)`, `addQuickLink(ctx, { url, title? })`,
`updateQuickLink(ctx, quick_link_id, { url?, title? })`, `moveQuickLink(ctx, {
quick_link_id, before_id?, after_id? })`, `removeQuickLink(ctx, quick_link_id)`.

**`workspace/settings.ts`**: `ensureWorkspaceSettings(db)`, `getWorkspaceSettings(ctx):
WorkspaceSettingsView` (`{ name, home_widgets (normalized), ai, last_seen_seq,
last_seen_at }`), `UpdateWorkspaceSettingsInput { name?: 1..80, home_widgets?:
HomeWidgets, ai?: WorkspaceAiSettings partial }`, `updateWorkspaceSettings`,
`normalizeHomeWidgets(raw)`.

**`workspace/home-seen.ts`** (outside the barrel, like P5's `ai/**`; decision 73):
`setHomeSeen(db, seq: number): void` (max with the stored value, clamps to
`latestSeq`, sets `last_seen_at`).

**`workspace/home.ts`**
```ts
getHomeSummary(ctx): HomeSummary
// { widgets: { widget: HomeWidgetId; enabled: boolean }[];
//   since: { anchor_seq: number|null; anchor_at: string|null; latest_seq: number; entries: SinceEntry[]; more: number };
//   quick_links: QuickLinkView[]; your_work: YourWorkNumbers; stickies: StickyView[] (6); digest: DigestView|null }
// SinceEntry = { actor: { id, name, kind, color }; target: { type, id, label, href }; verbs: string[]; fields: string[]; count: number; last_at: string; last_seq: number }
// YourWorkNumbers = { assigned_open, assigned_overdue, assigned_due_this_week, created_open, subscribed_open, by_state_group: Record<StateGroup, number> }
sinceLastVisit(ctx, anchor_seq: number|null): HomeSummary["since"]   // also the home digest input (digest-store)
```
`your_work` reads `getCounts` profile scopes (open = total minus completed and
cancelled), so it equals the Your work summary.

**`workspace/profile.ts`**: `getProfileSummary(ctx, { actor_id }): ProfileSummary`
(`{ actor (with access, last_seen_at), assigned: Counts, created: Counts, subscribed:
Counts, completed_last_30d, projects: { project_id, name, assigned_open }[],
recent_activity: ActivityLogEntry[] (10) }`); `listAgentProfiles(ctx):
AgentProfileRow[]` (`{ actor, assigned_open, last_activity_at, activity_7d }` for kinds
`assistant`, `agent`, `system`; server read, no tool).

**`analytics/`**: `index.ts` (`getAnalytics(ctx, input): AnalyticsResult`),
`population.ts` (the shared base `WHERE` taken from `counts.ts`, see below),
`dimensions.ts` (bucket keys, labels and palette per dimension), `breakdown.ts`
(GROUP BY queries for x × segment × measure), `trend.ts`, `planning.ts` (cycles and
modules tabs from `listCycles`/`getCycleProgress` and module progress, no edits to
`cycles.ts`/`modules.ts`), `overview.ts`.
```ts
GetAnalyticsInput = { tab: AnalyticsTab, project_ids?: Id[] (1..50), range?: AnalyticsRange = "30d",
  x_axis?: AnalyticsDimension = "state_group", segment?: AnalyticsDimension|null = null, measure?: "count"|"points" = "count" }
// overview:   { kpis: { projects, work_items, open, completed, overdue, due_this_week, active_cycles, active_agents }, by_state_group, by_priority, trend: TrendPoint[], top_assignees: { actor_id, name, open, completed }[] (8), projects: { id, name, identifier, logo, total, open, completed }[] }
// work-items: { x_axis, segment, measure, buckets: AnalyticsBucket[], segment_keys: { key, label, color }[], total, trend }
//   AnalyticsBucket = { key: string; label: string; color: PaletteColor|null; total: number; segments: Record<string, number> }
// cycles:     { rows: { cycle_id, project_id, project_name, name, status, start_date, end_date, total, completed, pending, completion, points: { total, completed }|null }[], by_status: Record<CycleStatus, number> }
// modules:    { rows: { module_id, project_id, project_name, name, status, lead_id, target_date, total, completed, completion }[], by_status: Record<ModuleStatus, number> }
// every tab also: { scope: { project_ids: string[]|null, range, from, to }, computed_seq }
```
`counts.ts` edits (lane A): export `countsPopulation(ctx, scope)` (the resolved
`WHERE` it already builds) for `analytics/population.ts`; scope `workspace` gains
`project_ids?`; scope `profile` gains `tab?: assigned|created|subscribed` (default
`assigned`, so P1–P8 callers are unchanged).

**Other engine edits**: `changes.ts` `ListActivityInput` gains `actor_id` and
`before_seq` (the refine becomes "exactly one of work_item_id, project_id, cycle_id,
module_id, actor_id", **refresh before build** with P5's version); `views.ts`/
`view-settings.ts` relax the workspace refine (decision 77) and add
`staticViewScope(key): ListScope` in `src/lib/tessera/static-views.ts`;
`projects.ts` `reorderProject(ctx, id, { before_id?, after_id? })` (decision 4, the
same shape as `reorderCycle`); `search.ts` retired-identifier key hits (decision
86); P7 `notifications.ts` `module_updated` text and routing (decision 87); P5
`ai/digest-store.ts` `digestInputs` for `home` (from `sinceLastVisit`) and
`analytics` (from `getAnalytics`, parsed from the entity id), `ai/prompts.ts` two
short digest prompts, `ai/client.ts` workspace overrides (decision 84).

**Tools** (new file `tools/registry/workspace.ts`, plus one entry in `projects.ts`'s
registry file and `analytics` in `tools/registry/analytics.ts`; all phase `P9`):

| Tool | Input | Mutates | Notes |
|---|---|---|---|
| `list_favorites` | `{}` | no | tree |
| `add_favorite` | AddFavoriteInput | yes | |
| `remove_favorite` | RemoveFavoriteInput | yes | |
| `move_favorite` | MoveFavoriteInput | yes | |
| `create_favorite_folder` | `{ name }` | yes | |
| `rename_favorite_folder` | `{ folder_id, name }` | yes | |
| `move_favorite_folder` | `{ folder_id, before_id?, after_id? }` | yes | |
| `delete_favorite_folder` | `{ folder_id }` | yes | not destructive (decision 75) |
| `list_stickies` | `{ query?, limit? }` | no | |
| `create_sticky` | `{ name?, description_md?, color? }` | yes | |
| `update_sticky` | `{ sticky_id, name?, description_md?, color? }` | yes | |
| `move_sticky` | `{ sticky_id, before_id?, after_id? }` | yes | |
| †`delete_sticky` | `{ sticky_id }` | yes | destructive |
| `list_quick_links` | `{}` | no | |
| `add_quick_link` | `{ url, title? }` | yes | |
| `update_quick_link` | `{ quick_link_id, url?, title? }` | yes | |
| `move_quick_link` | `{ quick_link_id, before_id?, after_id? }` | yes | |
| `remove_quick_link` | `{ quick_link_id }` | yes | not destructive (decision 83) |
| ★`get_home_summary` | `{}` | no | |
| ★`get_analytics` | GetAnalyticsInput | no | |
| `get_profile_summary` | `{ actor_id }` | no | |
| `get_workspace_settings` | `{}` | no | |
| `update_workspace_settings` | UpdateWorkspaceSettingsInput | yes | |
| `reorder_project` | `{ project_id, before_id?, after_id? }` | yes | |

`list_activity` and `get_counts` change inputs only. tools.md's Workspace row is
rewritten to this list (no `list_recents`, notification tools stay in P7's row). The
P8 access gate (decision 63) applies unchanged; P5 adds `propose_*` stubs for the
mutating ones automatically.

**Tests (Vitest, lane A)**: `tests/workspace/favorites.test.ts` (unique, folders,
moves across levels, folder delete keeps favourites, read-time hiding of archived and
deleted entities and of archived projects), `stickies.test.ts`, `quick-links.test.ts`
(URL rule), `workspace-settings.test.ts` (normalize widgets, ai overrides),
`home.test.ts` (since-last-visit: user rows excluded, collapse per target, cap and
`more`, null anchor = 7 days, `setHomeSeen` never moves back and writes no activity;
`your_work` equals `getCounts`), `profile.test.ts`, `tests/analytics/counts-parity.test.ts`
(exit criterion: workspace, one project, two projects; every dimension shared with
`Counts`), `breakdown.test.ts` (segments, multi-valued, `none`, `state` with two
projects is `VALIDATION`, points rule), `trend.test.ts` (daily and weekly buckets,
local dates), `tests/static-views.test.ts`, `tests/projects-reorder.test.ts`,
`tests/search-retired.test.ts`, `tests/notifications-module.test.ts`,
`tests/ai/digest-store.test.ts` additions; the registry test (decision 26) passes with
the new tools.

### 5. Routes and data loading

Every page: synchronous shell (`PanelPage` + `PanelHeader`) → `<Suspense
fallback={<Skeleton…/>}>` → async child awaits `params`/`searchParams`, `await io()`,
then `readTessera(fn)`. Parse params with the zod enums and `.catch(<default>)`;
`notFound()` / `redirect()` outside `try`.

| Route | Owner | Loading |
|---|---|---|
| `(tessera)/page.tsx` (Home, replaces P6's) | U1 | One boundary: `readTessera(getHomeSummary)` → `HomeScreen summary`. Recents widget is client. |
| `(tessera)/stickies/page.tsx` | U1 | `?q=` → `listStickies({ q })` |
| `(tessera)/settings/page.tsx` | U1 | `redirect("/settings/general")` |
| `(tessera)/settings/[tab]/page.tsx` | U1 | `tab ∈ general, ai`, else `notFound()`; `getWorkspaceSettings` |
| `api/home/seen/route.ts` | U1 | `POST { seq }` (beacon), `request-guards.ts` same-origin check, `setHomeSeen`; 204 |
| `(tessera)/your-work/page.tsx` | U3 | `redirect("/your-work/summary")` |
| `(tessera)/your-work/[tab]/page.tsx` | U3 | `ProfileTabSchema`; summary → `getProfileSummary(USER)`; work tabs → `listWorkItems({ scope: profile })` + `getViewSettings("profile", USER)` + bundles (below); activity → `listActivity({ actor_id, limit: 50 })` |
| `(tessera)/agents/page.tsx` | U3 | `listAgentProfiles` |
| `(tessera)/agents/[actorId]/page.tsx` and `[tab]/page.tsx` | U3 | as Your work; user id → redirect; unknown actor → `notFound()` |
| `(tessera)/workspace-views/page.tsx` | U3 | `listViews({ project_id: null })` + `favoriteIds("view")`; `?create=1` opens `ViewDialog` |
| `(tessera)/workspace-views/[viewId]/page.tsx` | U3 | static key → `staticViewScope` + `getViewSettings("workspace", …)`; else `getView` (must have `project_id null`, else redirect to the project view) + `listWorkItems({ scope: view })` |
| `(tessera)/active-cycles/page.tsx` | U2 | `getActiveCycles` → for each, `loadCycleDetail(ctx, project, id, false)` (live projects with cycles enabled, project order) |
| `(tessera)/analytics/page.tsx` | U4 | `redirect("/analytics/overview")` |
| `(tessera)/analytics/[tab]/page.tsx` | U4 | `AnalyticsTabSchema`; `searchParams` → `projects`, `range`, `x`, `segment`, `measure` (each `.catch`); `getAnalytics` + `getStoredDigest("analytics", id)` + `listProjects` for the filter; one boundary keyed by the search string |
| `(tessera)/layout.tsx` sidebar loader | U2 | adds `listFavorites` and `getWorkspaceSettings().name` to the sidebar data (one `readTessera`) |

**Cross-project bundles** (U3, core change, **refresh before build**): workspace,
static, profile and workspace-view lists hold rows from many projects. The route loads
`loadProjectBundles(ctx, project_ids)` (new, next to P4's bundle loader) for the
projects present on the page and passes `bundles: Record<string, ProjectBundle>` to
`WorkItemsScreen`; the table/list/board cells resolve a row's bundle by
`row.project_id`, so state, labels, cycle and module edits work per row. Grouping
offered in these scopes: `state_group`, `priority`, `assignees`, `project`,
`created_by`, `start_date`, `target_date`, `created_at`, none; `state`, `labels`,
`cycle` and `module` are hidden because their values belong to one project.

**Recents** (`recents.ts` `resolveRoute`, `shell-icons.ts`; U2):

| Path | Label | Icon key (new keys in bold) |
|---|---|---|
| `/` | Home | home |
| `/your-work/<tab>` | Your work · <Tab> | **your-work** (`UserCircleIcon`) |
| `/agents` | Agents | **agents** (`RobotIcon`) |
| `/agents/<id>/<tab>` | <actor name> · <Tab> (`lookup.actorLabel`, fallback "Agent") | **agents** |
| `/workspace-views` | Workspace views | views (P4) |
| `/workspace-views/<key or id>` | static name, or `lookup.entityLabel(id)`, fallback "View" | views |
| `/active-cycles` | Active cycles | cycles |
| `/analytics/<tab>` | Analytics · <Tab> | **analytics** (`ChartBarIcon`) |
| `/stickies` | Stickies | **stickies** (`NoteIcon`) |
| `/settings/<tab>` | Settings · <Tab> | settings (`GearIcon`) |

`RouteLookup` gains `actorLabel?(id)` fed from `listActors` in the shell provider.

### 6. Screens and components

Rules for every lane: no raw `<div>`/`<span>`, hex or px; layout through Astryx
props, then a className with tokens in the lane's stylesheet under
`src/components/styles/`; icons only from `src/themes/catppuccin/icons.tsx`;
`Dialog`/`AlertDialog` from `@/components/shell/dialogs`; panel headers use
`PanelHeader`/`PanelBar`, never `Toolbar`; rows use `List`/`ListItem` or `Table`, not
Card-wrapped lists; `Badge` for counts only; mutations through `toolAction(...)`
wrappers in `src/app/actions/*.ts` ending in `refresh()`.

**Astryx verification (0.6.8 `.d.ts`)**: `SideNavSection { title, subtitle?,
endContent?, isHeaderHidden?, children }`; `SideNavItem { label, icon?, href?,
isSelected?, endContent?, actions?, collapsible?, onClick?, children? }` (folders are
collapsible items with child items); `Grid { columns?, gap?, rowGap?, minHeight? }`
with an auto-fill `{ minWidth, max?, repeat }` column config; `Card { padding?,
variant?, elevation? }`; `ClickableCard { label, href?, onClick?, padding? }`;
`ProgressBar { value, max?, label, isLabelHidden?, hasValueLabel?,
formatValueLabel?, variant? }`; `TabList { value, onChange, size?, layout?,
hasDivider? }` + `Tab { value, label, href?, icon?, endContent? }`; `SegmentedControl
{ value, onChange, label, size? }`; `Selector { label, isLabelHidden?, options,
size?, hasSearch?, startIcon?, renderOption?, renderValue? }`; `MultiSelector {
label, options, value: string[], onChange }`; `MoreMenu { items:
DropdownMenuOption[], label?, size?, variant? }`; `Popover { content, isOpen?,
onOpenChange?, width?, padding?, label? }`; `MetadataList { columns?, orientation?,
title? }`; `EmptyState { title, description?, icon?, actions?, isCompact? }`;
`Table` (P2 usage); `Switch`, `TextInput`, `ToggleButton`, `Token`, `Avatar`,
`StatusDot`, `Skeleton`, `Timestamp` as used since P2. Recharts: `BarChart`, `Bar
(stackId)`, `LineChart`, `Line`, `AreaChart`, `Area`, `XAxis`, `YAxis`,
`CartesianGrid`, `Tooltip`, `Legend`, `Cell`, all with `responsive` and colours from a
`useChartColors`-style resolver (`chart-colors.ts` gains a categorical list; U4 owns
it after lane 0 moves it to `src/components/charts/chart-colors.ts`).

#### U1 Home, stickies, quick links, workspace settings (`src/components/home/`, `stickies/`, `settings/`)

- `HomeScreen({ summary })`: `PanelPage width="reading"`, header "Home" with a
  `MoreMenu` "Manage widgets…"; widgets in `summary.widgets` order, disabled ones
  skipped; `VStack gap={6} padding={6}`.
- `SinceLastVisit({ since, digest })`: `Card` titled "Since you were last here" with
  "Last visit <RelativeTime>"; `List hasDividers` of `SinceEntry` rows: `Avatar` of the
  actor, label "<actor> <verb phrase> <target label>" (phrases from P2's
  `activity-text.ts`), `description` fields changed and count, `endContent`
  `RelativeTime`, `href` target. `EmptyState isCompact` "Nothing new" ("Agents and
  automations have not changed anything since your last visit."). Footer: "+N more"
  (link to `/inbox`), "Mark as seen" (server action `markHomeSeenAction(seq)` →
  `setHomeSeen` + `refresh()`). Below: P5 `DigestCard kind="home" id="workspace"`
  (hidden when AI is unavailable or `digest_enabled` is false). A client effect
  sends the beacon on `pagehide` and in the layout-effect cleanup (route hidden, field
  guide "Next 16").
- `QuickLinksWidget`: `HStack wrap` of `Token`-style link chips (`Link` + favicon-less
  `LinkSimpleIcon`), each with a `MoreMenu` Edit / Move left / Move right / Remove;
  "Add link" opens `QuickLinkDialog` (`Dialog width={420}`, `TextInput` URL and Title).
- `RecentsWidget`: P2's `RecentsList` gains `filter?: "all" | "work-items" | "pages" |
  "projects"` and `limit?`; a `SegmentedControl size="sm"` above it.
- `YourWorkWidget({ numbers })`: `MetadataList columns={3}` (Assigned open, Overdue,
  Due this week, Created open, Subscribed open), then one `HStack wrap` of
  `StatusDot` (decision 22 variants) + group name + count per state group; link "Open
  Your work" → `/your-work/summary`.
- `StickiesWidget({ stickies })`: `Grid` auto-fill `minWidth` from a token, up to 6
  `StickyCard`s (read-only preview, click → `/stickies#<id>`), "New sticky" (create
  then navigate), "All stickies".
- `ManageWidgetsDialog` (`Dialog width={420}`): `List` of the five widgets, each a
  `Switch` and a `MoreMenu` Move up / Move down; Save → `updateWorkspaceSettingsAction({
  home_widgets })`.
- `StickiesScreen({ stickies, q })`: header "Stickies" with `TextInput` search
  (debounced URL `q`) and "New sticky"; `Grid` of `StickyCard` (`Card` with a
  palette-tinted class from `stickies.css`, `TextInput variant` borderless name,
  `MarkdownEditor` body with 800 ms debounce, colour `Selector` of palette keys,
  `MoreMenu` Move earlier / Move later / Delete → `AlertDialog`). `EmptyState`
  "No stickies yet".
- Settings: `WorkspaceSettingsScreen({ tab, settings })` with `TabList` General / AI
  (`href` tabs); General: `TextInput` workspace name (save on blur); AI: `Selector`
  model (free `TextInput` with "Default (env)" placeholder), `Selector` effort (Default,
  low, medium, high, xhigh), `Switch` "Digests and summaries"; the `/api/ai/status`
  result shown as a `Banner` when unavailable.
- Actions: `actions/{home,stickies,quick-links,workspace-settings}.ts`.
- `styles/home.css`, `styles/stickies.css` (lane 0 creates them).

#### U2 Shell: sidebar, favourites, logo picker, project menu, active cycles (`src/components/shell/`, `favorites/`)

- `Sidebar.tsx`: decision 76 order; new items with icons `UserCircleIcon`,
  `TableIcon` (Workspace views), `CycleIcon` (Active cycles), `ChartBarIcon`,
  `RobotIcon`, `ArchiveIcon`. `FavoritesSection({ tree })`: `SideNavSection
  title="Favorites" endContent` "New folder" `IconButton`; folders as
  `SideNavItem collapsible` with child items; each item `actions` = `MoreMenu`
  (Open, Move up, Move down, Move to folder → submenu of folders + "Top level",
  Remove from favorites; folders: Rename, Move up, Move down, Delete folder). Drag with
  P2's `use-pointer-drag.ts` (vertical list; drop on a folder row moves into it) →
  `moveFavoriteAction`; optimistic with `useOptimistic` (decision 13).
- Project rows: drag reorder → `reorderProjectAction`; `actions` = `ProjectMenu`
  (`MoreMenu`: Settings, Archives, Copy link, Add to/Remove from favorites, Draft work
  item → `/drafts?draft=new&project=<id>` (P8 route), Archive project → P3
  `ProjectArchive` confirm, Move up / Move down).
- `FavoriteDialog` folder create/rename (`Dialog width={420}`).
- `FavoriteButton({ entityType, entityId, isFavorite, size? = "sm" })`:
  `ToggleButton` with `StarIcon` (filled when on), label "Add to favorites" /
  "Remove from favorites", calls `addFavoriteAction`/`removeFavoriteAction`. Placed by
  U2 in `ProjectFrame.tsx` (project header), `CycleHeader.tsx`, `ModuleHeader.tsx`,
  P6 `PageScreen` header; `CycleMenu`/`ModuleMenu`/P6 `PageRowMenu` get "Add to
  favorites". U3 places it in the view header (props fixed here). The server pages
  pass `isFavorite` from `isFavorite()` / `favoriteIds()` (**refresh before build**:
  the P3/P4/P6 page loaders that own those headers).
- `LogoFields({ value: Logo | null, onChange(logo: Logo), size?: "sm" | "md" })`
  (lane 0 extracts it from `CreateProjectDialog.tsx`); U2 adds it to P6's page
  settings menu ("Change icon…" `Popover`), U3 to `ViewDialog`.
- `ActiveCyclesScreen({ cycles })`: header "Active cycles"; per cycle a section with
  the project token + name link and P3's `ActiveCycleSummary`; `EmptyState` "No active
  cycles" ("Cycles whose dates include today show up here.").
- Shell registry: `recents.ts`, `shell-icons.ts`, `shortcuts.ts` (`g j`, `g a` live),
  `useShortcuts.ts`, `command-source.ts` (Go to Your work, Agents, Workspace views,
  Active cycles, Analytics, Stickies, Workspace settings; New sticky; Add to favorites
  / Remove from favorites for the current project, cycle, module, view or page),
  `TopBar.tsx` brand name.
- Actions: `actions/favorites.ts`, `reorderProjectAction` in `actions/projects.ts`.
- `styles/favorites.css`.

#### U3 Work lists: workspace views, static views, profiles, list controls (`src/components/views/`, `profile/`, planning lists)

- `WorkspaceViewsScreen({ views, favorites })`: header "Workspace views" with "New
  view"; `List` section "Default views" (4 static rows, `TableIcon`, no menu) and
  section "Saved views" (P4 `ViewRow` with `logo`, star, P4 `ViewMenu`); the P4 views
  list controls (decision 88: `Selector` sort, `TextInput` search) apply to both the
  project views list and this one.
- View page: P4's view page generalised to `projectId: string | null`; with null it
  forces `layout: "table"`, hides the layout switch and adds the Project column and
  the project filter in `FilterBar`. Static views: read-only header (name, no
  `ViewMenu`, no Update view; display changes go to `saveViewSettingsAction` scope
  `workspace`/`static:<key>`). `FavoriteButton` in the saved-view header; `LogoFields`
  in `ViewDialog`.
- `ProfileScreen({ actor, tab, … })`: header = `Avatar` + name + kind `Token` (+ P8
  access `Token` for agents); `TabList` Summary / Assigned / Created / Subscribed /
  Activity (`href` tabs). Summary: `MetadataList` of the numbers, a state-group strip
  and a priority strip (`ProgressBar` per value with `formatValueLabel`), "Projects"
  `List`, "Recent activity" (P2 `ActivityFeed` rows with the work item key). Work tabs:
  `WorkItemsScreen` with the profile scope, layouts list/board/table, cross-project
  bundles (§5). Activity: `List` of activity rows grouped by day, "Load more"
  (`?before=<seq>`).
- `AgentsScreen({ rows })`: `Table` (Name with `Avatar`, Kind, Access, Assigned open,
  Last activity `RelativeTime`, Activity 7 days); row click → profile.
- Mention chips (`actor:<id>`) and `entityRoute` gain the profile route (user →
  `/your-work/summary`).
- `WorkItemsScreen`/`TableLayout`/`ListLayout`/`BoardLayout`: `bundles` prop and the
  per-row bundle lookup; grouping options for cross-project scopes (§5).
- `CyclesScreen`/`ModulesScreen` (P3): decision 88 controls in the panel header
  `PanelBar end` (`TextInput size="sm"` search, `Selector size="sm"` sort, modules
  `MultiSelector` status and `Selector` lead).
- `styles/profile.css`, `styles/workspace-views.css`.

#### U4 Analytics (`src/components/analytics/`, `src/components/charts/`)

- `AnalyticsScreen({ tab, result, projects, filters, digest })`: header "Analytics"
  with `TabList` Overview / Work items / Cycles / Modules (`href` tabs keeping the
  query), `PanelBar end`: project `MultiSelector size="sm"` (empty = "All projects")
  and range `SegmentedControl` 7d / 30d / 90d / 1y; filters write the URL
  (`router.replace`, no refresh needed: the page re-reads `searchParams`).
- Overview: KPI row (`Grid` of `Card` with `Heading` number + `Text` label; numbers
  link to the matching filtered list), "Work items by state group" (horizontal stacked
  `BarChart`), "Created vs completed" (`AreaChart`, two series with dash patterns),
  "By priority" (`BarChart`), "Top assignees" (`Table`), "Projects" (`Table` with
  `ProgressBar`).
- Work items: `PanelBar` with `Selector` X axis, `Selector` Segment (incl. None),
  `SegmentedControl` Count / Points (Points disabled with `disabledMessage` when
  unavailable); a stacked `BarChart` (`Bar stackId="s"` per segment key, `Cell` colours
  per bucket when unsegmented); the data `Table` below (rows = buckets, columns =
  segments + Total); the trend chart.
- Cycles: `BarChart` completed vs pending for up to 12 cycles (newest end date first)
  + `Table` with `ProgressBar` completion and links. Modules: by-status bar + `Table`.
- `NarrativeCard`: P5 `DigestCard kind="analytics" id={narrativeId(tab, filters)}`.
- `charts/` (shared, U4 owns): `ChartFrame` (title, `Skeleton` until hydrated,
  `role="img"` + `aria-label` summary, the table toggle), `chart-colors.ts`
  (categorical token list, decision 80), `palette-colors.ts` (palette key → data
  token), `analytics-format.ts` (pure: top-N + Other, labels, `narrativeId`,
  `parseAnalyticsParams`), `tests/ui/analytics-format.test.ts`.
- `styles/analytics.css`.

### 7. Lane split for swarm workers

| Lane | Starts | Owns (one owner per file) |
|---|---|---|
| **0 prep** (alone, mechanical) | first | `schemas.ts`/`types.ts` additions of §3; icons in `icons.tsx` (`StarIcon` = Star, `StarFillIcon` = Star fill weight, `ChartBarIcon` = ChartBar, `NoteIcon` = Note, `UserCircleIcon` = UserCircle, `RobotIcon` = Robot, `FolderStarIcon` = FolderSimpleStar); `src/components/shell/LogoFields.tsx` extracted verbatim from `CreateProjectDialog.tsx` (the dialog imports it); move `planning/chart-colors.ts` to `src/components/charts/chart-colors.ts` (BurndownChart imports it); stylesheets `home, stickies, favorites, profile, workspace-views, analytics` (header comment only) and their `globals.css` imports. Gate: `npm run check` green, no behaviour change. **Refresh before build**: re-read `scripts/file-budget.json`; P9 must not grow `cycles.ts`, `modules.ts` or `CommandBar.tsx` (the plan avoids them); if `WorkItemsScreen.tsx`, `TableLayout.tsx`, `ListLayout.tsx`, `BoardLayout.tsx`, `Sidebar.tsx`, `counts.ts`, `search.ts`, `changes.ts` or `command-source.ts` is listed or within 40 lines of 600, lane 0 splits it first at section comments, verbatim. |
| **A engine** | after 0 | `src/lib/tessera/{workspace,analytics}/**`, `static-views.ts`, `counts.ts`, `changes.ts`, `views.ts`, `view-settings.ts`, `projects.ts`, `search.ts`, `index.ts`, `server.ts`, `notifications.ts` (P7), `ai/{digest-store,prompts,client}.ts` (P5), `db/schema/workspace.ts`, `drizzle/0006_*` + `meta`, `tools/registry/{workspace,analytics}.ts` and the `reorder_project` entry, `TOOLS` index, the startup call of `ensureWorkspaceSettings`, every `tests/**` of §4, `docs/contracts/{schema,service-api,tools,ai}.md`, decisions 72–88 into `docs/PLAN.md` (plus the §2, §5, §7 edits of decision 74). Hands off the tool names and inputs on day 1 (fixed here). |
| **U1 home** | after 0 | `src/app/(tessera)/{page.tsx,stickies/**,settings/**}`, `src/app/api/home/seen/route.ts`, `src/components/{home,stickies,settings}/**`, `shell/RecentsList.tsx`, `actions/{home,stickies,quick-links,workspace-settings}.ts`, `styles/{home,stickies}.css`, `tests/ui/home-widgets.test.ts` |
| **U2 shell** | after 0 | `shell/{Sidebar,FavoritesSection,FavoriteButton,FavoriteDialog,ProjectMenu,TopBar,recents,shell-icons,shortcuts,useShortcuts,command-source}.ts(x)`, `src/components/favorites/**` (if split out), `(tessera)/layout.tsx` sidebar loader, `(tessera)/active-cycles/**`, `components/planning/{ActiveCyclesScreen,CycleHeader,ModuleHeader,CycleMenu,ModuleMenu}.tsx`, `work-items/ProjectFrame.tsx`, P6 `pages/{PageScreen,PageRowMenu}.tsx` (star and logo only), `actions/favorites.ts`, `actions/projects.ts`, `styles/favorites.css`, `tests/ui/{recents,favorites-tree}.test.ts` |
| **U3 work lists** | after 0 | `(tessera)/{your-work,agents,workspace-views}/**`, `src/components/{views,profile}/**` (P4 views files included), `work-items/{WorkItemsScreen,TableLayout,ListLayout,BoardLayout,display-options}.ts(x)`, the bundle loader file, `planning/{CyclesScreen,ModulesScreen}.tsx`, `editor/links.ts`/`entityRoute` (actor route), `actions/{views,profile}.ts`, `styles/{profile,workspace-views}.css`, `tests/ui/{list-controls,static-views}.test.ts` |
| **U4 analytics** | after 0 | `(tessera)/analytics/**`, `src/components/{analytics,charts}/**`, `planning/BurndownChart.tsx` (import path only), `styles/analytics.css`, `tests/ui/analytics-format.test.ts` |

Cross-lane contracts fixed here: tool names and inputs (§4); `FavoriteButton`,
`LogoFields`, `RecentsList` `filter`/`limit` props; `bundles` prop name on
`WorkItemsScreen`; `DigestCard` ids (decisions 73, 81); `RouteIconKey` additions.

### 8. New dependencies

None. Recharts 3.10.1 (MIT) and `react-is` 19.3.0 were added in P3; everything else
is installed (Astryx 0.6.8, Drizzle 0.45.4, drizzle-kit 0.31.11, zod 4,
`@phosphor-icons/react`). The licence gate is unchanged.

### 9. Acceptance (on a fresh `data/p9-acceptance.db` after `next build`)

Stop the dev server, `next build`, move any old `data/p9-acceptance.db*` to the
scratchpad, `TESSERA_DB_PATH=data/p9-acceptance.db npm run db:migrate`, then start
`next start -H 127.0.0.1 -p 3000` with the same variable. MCP:
`TESSERA_DB_PATH=data/p9-acceptance.db npx tsx scripts/mcp-call.ts --client <name>
<tool> '<json>'`. Console clean on every screen (only the known Astryx Table
warnings); Frappé and Latte at 1440 and 375.

1. Home on the empty database: widgets in the order Since you were last here, Quick
   links, Recents, Your work, Stickies; "Nothing new"; Your work numbers 0.
2. Create projects `WEB` and `OPS`; create 6 items in WEB (2 assigned to you, one
   with a target date yesterday, one tomorrow) and 2 in OPS. Home › Your work shows
   Assigned open 2, Overdue 1, Due this week 1; `get_counts { scope: { type:
   "profile", actor_id: <user> } }` over MCP matches.
3. MCP as `bot-a`: update WEB-1 state to In Progress, comment on WEB-2, create a
   module "Auth" in WEB with you as a member (`set_module_members`), change its
   status. Reload Home: three collapsed entries by `mcp:bot-a` (WEB-1, WEB-2, Auth);
   your own edits from step 2 are absent. Inbox shows a `module_updated` notification for Auth.
4. Navigate to Projects and back to Home: the entries are gone ("Nothing new").
   MCP `bot-a` edits WEB-3; Home shows only WEB-3. Click "Mark as seen": empty.
5. Summarise on the Home digest (AI available): a digest naming WEB-3 is stored;
   reload shows it without a new request.
6. Quick links: add `https://plane.so` (no title → "plane.so") and `/projects` titled
   "All projects"; the external one opens in a new tab; Move right reorders; remove one
   without a confirm. `javascript:alert(1)` is refused with a field error.
7. Stickies: New sticky from Home → `/stickies`; type a body, wait 1 s, reload: kept.
   Change colour to blue; search finds it by a body word; Delete asks to confirm.
8. Manage widgets: hide Stickies, move Quick links to the top, Save; Home follows;
   `get_workspace_settings` shows the order.
9. Favourites: star WEB (project header), cycle and module "Auth" headers, and a WEB
   view. The sidebar Favorites lists four; create folder "Planning", drag Auth into
   it, Move up/down via the menu; delete the folder → Auth is back at the top level.
   Archive module Auth → its favourite disappears; unarchive → back (cycles archive
   only after their end, decision 16).
10. Sidebar: drag OPS above WEB; reload keeps the order. The WEB `…` menu: Copy link,
    Settings, Draft work item (opens the draft dialog with WEB), Remove from favorites.
11. Workspace views: `/workspace-views` lists All work items, Assigned, Created,
    Subscribed and no saved views. "Assigned" shows your 2 items in a table with a
    Project column; no layout switch. Change its ordering, leave and return: kept.
12. New view "All urgent" (workspace) with priority urgent and project filter WEB+OPS;
    Save; change a filter → "Update view" appears (decision 32); star it; edit its logo
    to Rocket/red: the row and the favourite show it.
13. Inline-edit the state of an OPS row in the workspace table: the OPS states are
    offered and the change sticks (cross-project bundles).
14. Your work (`g j`): Summary numbers equal step 2; Assigned shows list/board/table;
    group by Project works; Subscribed lists the items you are subscribed to (P7
    auto-subscribe on assign and comment); Activity lists your step 2 changes newest first with Load more.
15. Agents: `/agents` lists Assistant, System and `mcp:bot-a` with Assigned open and
    Last activity; open `bot-a` → Activity shows step 3's changes; a mention chip of
    `bot-a` in a comment opens this profile.
16. Active cycles: create a current cycle in WEB with 3 items; `/active-cycles` shows
    WEB's summary with burndown; turning cycles off in OPS changes nothing; with no
    current cycle the empty state shows.
17. Analytics (`g a`) › Overview: KPIs equal `get_counts { scope: { type: "workspace"
    } }` (work items, open, completed, overdue, due this week); state-group and
    priority charts match the table under them.
18. Filter projects = WEB: numbers equal `get_counts` project scope for WEB. Range
    7d → the created vs completed chart has 7 daily points.
19. Work items tab: X = Assignee, Segment = Priority; the table totals equal
    `Counts.by_assignee`; X = State with two projects selected is not offered. Points
    is disabled with its message; turn on Estimates in WEB with a points system
    (P8), filter WEB → Points works.
20. Cycles and Modules tabs list the WEB cycle and Auth with completion bars.
    Summarise on Overview stores a narrative; changing the range shows the
    narrative's empty state for that id.
21. Settings › AI: turn off "Digests and summaries" → every Summarise button and the
    Home digest disappear; turn it back on. Settings › General: rename the workspace
    → the top bar brand follows.
22. Power K: type `WEB-1` after renaming WEB to `WEBX` (P4 settings) → the hit shows
    `WEBX-1` "was WEB-1"; "Go to Analytics", "New sticky" and "Add to favorites" (on a
    module page) work.
23. Recents: the Home Recents filter "Pages" lists only page routes; the recents
    labels for `/your-work/assigned`, `/analytics/work-items`, `/stickies` read "Your
    work · Assigned", "Analytics · Work items", "Stickies".
24. Cycles list: search "Sprint" filters; sort by End date; Move up is disabled until
    sort is Manual. Modules list: status filter and lead filter. Views list: sort by
    Name.
25. 375 px: Home widgets stack, analytics charts fit without horizontal page scroll,
    the sidebar drawer shows Favorites.

### 10. Risks

| Risk | Mitigation |
|---|---|
| Analytics and `getCounts` drift (two code paths) | Analytics takes its population from `countsPopulation` (one `WHERE`), and the parity test covers every shared number for three scopes |
| Cross-project bundles in the table/list/board ripple through P4–P8 code | U3 owns all four layout files; the bundle lookup is one hook; if it grows too far, workspace scopes ship with read-only state/label cells and the contract records it (**refresh before build**) |
| Beacon on route hide: Next keeps Home mounted under `<Activity mode="hidden">`; layout-effect cleanup runs at hide time but may also run on fast refresh | `setHomeSeen` is idempotent and only moves forward; it clamps to `latestSeq` |
| Recharts `responsive` measures the DOM; SSR renders nothing and charts can shift | `ChartFrame` reserves height with a `Skeleton` until hydrated (P3 pattern) |
| Chart colours in Latte below 3:1 | Categorical order avoids green and peach first (P3 contrast note); every series is named in legend and table; contrast test extended to the categorical list (pragmatic, per memory) |
| Sidebar drag fights the SideNav resize handle and its own links | Drag starts only from a `DragHandleIcon` handle shown on hover/focus; click navigates as before |
| P4–P8 names differ from this plan (`DigestCard`, `digest-store`, `loadProjectBundle`, view page files, P6 page header, P7 collapse) | Marked **refresh before build** |
| Analytics queries over a large database | Single GROUP BY per chart, `work_item_completed_idx`; the trend for `365d` is weekly |
| Sticky last-write-wins loses an agent's concurrent edit | Accepted for single-user notes; documented in decision 82 |

### 11. Open questions for the user (each with the default the plan uses)

1. **Drop the server-side recents table** and keep recents per browser? Default: yes
   (decision 74).
2. **"Since you were last here" moves on when you leave Home** (and with "Mark as
   seen"), not only on the button? Default: on leaving.
3. **Analytics project filter** is multi-select with "All projects" as default, range
   default 30 days? Default: yes.
4. **An "Agents" item in the sidebar** (AI-first; Plane has none)? Default: yes,
   after Analytics.
5. **Deleting a favourites folder keeps its favourites** (moved to the top level)?
   Default: yes.
6. **Stickies save as you type** (800 ms) with last write wins? Default: yes.
7. **Cycle notifications and analytics tabs for intake/estimates are not built**?
   Default: not built (§1).
8. **The top bar brand shows the workspace name** from Settings › General? Default:
   yes, "Tessera" until renamed.

### Refresh before build (checklist for the contract planner)

- File budget after P8 (§7 lane 0) and the exact paths of P4's views files, bundle
  loader and project view page, P6's page header and row menu, P7's notification
  collapse and `actor:` link handling, P5's digest helpers and `DigestCard` props.
- P5's `ListActivityInput` refine and `DigestKindSchema` location; P7's
  `NotificationKindSchema` location.
- Where P6 placed the Wiki sidebar item (decision 76 order).
- Whether P4 already added a `reorder_project` (p4-tools.md says not).
