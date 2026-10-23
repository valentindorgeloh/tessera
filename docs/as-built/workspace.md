# As-built map: workspace surfaces (P9)

State described: the working tree after the fix-all round (2026-10-21) and the visual alignment round (2026-10-22, on HEAD 5f0cc7c: quick link cards, sticky cap, two-row analytics and profile headers, workspace settings tables and touch targets). Line counts are tree counts. Fix round 3 (2026-10-23) refreshed only the lines on text-input stacking, the Home "+N more" link, the settings tab strips and the Backups fold. Decision numbers are rows of the "Resolved design decisions" table in docs/PLAN.md. Plan: docs/drafts/p9-plan.md.

## 1. Purpose and boundaries

The surfaces that are not tied to one project: Home, Favourites in the sidebar, Your work and agent profiles, Workspace views, Active cycles, Analytics, Stickies, Quick links and the General and AI workspace settings. Each is a thin screen over `src/lib/tessera/workspace/**` or `analytics/**`; the numbers come from `getCounts` (decision 21) so they never disagree with the lists.

Lives elsewhere (this area only calls it):
- Shell, sidebar chrome, recents, Power K: shell-detail.md (`shell/Sidebar.tsx`, `recents*.ts`). This file maps only what the sidebar shows from P9.
- Saved workspace views and the four static views: views-settings.md.
- Exports, Webhooks and Backups workspace settings tabs: operations.md and hardening.md.
- The Home digest and the analytics narrative model call: ai.md.
- Cycle and module charts: planning.md (`BurndownChart`); `charts/` here holds the analytics chart frame and series charts.

## 2. File map

### Engine (`src/lib/tessera/workspace/`, `analytics/`)

| File | Responsibility | Key exports |
|---|---|---|
| `workspace/settings.ts` (135) | The `workspace_settings` singleton: name, home widgets, AI overrides, week start, Home seen cursor. `ensureWorkspaceSettings` inserts with `onConflictDoNothing` so concurrent first opens are safe. | `getWorkspaceSettings`, `updateWorkspaceSettings`, `ensureWorkspaceSettings`, `normalizeHomeWidgets` |
| `workspace/home.ts` (45), `since.ts` (172), `home-seen.ts` (29) | `getHomeSummary` is the single Home read (widgets, since-last-visit, quick links, your-work counts, six stickies, stored digest). `sinceLastVisit` lists non-user activity after the cursor, collapsed per actor and target (a null cursor means 7 days). `setHomeSeen` moves the cursor forward only and writes no activity. | `getHomeSummary`, `sinceLastVisit`, `setHomeSeen` |
| `workspace/favorites.ts` (471) | Favourites with one-level folders; one live favourite per entity; resolved at read time (deleted or archived entities drop out). | `listFavorites`, `addFavorite`, `removeFavorite`, `moveFavorite`, `createFavoriteFolder`, `deleteFavoriteFolder` |
| `workspace/stickies.ts` (196), `quick-links.ts` (129) | Stickies (new first, `LIKE` search) and quick links (`http(s)` URL or an app path starting `/`). | `createSticky`, `moveSticky`, `listStickies`, `addQuickLink`, `moveQuickLink` |
| `workspace/profile.ts` (109) | Your work and agent profile summaries from `getCounts` profile scopes; agent list. | `getProfileSummary`, `listAgentProfiles` |
| `analytics/index.ts` (77) and `overview.ts`, `breakdown.ts`, `planning.ts`, `trend.ts`, `population.ts`, `dimensions.ts`, `dates.ts` | `getAnalytics` per tab. Distributions use the `getCounts` population; trends include archived items of live projects; one item counts once per value of a multi-valued dimension plus a `none` bucket; `points` needs an active points estimate in every project in scope. | `getAnalytics`, `analyticsForDigest` |
| `static-views.ts`, `counts.ts` | Static workspace view scopes and the counts every surface shares (views-settings.md). | |

Registry tools (`tools/registry/workspace.ts`, `analytics.ts`): `get_home_summary`, `get_profile_summary`, `get/update_workspace_settings`, favourite tools (8), sticky tools (5), quick link tools (5), `get_analytics`. Wrappers: `actions/{home,favorites,stickies,quick-links,workspace-settings}.ts`. Route: `api/home/seen` (beacon).

### Routes (`src/app/(tessera)/`)

| Path | Responsibility |
|---|---|
| `page.tsx` | Home at `/`: one `getHomeSummary` after `io()`; opening Home generates no digest. |
| `your-work/[tab]/page.tsx`, `profile-page.tsx` (93), `agents/page.tsx`, `agents/[actorId]/[tab]/page.tsx` | Profile of the user (`/your-work`) or of an agent; tabs summary, assigned, created, subscribed, activity (`/agents/<user id>` redirects to `/your-work`). |
| `workspace-views/**`, `active-cycles/page.tsx` (51) | Static and saved workspace views; active cycles across projects (`getActiveCycles`). |
| `analytics/[tab]/page.tsx` (65), `load.ts` (73) | Tabs overview, work-items, cycles, modules; filters `?projects=` and `?range=`; `load.ts` reads `getAnalytics`, project options and a stored narrative digest (never generated). |
| `stickies/page.tsx` (44) | Stickies list with `?q=`. |
| `settings/[tab]/page.tsx` (46) | Workspace settings General and AI (other tabs have own routes). |

### Components

| Path | Responsibility | Key exports |
|---|---|---|
| `home/HomeScreen.tsx` (73), `ManageWidgetsDialog.tsx` (125) | Five widgets in `summary.widgets` order (since_last_visit, quick_links, recents, your_work, stickies). The dialog edits a local draft and saves the whole list; rows drag with the pointer, "Reorder" menu keeps Move up/down. | `HomeScreen`, `ManageWidgetsDialog` |
| `home/SinceLastVisit.tsx` (141) | Moves the anchor when the route hides, the tab unloads (beacon) or "Mark as seen" is clicked; it never moves on open. The "+N more" link has the `tessera-home-more` class (`home.css`): under touch it is a 44x44 box that hits at its centre and corners, with a negative block margin so the action row keeps its height. Row labels are plain strings, so a long label is clipped to one line with an ellipsis at 375 px. | `SinceLastVisit` |
| `home/QuickLinksWidget.tsx` (255) | Card rows in a wrap, 240 x 56 (32 px icon tile, title, supporting line from `home-format.ts`, a menu that shows on hover or focus and always under `(hover: none)`); drag from anywhere but the menu button (the click after a drag is swallowed); menu Move left/right. | `QuickLinksWidget` |
| `home/{RecentsWidget,YourWorkWidget,StickiesWidget}.tsx`, `home-format.ts` (191) | Recents filtered by route icon (the heading sits above its filter; rows are 44 px under a coarse pointer or at 480 px and narrower); counts; up to six notes; pure phrases and URL checks. `DigestCard` is mounted with `inset="none"` here and on Analytics. | same names |
| `stickies/StickiesScreen.tsx` (197), `StickyCard.tsx` (204), `reorder-math.ts` (66, pure) | Grid (column minimum 256 px, `STICKY_COLUMN_MIN`) of cards that are as tall as their content with a 540 px cap and a scrolling body, with 2-D drop maths (`dropIndexForGrid`); the grip is the drag source and takes arrow keys; body saves 800 ms after the last edit and on blur; delete asks first. | `StickiesScreen`, `placementFor`, `reorderBy` |
| `dnd/drag-math.ts`, `use-pointer-drag.ts` | Shared pointer drag; `axis: "grid"` and `dropIndexForGrid` were added for stickies and quick links. | `dropIndexFor`, `dropIndexForGrid`, `usePointerDrag` |
| `favorites/{tree.ts,state.ts,store.tsx}`, `shell/{FavoritesSection,FavoriteButton,FavoriteDialog}.tsx` | Pure tree maths and optimistic moves; the sidebar publishes its tree so Power K can read it; the star toggles from pages, views and projects. | `topEntries`, `reorderByPlacement`, `useIsFavorite` |
| `profile/*` | Profile frame (two-row `tabsBelow` header: avatar, name and tokens in one group, no "You" token on the user's own profile, a tab strip that fits at 375 px, and at 360 px with 4 px tab padding), summary, activity grouped by local day with "Load more" (`?before`), agents list, `RememberLabel` for recents; link rows are 44 px under touch (`profile.css`). | `ProfileScreen`, `ProfileSummary`, `ActivityList` |
| `analytics/*`, `charts/*` | Overview KPIs and bars, work-items breakdown (top 11 buckets plus Other in the chart, every bucket in the table), cycles and modules tabs; the header is two rows below 1100 px and three below 600 px (tabs on their own row; at 360 px and narrower the tab padding is 8 px), the count column has a 100 px floor (`table-widths.ts`); `ChartFrame` holds the hydration skeleton and the data table; `csv-download.tsx` gives every chart table and the four plain tables a Download CSV. | `AnalyticsScreen`, `ChartFrame`, `DownloadCsvButton`, `CsvTable` |
| `workspace-settings/*` | General (name, week start) and AI (model, effort, digests) tabs, in the project settings column (`tessera-settings-body`); the Backups, Exports and Webhook tables use column floors from `table-widths.ts` and fold their secondary columns when narrow (`use-narrow-container.ts`), status is a dot with its word (`StatusLabel.tsx`); on a phone the five tabs fit (the `tessera-settings-tabs--workspace` class, 8 px tab padding, the strip to the panel edge; the seven project settings tabs keep the generic scrolling strip); the Backups table folds to File and Kind with size, check and age under the name below 576 px of container (hardening.md); `workspace-settings-store.tsx` publishes `week_start` so pickers read it without a prop (`useWeekStart`). | `WorkspaceSettingsScreen`, `useWeekStart` |

## 3. Data and control flow

### Read path
1. Each route is a sync default export with `<Suspense>`; the async child calls `await io()` and one `readTessera`. Home reads `getHomeSummary` once; analytics reads `getAnalytics` plus project options and the stored digest.
2. The sidebar data (projects, favourites tree, unread and draft counts) loads in the `(tessera)` layout under Suspense and is published to client stores (`FavoritesPublisher`, `WorkspaceSettingsPublisher`).
3. Recents are client-only (`tessera.recents.v1`) and render inside the Home client screen.

### Write path
1. Widgets, stickies, links and favourites call Server Actions over `toolAction`; reorders are optimistic (`useOptimistic` in `startTransition`) with a toast and revert on failure. Sticky and quick link drops send one neighbour (`before_id` when past the front, else `after_id`) because a search-narrowed grid has neighbours that are not adjacent.
2. Home "seen" is a beacon (`POST /api/home/seen`, same-origin) with the newest shown `seq`.
3. A workspace settings save sends only the field that changed; the publisher re-runs on every server render, so a `refresh()` after a save reaches the store.
4. Analytics filters and tabs write the URL with `router.replace`; the page re-reads `searchParams` (no `router.refresh`).

## 4. Invariants and rules the code enforces

| Rule | Decision | Enforced in | Test |
|---|---|---|---|
| Home is one read; recents is the only client-side widget; unknown widget ids dropped, missing appended | 72, 74 | `home.ts`, `settings.ts` `normalizeHomeWidgets` | `tests/workspace/home.test.ts`, `tests/ui/home-widgets.test.ts` |
| Home anchor moves forward only and logs nothing | 73 | `home-seen.ts` | `tests/workspace/home.test.ts` |
| One favourite per entity; folders one level; deleting a folder keeps its favourites | 75 | `favorites.ts` | `tests/workspace/favorites.test.ts`, `tests/ui/favorites-tree.test.ts` |
| Profile numbers equal the list totals | 78 | `profile.ts` over `getCounts` | `tests/workspace/profile.test.ts` |
| Analytics distributions equal `getCounts` | 79 | `analytics/population.ts` | `tests/analytics/counts-parity.test.ts` |
| Analytics breakdown: one dimension plus optional segment, `points` needs a points estimate | 80 | `analytics/breakdown.ts` | `tests/analytics/breakdown.test.ts` |
| Trend: created versus completed per day, per ISO week at 365 days | 79 | `analytics/trend.ts` | `tests/analytics/trend.test.ts` |
| Narrative digest only on click; its id is `<tab>:<projects>:<range>` | 81, 37 | `NarrativeCard.tsx`, `load.ts`, `analytics-format.ts` | `tests/ui/analytics-format.test.ts` (`narrativeId`) |
| Stickies: new first, 800 ms debounced save, no version rows | 82 | `stickies.ts`, `StickyCard.tsx` | `tests/workspace/stickies.test.ts` |
| Quick links accept `http(s)` or `/` paths only | 83 | `quick-links.ts` | `tests/workspace/quick-links.test.ts` |
| Workspace name and AI settings; `digest_enabled: false` hides Summarise | 84 | `settings.ts` | `tests/workspace/workspace-settings.test.ts` |
| Reorder by pointer drag with a menu path on every surface | 14, 105 | the components above | `tests/ui/{stickies-reorder,quick-links-reorder,widgets-reorder,reorder-math,drag-math}.test.ts`, `tests/workspace/sticky-quick-link-moves.test.ts` |
| Week start 0 to 6 drives calendars and date pickers | 101 | `workspace-settings-store.tsx` | `tests/ui/week-start-store.test.ts`, `week-start-pickers.test.ts` |
| Chart data tables and plain tables export CSV client-side with BOM and CRLF | 100 | `csv-download.tsx` | `tests/ui/analytics-csv.test.ts` |

## 5. Tests that guard this area

- Engine: `tests/workspace/{home,favorites,profile,quick-links,stickies,workspace-settings,sticky-quick-link-moves}.test.ts`, `tests/analytics/{breakdown,counts-parity,trend}.test.ts`, `tests/static-views.test.ts`.
- UI: `tests/ui/{home-widgets,home-touch-css,quick-link-supporting,workspace-visual-css,favorites-tree,analytics-format,analytics-csv,analytics-touch-css,analytics-header-css,profile-screen,profile-touch-css,settings-phone-css,status-label,use-narrow-container,stickies-reorder,quick-links-reorder,widgets-reorder,reorder-math,drag-math,workspace-settings-general,week-start-store,week-start-pickers}.test.ts` (the `-css` files read the stylesheets); `tests/helpers/pointer-drag-dom.ts` stubs rects for the drag tests.
- Playwright: `tests/e2e/workspace.spec.ts` (a quick link survives a reload and opened items show under Recent; a favourited project shows under Favorites; the analytics total equals the sidebar counts), `drag-surfaces.spec.ts` (stickies, quick links, widgets).
- No Vitest: `HomeScreen`, `SinceLastVisit`, `StickiesScreen`, `ProfileScreen`, `AgentsScreen`, `AnalyticsScreen` panels, `FavoritesSection`.

## 6. Extension points

- New Home widget: a member of `HomeWidgetIdSchema`, a case in `HomeScreen`, a label in `HOME_WIDGET_LABELS`, and a field in `getHomeSummary`.
- New analytics dimension or tab: `analytics/dimensions.ts` and the matching tab builder; the label tables in `charts/analytics-format.ts`; the CSV helper covers a new table with one `CsvTable`.
- New favourite entity type: `AddFavoriteInput` entity enum and the join in `listFavorites`.
- New profile tab: `ProfileTabSchema`, `profile-format.ts` and a counts profile scope.

## 7. Known debt and quirks

- Decision 87 (module notifications, `module_updated`) is not built: no code writes that kind.
- `analytics/[tab]/load.ts` still reads `getAnalytics` through a guard written before the export existed; the engine export is there now.
- Home widget drag has no per-drop call: the dialog edits a draft and Save persists the whole list; a failed Save toasts and keeps the dialog open.
- The stickies drag source is the grip button, not the whole card (a text field and editor live inside it).
- `dropIndexForGrid` assumes left-to-right layouts and groups rows by the first rect's vertical midpoint.
- Dragged cards and chips are hidden with `display: none` and kept mounted so an unsaved sticky edit survives.
- Keyboard drag does not exist; decision 14's keyboard path is the menus (plus arrow keys on the stickies grip).
- No Latte look at drag states, no 375 px mid-drag screenshot.
- The two-row analytics header uses the viewport width, not the panel width, for its 1100 px switch (ASSUMPTION recorded in `analytics.css`), so a collapsed sidebar at 1000 px still gets two rows.

## 8. Where to read more

| Topic | Read |
|---|---|
| Home, favourites, profiles, stickies | docs/drafts/p9-plan.md, docs/PLAN.md 72–87 |
| Analytics | docs/PLAN.md 79–81, 100; `src/lib/tessera/analytics/index.ts` |
| Drag | docs/PLAN.md 14, 105; `src/components/dnd/` |
