# UI contract

Owner: lane A for this document; the code is split between lanes B (shell), C (work items), D (detail, editor, pages), E (planning), F (views, analytics, settings) and G (AI) per `docs/contracts/OWNERS.md`. Astryx rules in `.cursor/rules/astryx.mdc` apply to every file: no raw `div`/`span` layout, components and tokens only, Phosphor icons through `src/themes/catppuccin/icons.tsx`, no xstyle, no hex, no px except structural widths.

## Route groups

```
src/app/layout.tsx                 fonts + <Providers> only (no app frame)
src/app/(handbook)/layout.tsx      legacy handbook frame (<WorkspaceFrame>); routes / and /items/[id]; deleted in P6
src/app/(tessera)/layout.tsx       Tessera frame: AppShell + SideNav + TabBar + ToastViewport + ChangesPoller
src/app/(tessera)/home/page.tsx    Tessera Home (moves to / in P6)
src/app/(tessera)/projects/...     see docs/PLAN.md §5 for the full route list
src/app/api/changes/route.ts       GET ?since=<seq> → { changes, cursor } (lane B)
```

The handbook files keep their content; only `page.tsx` and `items/[id]/page.tsx` move into `(handbook)/`. `scripts/check-conventions.ts` lists the moved paths under `LEGACY_HANDBOOK_FILES`.

## Data flow (from docs/PLAN.md §7)

- **Reads**: a page is a synchronous Server Component shell that renders `<Suspense fallback={<Skeleton …/>}>` around an async child. The child awaits `params` / `searchParams`, then `await io()` (from `next/cache`, bundled doc: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/io.md`), then `readTessera((ctx) => …)` from `@/lib/tessera/server`. Never read the database in a layout without the same pattern.
- **Mutations**: client code calls a typed wrapper exported from `src/app/actions/<domain>.ts` (file-level `"use server"`, `export const moveWorkItemAction = toolAction("move_work_item")`). The wrapper validates, runs the tool as actor `user`, calls `refresh()` and returns `ActionResult`. On `{ ok: false }` the caller shows a `Toast` with the message. Never `router.refresh()`.
- **Optimistic UI**: board, list reorder, calendar and gantt moves use `useOptimistic` + `startTransition`; on failure the reducer state reverts and a Toast appears.
- **External writes**: `ChangesPoller` (client, in the Tessera layout) polls `GET /api/changes?since=<cursor>` every 5 s while the tab is visible; the initial cursor comes from the page's `ListResult.cursor`. When a change by an actor other than `user` arrives it calls `refreshAction()` (a Server Action that only calls `refresh()`).
- Server Actions are serialised per client, so description autosave (P2b) never blocks a move; autosave goes through the POST routes.

## ProjectBundle and ProjectProvider

`src/app/(tessera)/projects/[projectId]/layout.tsx` loads once, under Suspense with `await io()`:

```ts
type ProjectBundle = {
  project: Project;            // from projects.ts
  states: State[];
  labels: Label[];
  cycles: Cycle[];             // non-archived
  modules: Module[];           // non-archived
  actors: Actor[];
  cursor: number;              // latestSeq at load
};
```

It renders `<ProjectProvider bundle={bundle}>` (client context in `src/components/work-items/project-provider.tsx`, lane C) and `<ProjectFrame>` (header with project name, section `TabList` for Work items / Cycles / Modules / Views / Pages / Intake / Settings according to the feature toggles; tabs whose routes do not exist yet are omitted). Every property control reads the bundle from `useProject()`; nothing fetches lists client-side except search typeahead.

## Work items screen (lane C)

`WorkItemsScreen` (client) owns the filter bar, the display menu, quick-add and the layout switch. The server page passes `result: WorkItemListResult`, the resolved `display`, `filters` and the `view_settings` defaults.

URL state: one `q` search param holding base64url-encoded JSON `{ filters?: Filters, display?: Partial<Display> }`, encoded and decoded by `src/components/work-items/url-state.ts` (zod-validated; invalid → ignored). The server merges: defaults ← `view_settings(project, projectId)` ← URL. Changing the display menu writes the URL (`router.replace`, no scroll) and calls `saveViewSettingsAction` so the choice is remembered.

Every layout component receives the same props:

```ts
type LayoutProps = {
  result: WorkItemListResult;              // items, total, cursor, groups (when grouped)
  display: Display;
  bundle: ProjectBundle;
  onMove: (input: MoveInput) => void;      // optimistic; MoveInput = { id, group_by?, value?, from_value?, before_id?, after_id? }
  onUpdate: (id: string, patch: UpdateWorkItemPatch) => void;   // inline property edits
  onOpen: (id: string) => void;            // P2a: navigates to /projects/[projectId]/work-items/[workItemId]; P2b switches to ?peek=<id>
  onQuickAdd: (group: { field: GroupBy | null; value: string | null }, name: string) => void;
};
```

Files: `ListLayout.tsx` (List/ListItem rows grouped with collapsible headers), `BoardLayout.tsx` (columns per group, sub-groups as swimlanes, pointer DnD through `src/components/dnd/use-pointer-drag.ts`), `TableLayout.tsx` (Astryx `Table` with `useTableGroupedRows`, `useTableSortable`, `useTableColumnResize`, inline edit via `renderCell` returning ghost controls). `CalendarLayout` and `GanttLayout` arrive in P10 with the same props.

List rows (`ListLayout`): the title is `RowTitle` (Astryx `Text maxLines={1}`, class `tessera-wi-title`) inside `ListItem`'s label; `work-items.css` gives the label slot `min-width: min(16rem, 100%)` and lets the row wrap, so properties move to a second line (kept at the end) instead of squeezing the title. Selectors reach Astryx's slots only through our own classes (`:has(.tessera-wi-title)`, `:has(> .tessera-wi-props)`).

Property controls live in `src/components/work-items/properties/` and are reused by the detail panel (lane D) and bulk bar (lane E): `StateControl`, `PriorityControl`, `AssigneeControl`, `LabelControl`, `DateControl` (start or target), `CycleControl`, `ModuleControl`, `EstimateControl` (P8). Each takes `{ value, onChange, bundle?, compact?, readOnly? }` and renders a ghost `Selector` / `MultiSelector` / `DateInput`; state shows a `StatusDot` by group, labels and cycles show `Token` with the palette colour, priority shows the Phosphor priority icon.

Create dialog: `CreateWorkItemDialog` (Astryx `Dialog` + `FormLayout`): name, description (plain `TextArea` until the editor lands in P2b), state, priority, assignees, labels, cycle, modules, dates; "Create more" keeps it open; closing with a dirty form asks "Save this draft?" (P8 wires drafts; until then the dialog just confirms discard). Quick-add: inline row at the bottom of a group / column that creates with that group's value.

Filter bar: Astryx `PowerSearch` tokens for state, priority, labels, assignees, cycle, module, dates, text; the display menu is a `Popover` with `SegmentedControl` for layout and `Selector`s for group / sub-group / order / properties.

## Shell (lane B)

- `(tessera)/layout.tsx`: `AppShell` with `SideNav` (Tessera header, "New work item" button opening the create dialog for the current or last project, search button `mod+k`, workspace items that exist, Favorites (P9), Projects tree with per-project children by feature toggle, bottom items), `TabBar` above the content, `ToastViewport`, `ChangesPoller`. `mod+b` collapses the nav.
- Sidebar data: `listProjects` (with counts) and the sidebar's expanded state in `localStorage` key `tessera.sidebar.v1`.
- `TabBar` + `tab-registry.ts`: path-based tabs, storage key `tessera.tabs.v1`, `resolveTab(pathname, lookup) → { label, icon }`, close via decorative `Icon` inside the `Tab` (no nested button), `alt+w`, middle-click, context menu. Pure functions in `tab-registry.ts` have Vitest coverage.
- `QuickCreate`: global create dialog host so the sidebar button and `n i` shortcut open the same dialog as lane C's screen (lane C exports `CreateWorkItemDialog`; lane B mounts it).
- Home at `/home`: project rows from `listProjects` in a `List` with `edgeCompensation="inline"` (no Section around it: Section bleeds outward and would shift the heading), "Since you were last here" placeholder card (P5/P9 fill it), recent items (P9).
- Keyboard: `useHotkeys` from `@astryxdesign/core/hooks` (verify the call form in `node_modules/@astryxdesign/core/hooks`); shortcut list per docs/PLAN.md §6.
- Colour scheme: the SideNav `footerIcons` slot holds the "Colour scheme" menu (Frappé (dark), Latte (light), Match system) next to the collapse button. State lives in `src/components/shell/color-scheme.ts` (`useColorScheme`, `setColorScheme`, `localStorage` key `tessera.scheme.v1`); its values are the Astryx `<Theme mode>` values, which `src/app/providers.tsx` passes through.

## Theme

- The theme is the local Astryx theme `catppuccin` in `src/themes/catppuccin/`. Edit `palette.ts` (colours and `[latte, frappe]` token pairs, the only place for hex) or `catppuccinTheme.ts` (`defineTheme`). Then run `npm run astryx -- theme build src/themes/catppuccin/catppuccinTheme.ts`, and again after every Astryx upgrade.
- Never edit the generated `catppuccin.{css,js,d.ts,css.d.ts}` (`npm run check:theme` fails when they are stale) or `src/astryx-themes.ts` (regenerate it with `npm run astryx -- theme add catppuccin --import`; `npm run astryx -- doctor` fails its theme-module check when it drifts). Every local import of the theme must resolve inside `src/themes/catppuccin/`; Astryx refuses the theme otherwise, which is why the icons live there.
- A new colour pair gets a case in `tests/themes/catppuccin-contrast.test.ts` (text 4.5:1; icons, control outlines and the focus ring 3:1; translucent fills composited over their surface). `tests/themes/catppuccin-wiring.test.ts` checks the built CSS carries the palette, the syntax mapping and the overrides the contrast test assumes.
- Corners: `--radius-inner` (4, chips and tokens), `--radius-element` (8, buttons, inputs, cards nested in a column), `--radius-container` (12, cards, menus, dialogs), `--radius-page` (16, page panels). Use `--radius-full` only for avatars and badges. A container's corner is the radius of the surface nested in it plus the padding between them, written with `calc()` on tokens (`src/components/styles/board.css`: 8px cards in 8px padding give 16px columns).
- Exceptions to "only avatars and badges are round", inherent to the component: the `Switch` track and thumb, the radio indicator, status dots and spinners, the `Token` remove button, tab underline caps, and in date pickers the `Calendar` range bands and the touch month-scroller puck (neither themeable; revisit if a range or touch picker lands).
- `--radius-page` only shows where Astryx's AppShell elevates its content, which needs a top nav next to an inline side nav (the legacy handbook). The Tessera shell has a side nav only, so its content panel is flat and the board columns are its 16px panels.
- Control outlines (inputs, selectors, checkbox and radio rings, the off switch track) use `--color-border-emphasized`, tuned to 3:1 on every surface (WCAG 1.4.11). Change it only together with the contrast test.
- A restyle of a whole component goes in `components` in `catppuccinTheme.ts`, keyed by `npm run astryx -- theme targets <Name>`, never in app CSS and never through private `--_*` variables. Per-instance layout stays className + tokens. Current overrides:
  - Hairline borders on `popover` and `context-menu`.
  - Token text colour on `popover`, `context-menu` and `dialog`; the browser's default styles for `<dialog>` and `[popover]` set `color: CanvasText` (pure white or black), which glyphs without their own colour would inherit.
  - The off `switch` track takes `--color-border-emphasized` (the gray chip tint is too faint). Only the off state, so the checked track keeps Astryx's accent, hover tint and forced-colors colours. Trade-offs: the off track loses Astryx's 5% hover tint, and a disabled off track shows the outline colour at Astryx's half opacity.
  - Rounded-square `nav-icon`, `tab-scroll-button` and `calendar-day`.
  - `banner` scopes two tokens: secondary text reads as primary on the status tint, and `--color-neutral` is the plain surface, so secondary buttons in a banner do not stack their fill and hover overlay on the tint (Astryx's own themes scope banner tokens the same way). `banner-icon` gives the warning and success glyphs their text colours, because Latte yellow and green stay under 3:1 on their tint.
  - `onDark`/`onLight`: the focus ring on inverted surfaces (toasts) uses the on-colour, as the accent does there.
- Accepted trade-offs (not every pair can pass; these are recorded rather than tuned away): a ghost button's hover on a Latte error banner falls to 4.4:1 on the shell wash and 4.1:1 on a muted well, where banners do not render (the test covers content surfaces); the table cell-selection tint, the active peek mode button and active bubble-menu marks differ from their resting state by less than 3:1, as they did under paper.
- Editor surfaces (`src/components/styles/editor.css`) follow the same rules: the frame is a control outline (`--color-border-emphasized`, accent while focused), entity links are purple chips (`--color-background-purple` / `--color-text-purple`), the placeholder is secondary text, and the bubble menu and suggestion popover are shaped like Astryx menus (12px around 8px rows at a 4px inset).
- Code highlighting uses Astryx's default syntax mapping (`syntaxTokenDefaults`, declared in the theme so it resolves to the Catppuccin text tokens). Code colours therefore follow `--color-text-{accent,green,orange,blue,purple,cyan,red,teal,secondary,primary}`.
- The root layout sets `<html data-theme="dark">`, the Astryx SSR hint for the Frappé default; the root `<Theme>` updates it after hydration. Until then `<html>` and `<body>` resolve Astryx's default tokens, because the root `<Theme>` copies `data-astryx-theme` onto `<html>` in an effect. So every page paints its own surface inside the Theme wrapper: the shell does, and the root not-found page uses `.tessera-root-frame` (`src/app/globals.css`).

## Astryx usage rules that caught agents before

- Verify every component's props with `npx astryx component <Name>` or the `.d.ts` under `node_modules/@astryxdesign/core/<Name>` before use; names in the plan marked *check* changed between versions.
- Templates under `node_modules/@astryxdesign/cli/assets/templates/pages/` are reference code under MIT: port them (className + tokens, Phosphor icons), never import or paste them; they use `@stylexjs/stylex` and `@heroicons/react`, both forbidden by `scripts/check-conventions.ts`.
- `Link` goes through Astryx's `LinkProvider` (already configured in `src/app/providers.tsx` with `next/link`).
- CSS lives in `src/components/styles/<area>.css`, imported once from `src/app/globals.css` (one additive `@import` line per area), tokens only.

## Verification per phase

- Vitest for pure helpers (`url-state`, `tab-registry`, the DnD reducer, grouping adapters).
- Browser acceptance through the in-app browser (`.claude/launch.json` → `tessera`) following the numbered steps in docs/PLAN.md §12; the verifier records what it saw with screenshots.
- `npm run check` green; `next build` green with no hydration warnings in the dev console on the screens touched.

## P2b: detail, editor, Power K

Four lanes run in parallel without talking to each other: **D1** editor
(docs/contracts/editor.md, the description beacon route, round-trip tests),
**D2** detail components (`src/components/detail/`, PropertyRail, sub-items, links,
activity, the new Server Action file), **D3** hosts (peek wiring, full pages,
`/work-items/[workItemId]`, `/browse/[key]`, tab labels), **D4** Power K, the
shortcut registry and `GET /api/search`. Every API named here was checked against
the installed packages on 2026-10-11 (file cited in brackets; Astryx declarations
live under `node_modules/@astryxdesign/core/dist/<Name>/`, not under `core/<Name>`
as the P2a rule above says). Mismatches with docs/PLAN.md are collected at the end.

### Routes and modes (D3)

- `/projects/[projectId]/work-items?peek=<id>` — the peek. `work-items/page.tsx`
  (additive) reads `query.peek`; when `IdSchema.safeParse(peek).success`
  (`@/lib/tessera/schemas`; `core/ids.isId` is not importable from client code and
  pages keep to the same rule) it loads the item in a second `readTessera` call
  guarded by its own try: a stale or foreign id renders the panel's not-found state
  and never 404s the list. The page passes `peek` to the host; `q` and `create`
  keep working unchanged. Reload keeps the peek (it is in the URL).
- Modes: `side` (default) is an Astryx `LayoutPanel` in the `end` slot of a nested
  `Layout`, 480 px by default, resizable 360–720 px; `modal` is an Astryx `Dialog`
  (`variant="standard" width={760} maxHeight="85dvh" purpose="form"`,
  `dist/Dialog/Dialog.d.ts`); `page` navigates to the full route. Mode and width
  live in `localStorage` key `tessera.peek.v1` as `{ "width": number, "mode": "side" | "modal" }`
  (`src/components/detail/peek-prefs.ts`, `useSyncExternalStore` with server snapshot
  `{ width: 480, mode: "side" }`, same pattern as `TabBar`). Only `?peek` is in the URL.
- Resizing: `const peek = useResizable({ defaultSize: prefs.width, minSize: 360, maxSize: 720, direction: "horizontal", onSizeChange: (size) => savePeekPrefs({ width: size }) })`
  then `<LayoutPanel resizable={peek.props} hasDivider={false} padding={0} isScrollable label="Work item" role="complementary">`
  with `<ResizeHandle resizable={peek.props} direction="horizontal" isReversed hasDivider />`
  placed before the panel (`dist/Resizable/useResizable.d.ts`: `ResizableRegion.props`
  is the object both components take; `dist/Resizable/ResizeHandle.d.ts`: `isReversed`
  "when the handle controls a panel" on the end side; `dist/Layout/LayoutPanel.d.ts`:
  `width` is ignored when `resizable` is set). Do not use `autoSaveId`: Astryx's own
  storage format is not the `tessera.peek.v1` shape above.
- Host: `src/components/detail/PeekHost.tsx` (`"use client"`), rendered by
  `work-items/page.tsx` around the screen:
  `<PeekHost projectId={projectId} peek={peekData}><WorkItemsScreen …/></PeekHost>`.
  Closed → `children` only. Side → `<Layout height="fill" content={<LayoutContent padding={0} isScrollable>{children}</LayoutContent>} end={…panel…} />`
  (Layout slots `header/start/content/end/footer`, `dist/Layout/Layout.d.ts`; the
  shell and `ProjectFrame` already nest `Layout`s, so nesting is proven). Modal →
  `children` plus the `Dialog`. `AppShell` has no right-panel slot (`dist/AppShell/AppShell.d.ts`:
  `topNav`, `sideNav`, `banner`, `children`), which is why the panel lives inside the page.
- **One mount point (as built).** `WorkItemDetail` renders once, through
  `createPortal`, into a DOM node `PeekHost` owns. The side panel and the modal
  each hold a slot that adopts that node, so switching modes (from the header,
  or when the stored mode loads after hydration) moves DOM and keeps all React
  state: unsaved editor text, undo history, a save in flight, a title being
  edited. Portals have no server render, so until hydration the slot shows a
  `Skeleton`. Focus stays on the control that switched the mode. The list stays
  in the same tree position whether or not the panel is open.
- `peek` prop type: `{ id: string; data: WorkItemDetailData | null } | null` (null data = not found).
- Open/close: `WorkItemsScreen.onOpen` changes (one additive edit by D3 in lane C's
  file, named in the hand-off) from `router.push(`/projects/${projectId}/work-items/${id}`)`
  to `router.push(peekHref(pathname, searchParams, id), { scroll: false })`;
  `peekHref(pathname, searchParams, id | null)` in `src/components/detail/peek-url.ts`
  (pure, tested in `tests/ui/peek-url.test.ts`) sets or drops `peek` and keeps every
  other param (`q`). Enter and click on rows already call `onOpen` (`ListLayout` key
  button + `useListFocus`, `TableLayout`, `BoardLayout`). Escape closes:
  `useHotkeys([{ keys: "escape", onPress: close, allowInInputs: true, isDisabled: !open }])`
  in `PeekHost` (`dist/hooks/useHotkeys.d.ts`); the editor's own Escape blurs first
  and stops propagation (editor.md), dialogs and menus stop theirs, so the second
  Escape reaches the panel. Close = `router.replace(peekHref(…, null), { scroll: false })`,
  except when the list pushed the entry being closed: `onOpen` records the push
  in sessionStorage `tessera.peekPush.v1` (`src/components/detail/peek-history.ts`),
  `PeekHost` stamps the history length once the URL changed and follows an
  in-place item switch, and close calls `router.back()` when
  `closesWithBack(push, current, target, history.length)` holds
  (`peek-url.ts`). Opening and closing therefore leaves no duplicate history
  entry. Without storage the close falls back to the replace.
  Mode switch to `page` = `router.push(`/projects/${projectId}/work-items/${id}`)`.
- `/projects/[projectId]/work-items/[workItemId]` — full page, replaces
  `QuickDetail.tsx` (delete it). Same loader; renders `<WorkItemDetail host="page" …/>`
  inside the project frame; `item.project_id !== projectId` stays `notFound()`.
- `/work-items/[workItemId]` — global, outside the project frame:
  `src/app/(tessera)/work-items/[workItemId]/page.tsx`, sync shell → `<Suspense>`
  → async child awaiting `params`, `await io()`, then one `readTessera` loading
  `loadProjectBundle(ctx, item.project_id)` + `loadWorkItemDetail(ctx, workItemId)`
  (both helpers in `src/app/(tessera)/work-items/load-detail.ts`, lane D3;
  `loadProjectBundle` copies the seven-line bundle body of
  `projects/[projectId]/layout.tsx` so lane C can switch the layout to it later).
  Renders `<ProjectProvider bundle>` + Breadcrumbs (Project › Work items › KEY) +
  `<WorkItemDetail host="page" …/>`. Add `export const instant = false` only if the
  instant-navigation validator reports the `notFound()` path (same reason as the
  project layout; `next/dist/docs/01-app/02-guides/instant-navigation.md`).
- `/browse/[key]` — `src/app/(tessera)/browse/[key]/page.tsx`: sync shell →
  `<Suspense>` → async child: `const { key } = await params; await io();`
  `if (parseKey(key) === null && !IdSchema.safeParse(key).success) notFound();`
  (`parseKey` and `IdSchema` from `@/lib/tessera/server`, which re-exports
  `core/keys` and `schemas`); then in a `try`: `item = await readTessera((ctx) => getWorkItemByKey(ctx, key))`
  (`src/lib/tessera/work-items.ts` line 483, accepts key or id, any case), `NOT_FOUND`/`VALIDATION`
  → `notFound()`; after the try: `redirect(`/projects/${item.project_id}/work-items/${item.id}`)`.
  `redirect` throws, so it stays outside `try` (`04-functions/redirect.md` lines 51–53)
  and is allowed in Server Components; it uses `replace` outside Server Actions (line 31).
- Tab labels: `src/components/shell/entity-labels.ts` (D3) — module store
  `registerEntityLabel(id: string, label: string)`, `useEntityLabels(): ReadonlyMap<string, string>`
  via `useSyncExternalStore` (server snapshot: empty map; never cleared so a tab
  keeps its label after navigating away). `WorkItemDetail` registers
  `${item.key} ${item.name}` in an effect. `TabBar.tsx` extends its lookup
  (`useMemo(() => ({ ...lookupFromNames(projectNames), workItemLabel: (id) => labels.get(id) }), [projectNames, labels])`;
  `lookupFromNames` is the helper the in-flight TabBar change in `tab-registry.ts` introduces,
  additive). `resolveTab`
  gains two cases (additive, with tests in `tests/ui/tab-registry.test.ts`):
  `/work-items/[id]` → `{ label: lookup.workItemLabel?.(id) ?? "Work item", icon: "work-item" }`
  and `/browse/[key]` → `{ label: key.toUpperCase(), icon: "work-item" }`; today both
  fall through to `titleCase(root)`.

### Detail components (D2) — `src/components/detail/`

Data shape (`src/components/detail/types.ts`, client-safe imports from
`@/lib/tessera/types`):

```ts
import type { ActivityLogEntry, WorkItem, WorkItemDetail, WorkItemLinkRow } from "@/lib/tessera/types";

export type WorkItemDetailData = {
  item: WorkItemDetail;                                   // WorkItem & { subscriber_ids, links: WorkItemLinkRow[] } (work-items.ts line 91)
  parent: Pick<WorkItem, "id" | "key" | "name"> | null;   // getWorkItem(ctx, item.parent_id)
  children: WorkItem[];                                   // listChildren(ctx, id) (line 506)
  activity: ActivityLogEntry[];                           // listActivity(ctx, { work_item_id: id }) (changes.ts line 163), newest first
  currentActorId: string;                                 // USER_ACTOR_ID, filled server-side ("assign me", subscribe toggle)
  cursor: number;                                         // latestSeq at load
};
export type DetailHost = "peek" | "modal" | "page";
```

The server helper `loadWorkItemDetail(ctx, id): WorkItemDetailData` is D3's
(above); D2 codes against the type. Components (all `"use client"`, CSS in
`src/components/styles/detail.css`, prefix `tessera-detail-`, one `@import` line in
`globals.css`):

```ts
export type WorkItemDetailProps = {
  data: WorkItemDetailData;
  host: DetailHost;
  onClose?: () => void;                       // peek and modal
  onHostChange?: (host: DetailHost) => void;  // the mode switcher in the header
  onOpenItem: (id: string) => void;           // parent, sub-item, `#` link: host decides (peek → replace ?peek, page → push)
};
export function WorkItemDetail(props: WorkItemDetailProps): JSX.Element;
```

- `WorkItemDetail` — one component, three hosts. Must mount inside
  `ProjectProvider` (reads `useProject()` for states, labels, actors, cycles,
  modules). Layout: `DetailHeader`; title (`Heading` that turns into an input on
  click/Enter, saved on blur or Enter via `updateWorkItemAction({ work_item_id, name })`);
  `PropertyRail` (right column from 960 px on `page`/`modal`, stacked above the
  description on `peek` with `compact`); `DescriptionEditor`; `SubItems`;
  `LinksList`; `ActivityFeed` (collapsed to the last 20 with "Show all"). Registers
  the entity label (D3's store) and the command context (D4's store, below) in one
  effect, both unregistered on unmount.
- `DetailHeader` `{ item, parent, host, onClose, onHostChange, onOpenItem }`:
  Astryx `Breadcrumbs` + `BreadcrumbItem` (`dist/Breadcrumbs/*.d.ts`: `href`,
  `onClick`, `isCurrent`, `startIcon`, `menu?: DropdownMenuOption[]`) — project
  (href `/projects/<id>/work-items`), parent key (onClick → `onOpenItem`), current
  key `isCurrent`; end: copy ID and copy URL `IconButton`s using
  `useClipboard({ announce: "Copied" })` (`dist/hooks/useClipboard.d.ts`: `copy`,
  `isCopied`), the mode switcher (three `IconButton`s: side, modal, page), close
  (peek/modal). Icons needed and missing from `src/themes/catppuccin/icons.tsx` are added
  there additively (`export const <Name>Icon = duotoneIcon(<Phosphor>);`, alphabetical),
  listed in the hand-off: `CopyIcon` (Copy), `LinkIcon` (Link), `SidebarIcon`
  (SidebarSimple), `ArrowsOutIcon` (ArrowsOutSimple), `DragHandleIcon` (DotsSixVertical),
  `BellIcon` (Bell), `BellSlashIcon` (BellSlash).
- `PropertyRail` `{ item, currentActorId, compact }` — Astryx `MetadataList`
  (`dist/MetadataList/MetadataList.d.ts`: `columns`, `label: { position, width }`,
  `orientation`) of the P2a controls from `@/components/work-items/properties`
  (`{ value, onChange, compact?, readOnly? }`): State → `updateWorkItemAction({ work_item_id, state_id })`;
  Priority → `{ priority }`; Assignees → `setAssigneesAction({ work_item_id, actor_ids })`;
  Labels → `setLabelsAction({ work_item_id, label_ids })`; Modules →
  `setModulesAction({ work_item_id, module_ids })`; Cycle → `{ cycle_id }`; Start /
  Target → `{ start_date }` / `{ target_date }` (`DateControl`; note the P2a
  double-fire gap in docs/PLAN-STATUS.md, dedupe by value); Parent → `ParentPicker`
  → `{ parent_id }`; Estimate → disabled control with tooltip "Arrives in P8";
  Subscribe toggle → `subscribeWorkItemAction` / `unsubscribeWorkItemAction({ work_item_id })`
  (`item.subscriber_ids.includes(currentActorId)`); Created / Updated as
  `Timestamp` (`dist/Timestamp/Timestamp.d.ts`: `value`, `format: "relative"`,
  `hasTooltip`). Each wrapper is a `div[data-property="state" | "priority" | "assignees" | "labels" | "cycle" | "modules" | "estimate" | "parent"]`
  so the shortcut dispatcher can open it (below). Writes follow the P2a
  `QuickDetail` pattern: call the action, Toast on `{ ok: false }`, the
  `refresh()` inside `runTool` re-renders the host with the new data.
- `ParentPicker` `{ value: string | null, onChange(id: string | null), projectId, excludeId }`:
  Astryx `Selector`-style ghost trigger showing the parent's key and name; the
  menu searches `GET /api/search?q=&scope=<projectId>&types=work_item&limit=8`
  (D4's route; D2 codes against the contract below) and excludes `excludeId` and
  its descendants (the engine rejects cycles with `RULE`; show the message).
- `SubItems` `{ parent: WorkItem, children: WorkItem[], onOpenItem }`: rows with
  key `Button` (→ `onOpenItem`), name, compact `StateControl`, `AssigneeControl`;
  "Add sub-item" inline input → `createWorkItemAction({ project_id, name, parent_id })`;
  reorder with alt+up / alt+down and a `…` menu ("Move up", "Move down", "Remove
  from parent" → `updateWorkItemAction({ work_item_id, parent_id: null })`) via
  `moveWorkItemAction({ work_item_id, before_id | after_id })`
  (`MoveWorkItemInput`, work-items.ts line 1266: a pure reorder needs no `group_by`).
  Drag-and-drop is optional in P2b; if added, reuse `src/components/dnd`.
- `LinksList` `{ workItemId, links: WorkItemLinkRow[] }`: title or URL host as the
  label, external `<a target="_blank" rel="noreferrer">`; add (small `Dialog` with
  Title + URL) → `addLinkAction({ work_item_id, url, title })`
  (`AddLinkInput`, links.ts line 79, http(s) only); edit → `updateLinkAction({ link_id, title?, url? })`;
  remove → `removeLinkAction({ link_id })`.
- `ActivityFeed` `{ entries: ActivityLogEntry[] }`: `Avatar` (`dist/Avatar/Avatar.d.ts`:
  `name`, `size: "xsm"`) + `actor_name`, verb and field in words ("changed state",
  "edited the description" — with `merged_count > 1` → "edited the description
  N times"), `Timestamp format="relative" hasTooltip`. `ActivityLogEntry = ActivityRow & { actor_name, merged_count, last_seq }`
  (changes.ts line 88). No client fetch; the host reloads on `refresh()`.
- `DescriptionEditor` `{ workItemId, text, version, readOnly }`: composes D1's
  `MarkdownEditor` (ref), `useDescriptionSave({ workItemId, serverText: text, serverVersion: version, editor })`
  and the Banner states from docs/contracts/editor.md ("Save queue"). Passes
  `mentionActors` from `bundle.actors`, `projectId`, `onOpenEntity` → work links go
  through `onOpenItem` after resolving the key with `GET /api/search?q=<KEY>&types=work_item&limit=1`
  (key hits score first, search.ts line 63); other schemes toast "Arrives in P3/P6".
- Server Actions: new file `src/app/actions/detail.ts` (lane D, same header as
  `src/app/actions/work-items.ts`: `"use server"` first line, `import { toolAction } from "./_run"`):
  `subscribeWorkItemAction = toolAction("subscribe_work_item")`,
  `unsubscribeWorkItemAction = toolAction("unsubscribe_work_item")`,
  `copyWorkItemAction = toolAction("copy_work_item")`,
  `addLinkAction = toolAction("add_link")`, `updateLinkAction = toolAction("update_link")`,
  `removeLinkAction = toolAction("remove_link")`. Nothing is added to lane C's
  `actions/work-items.ts`; its existing wrappers (lines 11–20) cover the rest.

### Power K and shortcuts (D4)

- `src/components/shell/CommandBar.tsx` (`"use client"`) on Astryx `CommandPalette`
  (`dist/CommandPalette/CommandPalette.d.ts`: `isOpen`, `onOpenChange`,
  `searchSource: SearchSource<T>`, `input?`, `footer?`, `renderItem(item, isSelected)`,
  `emptySearchText`, `emptyBootstrapText`, `label`, `width` 640, `maxHeight` 480).
  Mounted by one additive line in `TesseraShell.tsx` next to `ToastViewport`
  (D4 is the only P2b lane that edits `TesseraShell.tsx`; it also adds
  `openCommandBar: () => void` to `ShellContextValue`, and the Sidebar's search
  button, when lane B adds one, calls `useShell().openCommandBar()`).
- Opening: `useHotkeys([{ keys: "mod+k", onPress: open, allowInInputs: true }, { keys: "mod+/", onPress: openHelp, allowInInputs: true }])`.
  `mod+/` is a shift-free combo, so `event.key` matching is layout-safe here.
- Search source (`src/components/shell/command-source.ts`, pure apart from `fetch`):
  implements `SearchSource` from `@astryxdesign/core/Typeahead`
  (`dist/Typeahead/types.d.ts` line 77: `search(q)`, `bootstrap()`, `cancel?()`);
  items are `SearchableItem` (`{ id, label, element?, auxiliaryData? }`, auto-grouped
  by `auxiliaryData.group`, line 26). `bootstrap()` returns the static commands for
  the current context; `search(q)` aborts the previous request (`cancel()` holds an
  `AbortController`), waits 150 ms, fetches `/api/search` and merges the hits with
  the static commands whose label or keywords contain `q`. Selection: the palette
  closes and `onValueChange(value)` delivers the chosen item id (picker mode,
  `value`/`onValueChange` props); `CommandBar` keeps a `Map<id, () => void>` built
  with the items and runs the handler. Section order (group names): "Work items",
  "Projects", "Cycles", "Modules", "Pages", "Actions", "Create", "Navigate", "Settings".
  Hit ids are `hit:<type>:<id>`; command ids are `CommandId`s: the `ShortcutId`s below plus the palette-only theme commands.
- Theme commands in the "Settings" group: "Theme: Frappé (dark)", "Theme: Latte (light)" and "Theme: Match system" call `setColorScheme("dark" | "light" | "system")` from `src/components/shell/color-scheme.ts`. They are palette-only commands with ids `theme.dark`, `theme.light` and `theme.system`, have no key binding, and are not entries in `SHORTCUTS`.
- Scope: inside a project (`useOptionalProject()` non-null) `scope=<projectId>`
  and a footer toggle "All projects" (`CommandPaletteFooter` replaced through the
  `footer` slot) drops it; outside, no scope.
- "Ask" tab: the `input` slot renders `<CommandPaletteInput …>` above a `TabList`
  (`size="sm"`) with "Search" and "Ask"; "Ask" shows `CommandPaletteEmpty` text
  "The assistant arrives in P5" and disables the list. Both components are exported
  from `@astryxdesign/core/CommandPalette` (`dist/CommandPalette/index.d.ts`).
- `GET /api/search` — `src/app/api/search/route.ts` (D4), pattern of
  `src/app/api/changes/route.ts`: params `q` (required, ≤ 500 chars, else 400),
  `scope` (project id, optional), `types` (comma list of `work_item|page|cycle|module|project`,
  optional), `limit` (1–200, default 20). Runs
  `readTessera((ctx) => searchAll(ctx, q, { scope: scope ? { project_id: scope } : undefined, types, limit }))`
  (`src/lib/tessera/search.ts` line 334; `SearchAllInput` line 46) and returns
  `{ hits: SearchHit[] }` (`SearchHit = { type, id, project_id, key?, title, subtitle?, score }`,
  line 26) with `Cache-Control: no-store`. `VALIDATION` → 400 `{ error }`.
  Consumers: Power K, `#` mentions, `ParentPicker`, entity-link resolution.
- Contextual actions: `src/components/shell/command-context.ts` (D4; D2 imports
  `registerCommandContext` — whichever lane needs the file first creates it with
  exactly this surface so the merge is clean):

```ts
export type CommandItem = { id: string; key: string; title: string; projectId: string; url: string };
export type CommandContextValue = { item: CommandItem; actions: Partial<Record<ShortcutId, () => void>> };
export function registerCommandContext(value: CommandContextValue): () => void;  // returns unregister
export function useCommandContext(): CommandContextValue | null;                  // useSyncExternalStore, server snapshot null
```

  `WorkItemDetail` registers `{ item, actions }` where `actions` opens the
  matching `PropertyRail` control (`item.state` → focus the first `button` inside
  `div[data-property="state"]` and `.click()` it; the P2a ghost `Selector`s open on
  click; switch to an `isOpen` prop if lane C adds one), `item.assignMe` →
  `setAssigneesAction` with the union of `assignee_ids` and `currentActorId`,
  `item.subscribe` toggles, `item.delete` opens Astryx `AlertDialog`
  (`dist/AlertDialog/AlertDialog.d.ts`: `title`, `description`, `actionLabel`,
  `onAction`, `cancelLabel`, `actionVariant: "destructive"`) → `deleteWorkItemAction({ work_item_id })`
  → close/navigate to the list, `item.copyId` / `item.copyTitle` / `item.copyUrl`
  via `useClipboard`, `item.estimate` → Toast "Arrives in P8". When a context is
  registered, Power K's bootstrap adds the "Actions" group ("Change state…",
  "Change priority…", "Assign…", "Assign to me", "Labels…", "Subscribe"/"Unsubscribe",
  "Copy ID", "Copy link", "Open full page", "Delete…").
- Registry `src/components/shell/shortcuts.ts` (pure, no React; tests in
  `tests/ui/shortcuts.test.ts`):

```ts
export type ShortcutId =
  | "palette.open" | "shortcuts.help" | "peek.close"
  | "item.state" | "item.priority" | "item.assign" | "item.assignMe" | "item.labels" | "item.estimate"
  | "item.cycle" | "item.modules" | "item.subscribe" | "item.delete" | "item.copyId" | "item.copyTitle" | "item.copyUrl"
  | "create.workItem" | "create.cycle" | "create.module" | "create.view" | "create.page" | "create.project"
  | "nav.home" | "nav.workItems" | "nav.cycles" | "nav.modules" | "nav.views" | "nav.pages" | "nav.inbox"
  | "nav.archives" | "nav.settings" | "nav.yourWork" | "nav.analytics" | "nav.projects" | "nav.intake" | "nav.drafts";
export type CommandId = ShortcutId | "theme.dark" | "theme.light" | "theme.system";
export type ShortcutDef = { id: ShortcutId; label: string; keys: string; group: "Global" | "Work item" | "Create" | "Navigate"; needsItem?: boolean; arrives?: "P3" | "P5" | "P6" | "P7" | "P8" | "P9" };
export const SHORTCUTS: readonly ShortcutDef[];
export const CHORD_WINDOW_MS = 1000;
export type KeyLike = { code: string; key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean };
export type ChordState = { prefix: "g" | "n"; at: number } | null;
export type ShortcutContext = { isMac: boolean; hasItem: boolean; isTyping: boolean; singleKeys: boolean };
export type Resolved = { kind: "action"; id: ShortcutId } | { kind: "chord"; prefix: "g" | "n" } | null;
export function resolveShortcut(event: KeyLike, chord: ChordState, now: number, context: ShortcutContext): Resolved;
export function formatKeys(keys: string, isMac: boolean): string;   // "mod+." → "⌘ ." / "Ctrl ."
```

  Matching is by `event.code` (`KeyS`, `KeyP`, `KeyA`, `KeyI`, `KeyL`, `KeyE`,
  `KeyC`, `KeyM`, `KeyG`, `KeyN`, `Period`, `Quote`, `Comma`, `Slash`, `Delete`,
  `Backspace`) plus modifiers (`mod` = `metaKey` on Mac, `ctrlKey` elsewhere), which
  is why the item shortcuts do not go through Astryx `useHotkeys`: it compares the
  final key with `event.key`, so `mod+shift+'` and `mod+shift+,` would depend on the
  keyboard layout (`dist/hooks/useHotkeys.d.ts`, "Shift semantics"). Table:
  `s` state, `p` priority, `a` assign, `i` assign me, `l` labels, `shift+e` estimate
  (P8 hint), `shift+c` cycle, `shift+m` modules, `shift+s` subscribe (P7 hint:
  "Notifications arrive in P7", the subscription itself works), `mod+delete`
  (`Delete` or `Backspace`) delete with confirm, `mod+.` copy ID, `mod+shift+'` copy
  title, `mod+shift+,` copy URL; chords `n` then `i` work item / `c` cycle (P3) /
  `m` module (P3) / `v` view (P3) / `d` page (P6) / `p` project; `g` then `h` Home
  (`/home`) / `i` work items of the current or last project (`tessera.lastProject.v1`)
  / `c` cycles (P3) / `m` modules (P3) / `v` views (P3) / `d` pages (P6) / `k` inbox
  (P7) / `r` archives (P9) / `s` settings (P8) / `j` your work (P9) / `a` analytics
  (P9) / `p` projects (`/projects`) / `x` intake (P8) / `y` drafts (P9). docs/PLAN.md
  §6 lists the letters without meanings; these assignments are the contract. A
  target that does not exist yet shows a Toast "Arrives in P<n>" (`arrives`).
  `g`/`n` are discarded after `CHORD_WINDOW_MS` or on any non-matching key.
  Item shortcuts resolve only when `hasItem`; single-key shortcuts resolve only when
  `singleKeys` (off switch in the help dialog, `localStorage` `tessera.shortcuts.v1`
  `{ "singleKeys": boolean }`, satisfying the WCAG note in `useHotkeys.d.ts`).
- Dispatcher `src/components/shell/useShortcuts.ts` (`"use client"`, mounted once
  inside `CommandBar`): one `window` keydown listener; `isTyping = isTypingTarget(event.target)`
  (`tab-registry.ts` line 20, the TabBar's own check) blocks everything except
  `palette.open` and `shortcuts.help`; `hasItem = useCommandContext() !== null`;
  item ids run the registered context action, `create.workItem` pushes
  `/projects/<current or last>/work-items?create=1` (what the Sidebar does today;
  `QuickCreate` from the P2a note does not exist yet), `nav.*` push routes,
  `peek.close` is left to `PeekHost`. `event.preventDefault()` only when something resolved.
- Help dialog (`mod+/` and the "Keyboard shortcuts" command): Astryx `Dialog`
  listing `SHORTCUTS` by group with `Kbd` (`dist/Kbd/Kbd.d.ts`: `keys` string such
  as `"mod+k"`) and the single-key switch.

### Lane split and file ownership

| Lane | Creates | May edit additively (name it in the hand-off) | Must not touch |
|---|---|---|---|
| D1 editor | `src/components/editor/**`, `src/components/styles/editor.css`, `src/app/api/work-items/[workItemId]/description/route.ts`, `tests/editor/**` | `src/app/globals.css` (one `@import`), `src/themes/catppuccin/icons.tsx` (`DragHandleIcon`), `package.json` + lockfile only for the three installs in editor.md | `src/components/detail`, `src/components/shell`, `src/components/work-items`, `src/app/actions/*` |
| D2 detail | `src/components/detail/**` (except `PeekHost.tsx`, `peek-url.ts`, `peek-prefs.ts`), `src/components/styles/detail.css`, `src/app/actions/detail.ts` | `src/app/globals.css` (one `@import`), `src/themes/catppuccin/icons.tsx` (icons listed above), `src/components/shell/command-context.ts` only if absent (verbatim surface) | `WorkItemsScreen.tsx`, `properties/*`, `TesseraShell.tsx`, `TabBar.tsx`, routes |
| D3 hosts | `src/components/detail/{PeekHost.tsx,peek-url.ts,peek-prefs.ts}`, `src/components/shell/entity-labels.ts`, `src/app/(tessera)/work-items/**`, `src/app/(tessera)/browse/**`, `tests/ui/peek-url.test.ts` | `projects/[projectId]/work-items/page.tsx` (peek load + `PeekHost`), `projects/[projectId]/work-items/[workItemId]/page.tsx` (replace `QuickDetail`, delete `QuickDetail.tsx`), `WorkItemsScreen.tsx` (`onOpen` body + one import), `TabBar.tsx` (lookup), `tab-registry.ts` (two cases), `tests/ui/tab-registry.test.ts` | `TesseraShell.tsx`, `Sidebar.tsx`, `properties/*`, `src/components/editor` |
| D4 Power K | `src/components/shell/{CommandBar.tsx,command-source.ts,command-context.ts,shortcuts.ts,useShortcuts.ts}`, `src/app/api/search/route.ts`, `tests/ui/shortcuts.test.ts` | `TesseraShell.tsx` (mount + `openCommandBar`), `Sidebar.tsx` (search button → `openCommandBar`, if the button exists), `src/components/styles/shell.css` | `tab-registry.ts`, `TabBar.tsx`, `src/components/detail`, `src/components/work-items`, routes other than `api/search` |

Shared contracts between lanes are the types and signatures in this section;
until all four merge, a lane that imports another lane's module may stub it
locally with the exact exported names and must delete the stub in its hand-off.
`WorkItemDetail` (D2) is rendered by D3's hosts with the props above; D2 ships a
`src/components/detail/index.ts` exporting `WorkItemDetail`, `DescriptionEditor`
and the types.

### Acceptance (P2b)

Browser steps (docs/PLAN.md §12, through `.claude/launch.json` → `tessera`), in order:

1. Steps 1–4 of §12 still pass (project `WEB`, `WEB-1`, drag, priority + due date);
   step 4 is done in the peek: press Enter on the row → `?peek=<id>` opens the
   side panel, set priority High and a due date, reload → both kept and the peek
   is still open; Escape closes it and drops `?peek` while keeping `q`.
2. Step 5: type in the description, reload within 200 ms → text persisted (the
   `pagehide` beacon hits `POST /api/work-items/<id>/description`; check the
   Network panel for a 200).
3. Step 6: from the stdio MCP change the state → the open tab refreshes within
   5 s. Then type in the description and, before the 400 ms save, change the
   description from the MCP (`update_work_item_description`) → the Banner
   "Changed elsewhere" with "Keep mine" / "Load theirs" appears instead of a silent
   overwrite; "Keep mine" saves and the Banner clears.
4. `mod+k`, type `WEB-1` → the item is the first hit; Enter opens it (peek inside
   the project, full page elsewhere). "All projects" toggle shows the same hit from `/home`.
5. With the peek open, `s` opens the state picker; `mod+.` copies the ID (toast
   or announce); `mod+/` lists the shortcuts.
6. `/browse/WEB-1` redirects to `/projects/<id>/work-items/<itemId>`;
   `/browse/NOPE-9` renders not-found; `/work-items/<itemId>` renders the detail
   without the project tabs and its tab label reads `WEB-1 <title>`.
7. Drag the peek's handle → width changes within 360–720 px and survives reload;
   switch to modal → survives reload.
8. Round trip: paste a description with a table, nested task list and a
   `[WEB-1](work:WEB-1)` link, reload → the editor shows the same content and the
   chip opens the item.

Gate: `npm run check` green (lint, conventions, licences, Vitest including
`tests/editor/*` under jsdom and `tests/ui/{shortcuts,peek-url,tab-registry}.test.ts`),
`next build` green, no hydration warnings in the dev console on the list, the
peek, the full page, `/work-items/[id]` and `/browse/[key]`.

### API verification and mismatches found while writing this section

1. docs/PLAN.md §11 names `@tiptap/extension-task-list`, `@tiptap/extension-placeholder`
   and `@tiptap/extension-bubble-menu` as installs; in Tiptap 3.31.4 the pieces come
   from `@tiptap/extension-list`, `@tiptap/extensions` and `@tiptap/react/menus`.
2. `@tiptap/extension-link@3.31.4` and `@tiptap/extension-list@3.31.4` are only
   transitive today; add them as exact direct dependencies (editor.md).
3. No DOM test environment is installed; add devDependency `jsdom@30.1.2` (MIT) and
   use the per-file `// @vitest-environment jsdom` docblock.
4. Astryx `useHotkeys` matches the final key against `event.key`
   (`dist/hooks/useHotkeys.d.ts`), so `mod+shift+'` / `mod+shift+,` would be
   layout-dependent; item shortcuts use the `event.code` resolver above, and
   `useHotkeys` is used only for `mod+k`, `mod+/`, `escape`.
5. `@/lib/tessera/core/ids` (`isId`) is not importable from components; use
   `IdSchema.safeParse` from `@/lib/tessera/schemas`.
6. `refresh()` is Server-Action-only (`refresh.md` line 13): the beacon route and
   `/api/search` cannot refresh; the route mirrors `_run.ts` without it.
7. Astryx `AppShell` has no right-panel slot; the peek is a `Layout` `end` slot
   inside the page (`LayoutPanel` + `ResizeHandle isReversed`).
8. Astryx `Banner` has no `actions` prop; buttons go in `endContent`
   (`dist/Banner/Banner.d.ts`).
9. `useResizable` persists through `autoSaveId` in its own format and its single
   config uses `defaultSize/minSize/maxSize` (not SideNav's `defaultWidth/minWidth/maxWidth`
   from `ResizableConfig`); the contract stores `tessera.peek.v1` itself via `onSizeChange`.
10. `resolveTab` labels `/work-items/[id]` and `/browse/[key]` by `titleCase(root)`
    today; two additive cases are needed (D3).
11. `actions/work-items.ts` has no subscribe/copy/link wrappers; they go in the new
    lane-D file `actions/detail.ts`.
12. The P2a shell note above mentions `QuickCreate` and a `mod+k` search button;
    neither exists in `src/components/shell/` yet (the Sidebar's "New work item"
    pushes `?create=1`), so D4 wires `n i` to that URL and `mod+k` itself.
13. The Astryx `work-item-detail` page template (`node_modules/@astryxdesign/cli/assets/templates/pages/work-item-detail/page.tsx`)
    is stylex-based reference code: port ideas only, never import it.
14. Astryx declarations live under `node_modules/@astryxdesign/core/dist/<Name>/`;
    the P2a rule's `core/<Name>` path does not exist.
15. `@tiptap/markdown` keeps unrecognised HTML as literal text and needs
    `window.DOMParser` for recognised inline HTML (`dist/index.js` ~927); without a DOM
    everything becomes literal text, which is why the corpus runs under jsdom.
