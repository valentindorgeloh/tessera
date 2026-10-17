# As-built map: shell, work item detail, editor, theme

Describes the committed state at HEAD `257798c` (before the uncommitted P4 work). Line counts are HEAD counts. Read this first; go to the contracts (section 8) only for the part you change. Decision numbers are rows of the "Resolved design decisions" tables in docs/PLAN.md (HEAD has 1 to 28).

## 1. Purpose and boundaries

This area is the frame every Tessera screen sits in (top bar, sidebar, content panel, panel headers, Power K, shortcuts, recents, external-write polling), the work item detail that opens as peek, modal or full page, the Tiptap description editor with its save queue, and the Catppuccin theme with its two CSS files. It is all client UI plus a few thin server pages. It never touches the database from a client file; reads happen in server pages through `readTessera`, and writes go through Server Action wrappers.

Lives elsewhere (do not look here for it):
- Engine, tools and registry: `src/lib/tessera/**`; Server Action runner and wrappers: `src/app/actions/{_run,shell,detail,work-items}.ts`.
- API routes `src/app/api/{changes,search}/route.ts` (only the description route is in this map).
- Project frame, `ProjectProvider`, list/board/table, property controls, `CreateWorkItemDialog`: `src/components/work-items/**`, `src/app/(tessera)/projects/[projectId]/**`.
- Cycles, modules, archives, `archive-rules`: `src/components/planning/**`. Project dialogs: `src/components/projects/**`.
- Home page (uses `RecentsList`), `/projects`, project-scoped list pages that mount `PeekHost` (`work-items/page.tsx`, `scoped-list.tsx`, `archives/work-items/page.tsx`).
- Other CSS areas in `src/components/styles/` (including `editor.css`, owned with the editor but not listed below).

## 2. File map

### Shell, `src/components/shell/` (all `"use client"` unless noted)

| Path (lines) | Responsibility | Key exports |
|---|---|---|
| `TesseraShell.tsx` (76) | AppShell on the wash, `Card.tessera-panel` content panel, `ToastViewport`, mounts `CommandBar`; `mod+b` collapses the nav; shell context | `TesseraShell`, `useShell`, `ShellContextValue` |
| `TopBar.tsx` (130) | Astryx `TopNav`: collapse button, brand to `/home`, read-only search field that opens Power K, help button, account menu (colour scheme, shortcuts) | `TopBar` |
| `Sidebar.tsx` (226), `SidebarSkeleton.tsx` (24) | `SideNav`: Work heading, quiet New work item, Home, Projects, flat project rows with counts; width 236 to 350 (default 250) in `tessera.sidebarWidth.v1`; skeleton while data streams | `Sidebar`, `useSidebarResize`, `SIDEBAR_WIDTH`, `SIDEBAR_WIDTH_STORAGE_KEY`, `LAST_PROJECT_STORAGE_KEY` (re-export) |
| `PanelHeader.tsx` (101, server-safe) | Panel header pieces; plain `HStack` rows, never Astryx Toolbar | `PanelHeader`, `PanelBar` (`size` header 52px, subheader 44px, filters 44px; `hasDivider`, `canWrap`, `className`), `PanelTitle` (h1 at working size), `PanelPage` (`width` reading 960px or full) |
| `ChangesPoller.tsx` (62), `poll-loop.ts` (101) | External-write polling. Loop is pure and testable: one timer, one request at a time | `ChangesPoller`; `startPollLoop`, `POLL_INTERVAL_MS` 4000, `POLL_BACKOFF_MS` 30000, `EXTERNAL_WRITE_BOUND_MS` 5000 |
| `RecentsTracker.tsx` (28) | Renders nothing; records `usePathname()` and hands project names to the store | `RecentsTracker` |
| `recents.ts` (276) | Pure recents model: route labels and icons, add/remove/parse, project id from path | `resolveRoute`, `addRecent`, `removeRecentsUnder`, `parseRecents`, `labelRecents`, `projectIdFromPath`, `normalizePath`, `isRecordable`, `isTransientPath`, `isSameRecent`, `onScreenPaths`, `otherRecents`, `projectNameMap`, `lookupFromNames`, `RECENTS_STORAGE_KEY`, `MAX_RECENTS` 12, `RECENTS_IN_PALETTE` 5, `RouteIconKey` |
| `recents-store.ts` (174) | localStorage-backed store (`tessera.recents.v1`) over `useSyncExternalStore` | `recordVisit`, `forgetRecentsUnder`, `useMissingRoute`, `setRecentProjectNames`, `readRecents`, `useRecents` |
| `entity-labels.ts` (145) | Bounded id to label map (`tessera.entityLabels.v1`, max 200, newest last) so recents read "WEB-1 Title" | `registerEntityLabel`, `readEntityLabels`, `useEntityLabels`, `withEntityLabel`, `parseEntityLabels`, `serializeEntityLabels` |
| `RecentsList.tsx` (50) | Home's Recent section | `RecentsList` |
| `shell-icons.ts` (37) | Route icon key to Phosphor glyph; colour scheme glyphs | `ROUTE_ICONS`, `COLOR_SCHEME_ICONS` |
| `CommandBar.tsx` (541) | Power K: Astryx `CommandPalette`, Search/Ask tabs (Ask is a placeholder), "All projects" footer toggle, scope from route project; mounts `useShortcuts`, `ShortcutsDialog`, `CreateProjectDialog` | `CommandBar`, `CommandBarHandle` (`open`, `openHelp`, `openCreateProject`) |
| `command-source.ts` (386) | Pure search source: debounced `GET /api/search`, merges recents, commands, theme commands; item id schemes `hit:`, `open:`, `recent:`, `theme.` | `createCommandSource`, `buildCommands`, `SECTION_ORDER`, `SEARCH_DEBOUNCE_MS` 150, `SEARCH_LIMIT` 20, `hitToItem`, `parseHitId`, `searchUrl`, `liveHighlight`, `paletteSection`, `THEME_COMMANDS` |
| `command-context.ts` (69) | Store the open detail registers: item, per-shortcut actions, optional state-dependent labels | `registerCommandContext`, `useCommandContext`, `CommandContextValue`, `CommandItem` |
| `shortcuts.ts` (334, pure) | Registry and resolver, DOM-free | `SHORTCUTS`, `SHORTCUT_BY_ID`, `ShortcutId`, `CommandId`, `ShortcutDef` (`arrives`, `note`, `needsItem`), `resolveShortcut`, `isTypingTarget`, `isQuietTarget`, `QUIET_POPUP_SELECTOR`, `CHORD_WINDOW_MS` 1000, `formatKeys` |
| `useShortcuts.ts` (274) | One window keydown listener; runs ids; single-key preference `tessera.shortcuts.v1` | `useShortcuts`, `useShortcutPrefs`, `setSingleKeys`, `forgetLastProject`, `SHORTCUTS_STORAGE_KEY` |
| `ShortcutsDialog.tsx` (84) | Help dialog with the single-keys switch | `ShortcutsDialog`, `ShortcutKeys` |
| `color-scheme.ts` (82) | Scheme store `tessera.scheme.v1`: dark (Frappé, default), light (Latte), system | `useColorScheme`, `setColorScheme`, `COLOR_SCHEME_LABELS`, `DEFAULT_COLOR_SCHEME` |
| `dialogs.tsx` (47) | Wrapper that closes the native `<dialog>` when React Activity hides a route | `Dialog`, `AlertDialog`, `DialogHeader` |
| `NotFoundScreen.tsx` (30) | Tessera not-found screen; calls `useMissingRoute` | `NotFoundScreen` |

### Detail, `src/components/detail/` (public surface in `index.ts`, 19)

| Path (lines) | Responsibility | Key exports |
|---|---|---|
| `WorkItemDetail.tsx` (264) | The detail for all three hosts: title edit, delete/archive/restore/copy, registers command context and entity label | `WorkItemDetail` |
| `DetailHeader.tsx` (168) | Pinned 44px bar: breadcrumbs, Copy link, "More actions", "Open as" menu, Close | `DetailHeader`, `workItemPath` |
| `PropertyRail.tsx` (267) | Four groups (status, people, planning, dates); each control in a `data-property` wrapper the shortcuts open | `PropertyRail`, `PropertyRailFields`, `PropertyName` |
| `use-detail-actions.ts` (120), `patch.ts` (73) | Optimistic writes (`useOptimistic`), drop no-op patches, toast on failure | `useDetailActions`, `useActionRunner`, `DetailActions`; `applyPatch`, `changedFields`, `isNoopPatch`, `toggleId`, `sameIds`, `storedIsoDate` |
| `DescriptionEditor.tsx` (136) | Editor + save queue + Banners (Changed elsewhere, Updated elsewhere, lossy parse) | `DescriptionEditor` |
| `ParentPicker.tsx` (160), `search-hits.ts` (45) | Parent search via `/api/search`; candidate helpers | `ParentPicker`, `searchUrl`; `toCandidates`, `matchWorkItemRef`, `parentTriggerLabel` |
| `SubItems.tsx` (191), `LinksList.tsx` (206), `ActivityFeed.tsx` (135), `activity-text.ts` (161), `RelativeTime.tsx` (36) | Sub-items (add, reorder, remove), external links, newest-first timeline (20 shown), activity wording, hydration-safe relative time | `SubItems`, `LinksList`, `isHttpUrl`, `ActivityFeed`, `describeActivity`, `newestFirst`, `RelativeTime`, `useHydrated` |
| `PeekHost.tsx` (275) | Wraps a list; `?peek=<id>` shows the detail as resizable side panel or modal through one portal node | `PeekHost`, `PeekData` |
| `peek-url.ts` (122), `peek-history.ts` (58), `peek-hosts.ts` (30), `peek-prefs.ts` (127) | `peek` param helpers and Power K routing; Back-vs-replace close; host registry; width/mode prefs (`tessera.peek.v1`, 360 to 720, default 480) | `peekHref`, `mountsPeek`, `workItemHitTarget`, `closesWithBack`, `PEEK_PARAM`; `notePeekPush`; `registerPeekHost`, `hasPeekHost`; `usePeekPrefs`, `savePeekPrefs` |
| `types.ts` (35) | View model and host types | `WorkItemDetailData`, `DetailHost` (`peek`, `modal`, `page`), `WorkItemDetailProps` |

### Editor, `src/components/editor/` (client; may import only `@/lib/tessera/{types,schemas,core/keys}`)

| Path (lines) | Responsibility | Key exports |
|---|---|---|
| `MarkdownEditor.tsx` (523) | Tiptap component: bubble menu, drag handle, table controls (not in compact peek), source toggle; never saves itself | `MarkdownEditor`, `MarkdownEditorHandle`, `ENTITY_LINK_SCHEMES` |
| `extensions.ts` (323, no React) | Extension list shared with the round-trip tests; raw HTML nodes, image node, `encodeMarkdownText` escaping | `editorExtensions`, `encodeMarkdownText`, `setSuggestionContext`, `readSuggestionContext` |
| `mentions.tsx` (313) | Suggestion popovers: `#` work items, `@` actors, `/` blocks, `[[` reserved for pages | `buildEditorSuggestions`, `actorRows`, `blockRows` |
| `links.ts` (77) | Entity links `work:KEY`, `page:id`, `cycle:id`, `module:id` | `parseEntityHref`, `entityHref`, `entityRoute`, `isAllowedEditorUri` |
| `useDescriptionSave.ts` (494) | Save queue: 400 ms debounce, one request in flight, CAS, conflict state, pagehide beacon, flush on unmount | `useDescriptionSave`, `DESCRIPTION_SAVE_DELAY_MS`, `beaconPayload`, `parseBeaconMarker`, `renderedBeforeBeacon`, `BEACON_MARKER_KEY` |

### Routes and server files

| Path (lines) | Responsibility |
|---|---|
| `src/app/(tessera)/layout.tsx` (66) | Renders `TesseraShell`; streams `SidebarData` (one cached `listProjects`) and `WatchersData` (`RecentsTracker` with active plus archived project names, `ChangesPoller` with `latestSeq`) under Suspense after `await io()` |
| `src/app/(tessera)/browse/[key]/page.tsx` (47) | `/browse/WEB-1` (any case) or an item id; `getWorkItemByKey`, then `redirect` to the project detail route; bad or unknown input gives `notFound()` |
| `src/app/(tessera)/projects/[projectId]/work-items/[workItemId]/page.tsx` (49) | Full detail inside the project frame; an item of another project gives `notFound()` |
| `src/app/(tessera)/work-items/[workItemId]/page.tsx` (60) | Global detail outside the frame; wraps `ProjectProvider` with its own bundle |
| `src/app/(tessera)/work-items/{DetailPage.tsx (40), load-detail.ts (67)}` | `DetailPage` client host (navigation callbacks); `loadWorkItemDetail`, `loadProjectBundle` |
| `src/app/api/work-items/[workItemId]/description/route.ts` | Beacon target for pagehide saves (same origin, JSON only, CAS, one retry on own in-flight save) |

### Theme and CSS

| Path (lines) | Responsibility |
|---|---|
| `src/themes/catppuccin/palette.ts` (247) | The only place for hex: `LATTE`, `FRAPPE`, `SEMANTIC_TOKENS`, `ACCENT_TOKENS`, `STATUS_TOKENS`, `CHIP_TOKENS`, `DATA_TOKENS`, `SHADOW_TOKENS`, `PALETTE_KEY_COLOURS` (decision 22) |
| `src/themes/catppuccin/catppuccinTheme.ts` (119) | `defineTheme`: Mauve accent, scale 14/1.2, radius base 4, component overrides (popover, context-menu, dialog, switch, banner, banner-icon, nav-icon, tab-scroll-button, calendar-day), `onDark`/`onLight` |
| `src/themes/catppuccin/icons.tsx` (317) | All Phosphor re-exports as duotone icons plus `catppuccinIconRegistry`, `PROJECT_LOGO_ICONS`, `resolveLogoIcon`. The only icon source |
| `catppuccin.{css,js,d.ts,css.d.ts}`, `catppuccinTheme.doc.mjs` | Generated by `astryx theme build`; never edit |
| `src/astryx-themes.ts`, `src/app/providers.tsx` | Generated theme wiring; `Providers` passes `useColorScheme()` as `<Theme mode>` and sets `LinkProvider` to `next/link` |
| `src/components/styles/shell.css` (147) | `.tessera-panel`, `.tessera-topbar-search`, `.tessera-sidebar-new`, `.tessera-panel-bar*`, `.tessera-project-tabs`, `.tessera-project-frame-{token,title}`, `.tessera-reading`, `.tessera-cmd-*` |
| `src/components/styles/detail.css` (259) | `.tessera-detail*` (grid areas, `@container detail (min-width: 960px)` puts the rail right), `.tessera-peek-{slot,node,card,panel}`, title, rail rows, timeline, parent menu |

## 3. Data and control flow

**Read (page load).** A page is a sync Server Component with `<Suspense>` around an async child that does `await params`, `await io()`, then `readTessera(ctx => ...)`. Detail pages call `loadWorkItemDetail(ctx, id)` (item, parent, children, activity reversed to newest first, `USER_ACTOR_ID`, cursor); the global page also calls `loadProjectBundle`. `NOT_FOUND` and `VALIDATION` become `notFound()`; `redirect()` stays outside `try`. The result reaches the client as props: `DetailPage` or `PeekHost` pass `WorkItemDetailData` to `WorkItemDetail`.

**Peek read.** The list page (`scoped-list.tsx`) loads `PeekData` for `?peek=<id>`; `PeekHost` renders one detail into a portal node and moves it between the side slot and the modal slot, so editor state survives a mode switch. Opening goes through `peekHref`, which keeps `q`; close goes Back when `notePeekPush` recorded the push (`closesWithBack`), else replaces the URL.

**Write (user).** Control -> `useDetailActions` (`update`, `setAssignees`, `setLabels`, `setModules`, `toggleSubscribe`, `assignMe`) -> `changedFields` drops no-ops -> `useOptimistic` shows the value -> wrapper from `src/app/actions/{work-items,detail}.ts` (`toolAction("update_work_item")` etc.) -> `runTool` validates, runs the registry tool as actor `user`, calls `refresh()` -> host re-renders with fresh props. `{ ok: false }` becomes an error Toast and the optimistic value rolls back. Archive, restore, delete and copy run through `actions.run`/`startTransition` the same way. Delete then calls `forgetRecentsUnder` for both routes of the item and closes or navigates.

**Write (description).** `MarkdownEditor.onChange` -> `useDescriptionSave.markDirty` (400 ms) -> `updateWorkItemDescriptionAction` with `expected_description_version`. `CONFLICT` sets `conflict` for the Banner (Keep mine resends with the current version, Load theirs adopts the server text). On `pagehide` it sends `navigator.sendBeacon` to `POST /api/work-items/<id>/description` (with `if_current_md` when a save is in flight) and stores a sessionStorage marker so the next page refreshes via `refreshAction` until the beacon text arrives. Unmount and Activity-hide flush.

**Write (external, MCP or agent).** `ChangesPoller` polls `/api/changes?since=<cursor>` every 4 s while the tab is visible (rows not written by `user`, decision 12); on any change it moves the cursor and calls `refreshAction()`; the open page re-renders from server data; the description queue accepts the server text silently when clean and unfocused, else shows Updated elsewhere.

**Navigation memory.** `RecentsTracker` effect -> `recordVisit(path)` -> `addRecent` -> localStorage. `PeekHost` records a loaded peek as a visit to the item's full page. Detail screens call `registerEntityLabel` so labels survive reloads. Home's `RecentsList` and Power K's Recent group read `useRecents`/`readRecents`, labelling each path with `resolveRoute`; labels are derived, never stored.

**Keys and Power K.** `TesseraShell` `useHotkeys` handles `mod+b`; `CommandBar` handles `mod+k` and `mod+/`; `useShortcuts` owns every other key. `resolveShortcut` (pure) returns an action or a chord prefix (`g`, `n`, 1 s window). `runShortcut` switches on the id: routes under `/projects/<id>/` from `PROJECT_ROUTES`, `item.*` ids call `CommandContextValue.actions[id]` (registered by `WorkItemDetail`, which clicks the `data-property` control), anything with `arrives` toasts "Arrives in P<n>". Power K search: `createCommandSource` -> debounced `GET /api/search` (scope = route project) merged with `buildCommands(context)`; selecting a work item hit uses `workItemHitTarget` (peek when a host of that project is mounted, else full page).

**Theme.** `palette.ts` -> `catppuccinTheme.ts` -> `astryx theme build` -> generated `catppuccin.{css,js}` -> `src/astryx-themes.ts` -> `Providers`. Colour scheme is client state only (`color-scheme.ts`), read after mount, so the server and first client render are Frappé.

## 4. Invariants and rules the code enforces

| Rule | Decision | Enforced by |
|---|---|---|
| Reads go under Suspense with `await io()` before `readTessera`; no read in a layout without it | 12 | `(tessera)/layout.tsx` (`SidebarData`, `WatchersData`), the three detail pages; `next build` prerender |
| Mutations are Server Actions that end in `refresh()`; never `router.refresh()` | 12, 26 | `runTool` in `_run.ts`; convention rule `no-router-refresh`; client code uses `refreshAction` |
| External writes reach open tabs within 5 s; the feed excludes actor `user` | 12 | `startPollLoop` fixed-rate 4 s (`POLL_INTERVAL_MS`), `/api/changes`; `tests/ui/poll-loop.test.ts` |
| Optimistic updates revert with a Toast on failure; unchanged values never call the server | 13 | `useDetailActions.write`, `changedFields`; `detail-smoke` (drops re-fired value, rolls back) |
| Description saves are compare-and-set on `description_version`; property writes never bump it | 10 | `useDescriptionSave.send`, beacon route retry that is itself a CAS; `description-save`, `description-route` tests |
| Entity link schemes are exactly `work`, `page`, `cycle`, `module` | 10 | `ENTITY_LINK_SCHEMES`, `isAllowedEditorUri`; `tests/editor/links.test.ts` |
| Markdown round trip is lossless; a description that does not round-trip opens read-only until "Edit anyway" or source mode | 10 | `extensions.ts` (`rawHtml`, `image`, `encodeMarkdownText`), `onLossyParse` + `lossy` state; `markdown-roundtrip.test.ts` |
| Recents replace the tab bar: newest first, 12 max, one entry per work item (project route and global route count as one) | 15 | `addRecent`, `isSameRecent`, `parseRecents`; `tests/ui/recents*.test.ts` |
| Deleted or archived entities leave the recents | 15 | `forgetRecentsUnder` / `removeRecentsUnder` (callers: `WorkItemDetail.deleteItem`, planning menus, project dialogs); `useMissingRoute` for not-found screens |
| `/projects/archives` is never a project id | 15 | `projectIdFromPath`; `recents.test.ts` |
| Human keys resolve at `/browse/WEB-12`; project URLs use the UUID | 3, 2 | `browse/[key]/page.tsx` (`parseKey`, `IdSchema`, `getWorkItemByKey`, `redirect`) |
| Peek is a right inset panel driven by `?peek=<id>`; modal and page share one detail component | 11 | `PeekHost`, `WorkItemDetail` `host` prop; `detail-smoke` (same mounted detail moves between panel and modal) |
| Catppuccin Frappé default, Latte light, Mauve accent, token-only CSS, corners 4/8/12/16 | 19 | `catppuccinTheme.ts`; `tests/themes/catppuccin-{contrast,wiring}.test.ts`; `npm run check:theme`; conventions rule `hex-colour` (hex only under `src/themes/**`) |
| Colours are palette keys rendered with tokens, never hex | 22 | `PALETTE_KEY_COLOURS`, `CHIP_TOKENS` in `palette.ts` |
| Activity is append-only and shown newest first | 24 | `loadWorkItemDetail` reverses `listActivity`; `newestFirst`; `detail-text.test.ts` |
| Every write goes through a registry tool | 26 | `toolAction(name)` fails at module load for an unknown tool; wrappers in `actions/` |
| Actors are members; "assign me" and subscribe use the current actor | 8 | `currentActorId` = `USER_ACTOR_ID` from `loadWorkItemDetail`; `assignMe`, `toggleSubscribe` |
| `Dialog`/`AlertDialog` come only from `shell/dialogs` | none (field guide) | ESLint `no-restricted-imports` (`eslint.config.mjs`); `dialog-teardown.test.ts`, `dialog-names.test.ts` |
| Client files import engine code only from `@/lib/tessera/{types,schemas,core/keys,core/time,core/group}`; components never import `server` or `db` | none (conventions) | `scripts/check-conventions.ts` rules `client-boundary`, `component-boundary` |
| No Date.now/Math.random/argless `new Date()` in render | none (field guide) | `RelativeTime` renders only after hydration; `useHydrated` |
| Single-key shortcuts and chords can be switched off; nothing fires from inputs, the editor or open pickers/menus | none (WCAG 2.1.4, ui.md D4) | `resolveShortcut` (`singleKeys`, `isTyping`), `isQuietTarget`, `QUIET_POPUP_SELECTOR`; `shortcuts.test.ts` |
| Escape belongs to `PeekHost`; `mod+k` and `mod+/` belong to `CommandBar` | none (ui.md D4) | `DELEGATED` set in `useShortcuts.ts`; no `escape` entry in the matcher table |
| Archived item: Banner, no writes, only Restore | none (P3) | `WorkItemDetail` `readOnly`, `SubItems`/`LinksList`/`DescriptionEditor` `readOnly`; `detail-smoke` |
| Files stay at or under 600 lines | none (conventions) | `file-budget` rule; HEAD's `scripts/file-budget.json` lists only `cycles.ts` (925), `db/schema.ts` (857), `modules.ts` (735) |

## 5. Tests that guard this area

| File | Covers |
|---|---|
| `tests/ui/shortcuts.test.ts` (697) | `SHORTCUTS` table, `resolveShortcut` (item keys, typing surfaces, switch, chords, events without `code`), `isQuietTarget`, `formatKeys`, hit ids, `buildCommands`, `matchesCommand`, `sortBySection`, `liveHighlight`, the command source |
| `tests/ui/recents.test.ts` (379), `recents-store.test.ts` (139), `entity-labels.test.ts` (121) | Route labels, add/remove/parse, on-screen filter; the store and cross-tab sync; label store |
| `tests/ui/poll-loop.test.ts` (227) | Cadence, backoff, one request at a time, visibility |
| `tests/ui/color-scheme.test.ts` (126), `last-project.test.ts` (64) | Scheme store and persistence failures; `forgetLastProject` |
| `tests/ui/panel-header.test.ts` (111) | `PanelHeader`, `PanelBar`, `PanelTitle`, `PanelPage` markup |
| `tests/ui/dialog-teardown.test.ts` (172), `dialog-names.test.ts` (241) | Dialog wrapper under Activity; accessible names of form dialogs |
| `tests/ui/detail-smoke.test.ts` (803) | `WorkItemDetail`, `useDetailActions`, command-context actions, description Banners, `RelativeTime`, `PeekHost` (hydration, mode moves, Back close, hidden route, recents) |
| `tests/ui/detail-text.test.ts` (197) | `describeActivity`, `newestFirst`, link labels, patch helpers, search hits |
| `tests/ui/peek-url.test.ts` (174), `peek-prefs.test.ts` (122) | `peekHref`, `mountsPeek`, `workItemHitTarget`, host registry, Back close; prefs validation and store |
| `tests/editor/markdown-roundtrip.test.ts` (246) | Lossless Markdown corpus, text escaping, `encodeMarkdownText` |
| `tests/editor/{markdown-editor,suggestions,links}.test.ts` | Editor handle under jsdom; `#`/`@`/`/` triggers and listbox a11y; entity link helpers |
| `tests/editor/description-save.test.ts` (608) | Debounce, in-flight, CAS, conflict, beacon payload and marker |
| `tests/editor/description-route.test.ts` (214) | Beacon route success, 409, own-save retry, origin and content-type guards |
| `tests/themes/catppuccin-contrast.test.ts` (280), `catppuccin-wiring.test.ts` (106) | Contrast per pair (text 4.5:1, icons and outlines 3:1); built CSS carries palette, syntax mapping, overrides, no private `--_*` variables |

Not covered by Vitest: `TopBar`, `Sidebar`, `CommandBar` rendering, `ChangesPoller` itself, the three detail pages, `/browse`. They were browser-checked (Chrome DevTools) at the P2b and P3 acceptance runs.

## 6. Extension points for later phases

- Add a shortcut or palette command: append a `ShortcutDef` to `SHORTCUTS` (`shortcuts.ts`) and a `case` in `runShortcut` (`useShortcuts.ts`); `paletteSection` and `buildCommands` (`command-source.ts`) place it. Entries with `arrives: "P4"|"P5"|"P6"|"P7"|"P8"|"P9"` (`create.view`, `nav.views`, `create.page`, `nav.pages`, `nav.inbox`, `nav.settings`, `nav.yourWork`, `nav.analytics`, `nav.intake`, `nav.drafts`, `item.estimate`) toast "Arrives in P<n>" until you implement the case and remove `arrives`. `note` marks working shortcuts whose follow-up lands later (`item.subscribe`: "Notifications arrive in P7").
- Item actions for a new screen: `registerCommandContext({ item, actions, labels })`; `labels` gives state-dependent palette text.
- New project sub-routes: `PROJECT_ROUTES` in `useShortcuts.ts`; unknown project sections already resolve to "<project> · <Section>" in `resolveRoute`.
- New route labels and icons: `resolveRoute` and `RouteIconKey` in `recents.ts`, glyph in `ROUTE_ICONS` (`shell-icons.ts`); detail screens call `registerEntityLabel(id, label)`; after delete or archive call `forgetRecentsUnder(path)`.
- Palette search types: `HIT_SECTION` and `SECTION_ORDER` in `command-source.ts` (sections Pages, Settings and the Ask tab exist already). `CommandBar` Ask tab placeholder is for P5; planned `CommandBarAsk.tsx` per OWNERS.md.
- New screen with a peek: wrap the list in `PeekHost` and add its path to `mountsPeek` (`peek-url.ts`).
- Property rail: add a `PropertyName` and a `data-property` wrapper in `PropertyRail.tsx`; wire `useDetailActions` and a wrapper in `actions/`. Estimate is a disabled control until P8.
- Editor: add a trigger in `mentions.tsx` and `extensions.ts` (`[[` for pages is reserved); `page:` links currently toast "Arrives in P6"; `@Name` serialises as plain text (P7 may upgrade to `[@Name](actor:<id>)`).
- Panel screens: compose `PanelPage` + `PanelHeader` + `PanelBar`; a screen inside the project frame adds no second title row.
- Theme: new colour pair in `palette.ts` plus a case in `catppuccin-contrast.test.ts`; whole-component restyle in `components` of `catppuccinTheme.ts` (find keys with `npm run astryx -- theme targets <Name>`); new icon appended to `icons.tsx`; rebuild with `npm run astryx -- theme build src/themes/catppuccin/catppuccinTheme.ts`. CSS goes in `src/components/styles/<area>.css` imported once from `globals.css`.
- Add a mutation: new `toolAction("tool_name")` wrapper in `src/app/actions/<domain>.ts`; the detail uses `actions.run(call, onOk, prefix)`.

## 7. Known debt and quirks

**File budget.** HEAD's `scripts/file-budget.json` pins only `cycles.ts`, `db/schema.ts`, `modules.ts`; none are in this area. The field guide names more entries (including `CommandBar.tsx`), so check the working tree before trusting either. Closest to 600 lines: `CommandBar.tsx` 541, `MarkdownEditor.tsx` 523, `useDescriptionSave.ts` 494, `command-source.ts` 386, `shortcuts.ts` 334, `extensions.ts` 323. P4 work is already growing `CommandBar.tsx` (560 in the working tree).

**Contract and status notes (ui.md "As built", docs/PLAN-STATUS.md):**
- Estimate control and `item.estimate` are placeholders until P8; subscribe works but notifications arrive in P7; Ask tab, "Since you were last here" card on Home arrive in P5/P9.
- The modal is 760 px wide, so the property rail always stacks in it; the 960 px container query applies only to the page host.
- Side peek narrows the list instead of overlaying it; at 1440 px the board's fourth column is cut until it closes.
- Leaving Source mode re-serialises Markdown and can save a second version ("edited the description 2 times"); `@tiptap/markdown` writes two blank lines between blocks.
- The modal's initial focus lands on the breadcrumb's project link. Chrome reports one "form field should have an id or name" issue on the peek.
- Dev-only console noise to tolerate: Astryx `Table` `tableContextMenu` warnings (`moveTo`, `start`, `cancel`), React's "negative time stamp" error on the first visit of an unknown `/browse/<key>`.
- The Dialog wrapper's known limits: focus after Back goes to `<body>`, and the touch BottomSheet presentation is not covered.
- Doctor shows one `theme-fonts` warning (fonts load through `next/font`); the `agent-docs` warning was noted earlier. Accepted.
- Open, not fixed (PLAN-STATUS "After the visual rework merge"): the full detail page in the project frame has two `h1`s; at 375 px project tabs scroll with no cue, a board column overflows by about 25 px, the mobile drawer search placeholder is cut; Home's reading column starts 8 px further in than the panel title at 375; a cycle route with an unknown id while cycles are off is recorded as "<project> · Cycle"; an archived project's list still shows enabled controls (read-only UI is P4, engine refuses writes).
- Follow-up not done from the rework: the "+" in a list group header on hover.
- The colour scheme is not applied before hydration: a hard reload in Latte briefly shows Frappé (accepted, no inline script, decision 19).
- Collapsed sidebar state is not persisted (resets on reload).
- Feature toggles (`update_project_features`) have no UI wrapper yet; P4 settings add it.
- Environment: a stale `.next/dev` after `next build` makes an open tab reload in a loop; stop dev, delete `.next/dev`, restart.
- Stale doc strings: the P2b lane table in `docs/contracts/ui.md` still names `TabBar.tsx` and `tab-registry.ts` (it notes that `recents.ts` replaced them); code and decision 15 (recents) win. `tab-registry`, `TabBar` and `HiddenDialogGuard` no longer exist; `dialogs.tsx` replaced the guard.

## 8. Where to read more

- `docs/contracts/ui.md`: "Route groups"; "Data flow"; "Shell (lane B)" (frame, top bar, sidebar, panel headers, recents, colour scheme); "Theme"; "Astryx usage rules that caught agents before"; "P2b: detail, editor, Power K" with "Routes and modes (D3)", "Detail components (D2)", "Power K and shortcuts (D4)", "Acceptance (P2b)"; "As built (layout rework merge, 2026-10-11)"; "Carried items" under P3.
- `docs/contracts/editor.md`: "Packages", "Files", "MarkdownEditor interface", "Extensions", "Save queue (`useDescriptionSave`)", "Beacon route: `POST /api/work-items/[workItemId]/description`", "Vitest corpus", "CSS".
- `docs/PLAN.md`: resolved design decisions 10 to 15, 19, 22, 24, 26; section 6 (rework text) and section 7 (data flow).
- `docs/PLAN-STATUS.md`: hand-off notes for P2a, P2b, "Visual rework (2026-10-11)", "Layout rework merge (2026-10-11)", P3.
- `docs/contracts/OWNERS.md`: lane ownership of each path (lanes B and D for this area).
- `docs/field-guide/index.md` (sections Next 16, Code rules, Astryx and theme, Shell) and `docs/process/swarm.md`.
