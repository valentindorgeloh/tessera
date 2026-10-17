# UI contract

Owner: lane A for this document; the code is split between lanes B (shell), C (work items), D (detail, editor, pages), E (planning), F (views, analytics, settings) and G (AI) per `docs/contracts/OWNERS.md`. Astryx rules in `.cursor/rules/astryx.mdc` apply to every file: no raw `div`/`span` layout, components and tokens only, Phosphor icons through `src/themes/catppuccin/icons.tsx`, no xstyle, no hex, no px except structural widths.

## Route groups

```
src/app/layout.tsx                 fonts + <Providers> only (no app frame)
src/app/(handbook)/layout.tsx      legacy handbook frame (<WorkspaceFrame>); routes / and /items/[id]; deleted in P6
src/app/(tessera)/layout.tsx       Tessera frame: AppShell (TopBar, SideNav, content panel) + ToastViewport + ChangesPoller + RecentsTracker
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

It renders `<ProjectProvider bundle={bundle}>` (client context in `src/components/work-items/project-provider.tsx`, lane C) and `<ProjectFrame>`: the panel header (`PanelHeader` with one 52px `PanelBar`, "Panel headers" under Shell) holding the project token, the project name as the page's h1 (`PanelTitle`), a vertical divider and the section `TabList` (`size="sm" layout="hug"`, docked on the header hairline) for Work items / Cycles / Modules / Views / Pages / Intake / Settings according to the feature toggles; tabs whose routes do not exist yet are omitted. The tabs are the project's only page navigation (the sidebar lists projects as flat rows); project-wide actions go in the bar's `end`. The frame's content is one scrolling `LayoutContent`. Every property control reads the bundle from `useProject()`; nothing fetches lists client-side except search typeahead.

## Work items screen (lane C)

`WorkItemsScreen` (client) owns the filter bar, the display menu, quick-add and the layout switch. The server page passes `result: WorkItemListResult`, the resolved `display`, `filters` and the `view_settings` defaults. It is a fill `Layout` whose `PanelHeader` stacks two rows: the 44px sub-header (`PanelBar size="subheader"`: "Work items" and the total as a purple `Badge`; at the end `LayoutSwitch`, the display menu and the primary sm "New work item") and the 44px filters row (`PanelBar size="filters" hasDivider` with the filter bar). Only the layout below them scrolls.

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

List rows (`ListLayout`): the title is `RowTitle` (Astryx `Text weight="medium" maxLines={1}`, class `tessera-wi-title`) inside `ListItem`'s label; `work-items.css` gives the label slot `min-width: min(14rem, 100%)` (16rem until the layout rework merge, where it put the title under its key in the list beside a side peek at 1100px) and lets the row wrap, so properties move to a second line (kept at the end) instead of squeezing the title; on a line narrower than the chips (a phone) the chips wrap too. Selectors reach Astryx's slots only through our own classes (`:has(.tessera-wi-title)`, `:has(> .tessera-wi-props)`). Rows are at least 44px; the key is supporting-size, secondary and tabular; the key's text and the last property line up with the panel header's 16px inset. A group header is a 40px muted band: the `Collapsible` trigger (Astryx's documented `astryx-collapsible-trigger` class, scoped under `.tessera-wi-group`) is sticky, so the band stays at the top of the list while its group scrolls under it. In a row the compact ghost controls (selectors, and the date buttons through their own `tessera-wi-chip` class, so a selector's clear button keeps its Astryx look) read as chips: 24px, a control outline (`--color-border-emphasized`, 3:1 or more on every surface), `--radius-inner`, supporting-size text, no chevron (`.tessera-wi-props` rules in `work-items.css`); the detail keeps the full controls. The band sets only `background-color`, so the trigger's pressed overlay still shows, and the list scroller (`tessera-wi-scroller`) has a `scroll-padding-block-start` so focus moved into view is never hidden under a band; the detail body gives its descendants the matching `scroll-margin-block-start` under the pinned detail header.

Board (`BoardLayout`): 350px columns (`COLUMN_WIDTH`, repeated in `board.css`) with 16px gaps on a muted backdrop whose corners are concentric with the 8px cards (12px padding) inside them. Table (`TableLayout`): the first column's text lines up with the panel header (`table.css`).

Property controls live in `src/components/work-items/properties/` and are reused by the detail panel (lane D) and bulk bar (lane E): `StateControl`, `PriorityControl`, `AssigneeControl`, `LabelControl`, `DateControl` (start or target), `CycleControl`, `ModuleControl`, `EstimateControl` (P8). Each takes `{ value, onChange, bundle?, compact?, readOnly? }` and renders a ghost `Selector` / `MultiSelector` / `DateInput`; state shows a `StatusDot` by group, labels and cycles show `Token` with the palette colour, priority shows the Phosphor priority icon.

Create dialog: `CreateWorkItemDialog` (Astryx `Dialog` + `FormLayout`): name, description (plain `TextArea` until the editor lands in P2b), state, priority, assignees, labels, cycle, modules, dates; "Create more" keeps it open; closing with a dirty form asks "Save this draft?" (P8 wires drafts; until then the dialog just confirms discard). Quick-add: inline row at the bottom of a group / column that creates with that group's value.

Filter bar: Astryx `PowerSearch` tokens for state, priority, labels, assignees, cycle, module, dates, text, in the filters row. The layout switch is `LayoutSwitch` (`DisplayMenu.tsx`): an icon-only sm `SegmentedControl` (List, Board, Table) in the sub-header, writing through the same `useDisplayWriter` as the display menu. The display menu is a `Popover` with `Selector`s for group / sub-group / order / properties.

## Shell (lane B)

- Frame (`TesseraShell.tsx`): `AppShell variant="wash" contentPadding={2}`, so the top bar and the sidebar sit on the wash (`--color-background-body`) and the content sits in one rounded panel 8px in from the wash on every side: a `Card padding={0} height="100%"` with class `tessera-panel` (`--radius-page`, 16px). Only the screen's own `LayoutContent` scrolls inside it. The shell also mounts `ToastViewport` and `CommandBar`; `(tessera)/layout.tsx` adds `RecentsTracker` and `ChangesPoller` together in one `Suspense` beside the content, not in the sidebar, whose mobile drawer React pauses while closed. There is no tab strip.
- Top bar (`TopBar.tsx`, Astryx `TopNav`): the sidebar collapse button (desktop only) and the brand ("Tessera", logo tile, → `/home`); in the middle the search field (`tessera-topbar-search`, about 364px, sm): a read-only `TextInput` (named "Search work items and commands", `aria-haspopup="dialog"`) with a `mod+k` `Kbd` that opens Power K on a click, Enter, Space, the arrow down or any printable key, the key becoming the palette's first query (`openCommandBar(initialQuery)`); at the end a help button (keyboard shortcuts, as `mod+/`) and the account menu (`Avatar` in a ghost `IconButton`) with the Colour scheme radio group and Keyboard shortcuts.
- Sidebar (`Sidebar.tsx`, Astryx `SideNav` on the wash): the "Work" heading (→ `/home`); a quiet secondary sm "New work item" button (an icon button while collapsed) that opens the create dialog for the last visited project (`tessera.lastProject.v1`), else the first, and is disabled with "Create a project first" when there are none; Home and Projects; the "Projects" section with a "+" (Create project, as `n p`) and the projects as flat rows (logo icon, name, total count; the current project selected). A project's own pages are the tabs in its panel header, not sidebar children. Resizable from 236 to 350px (250 by default), the width kept in `tessera.sidebarWidth.v1` and read after mount so the first render matches the server's. `mod+b` and the top bar's button collapse it; the collapsed state is `TesseraShell` state and is not persisted (it resets on reload). The "New work item" tooltip names the global chord (`n i`, "N then I"). `SidebarSkeleton.tsx` mirrors it while the layout streams.
- Panel headers (`PanelHeader.tsx`): a screen puts one `PanelHeader` (an Astryx `LayoutHeader`, hairline below; a labelled `div`, not a landmark, as before the rework) in its `Layout` header and stacks `PanelBar` rows in it: `size="header"` 52px (title, tabs, page actions), `"subheader"` 44px (the view's name and count, layout, display, the primary action), `"filters"` 44px (the filter bar; `hasDivider` draws the hairline above it). Heights come from tokens (`--size-element-md` plus `--spacing-5` or `--spacing-3`). `canWrap` (the work items sub-header) lets a row wrap: the end group drops under the title when both do not fit (a phone, the peek open) and wraps its own actions; without it the start group shrinks and the end group stays whole. A bar is a plain `HStack` with a 16px inline padding, not an Astryx `Toolbar`, so the tabs and the filter field keep their own arrow-key handling. `PanelTitle` is the page's h1 at the working size (14px medium, `Heading level={4} accessibilityLevel={1}`). `PanelPage` is a pinned header over scrolling content, `width="reading"` centring it in a 960px column (a `VStack` with class `tessera-reading`: Home and Projects) or `"full"`. The not-found screen is its own centred `EmptyState`, also used outside the shell.
- Recents (`recents.ts`, `recents-store.ts`, `RecentsTracker.tsx`): every visited path, normalised as before (`resolveRoute`, `isTransientPath`), goes to the front of a list of at most 12 (`addRecent`; `/home` and transient routes skipped; a work item's project route and its global `/work-items/<id>` route count as one entry, `isSameRecent`), kept in `localStorage` `tessera.recents.v1` (`parseRecents` validates it) behind a `useSyncExternalStore` store whose server snapshot is empty. A work item opened in the peek is recorded by `PeekHost` once it has loaded, as a visit to its full page (`workItemPath`), so a peek that shows "not found" never becomes a recent. Every write starts from the stored list and a `storage` listener follows other tabs, so tabs never erase each other's visits. `forgetRecentsUnder(path)` drops a route and the routes under it: the detail calls it after a delete (the project path and `/work-items/<id>`), and the not-found screens (`NotFoundScreen`, the project's "Not found in this project") call `useMissingRoute()`, which forgets their own address and skips the tracker's visit to it, so a dead recent goes away once it has led there. Home shows the newest 8 first (`RecentsList.tsx`); Power K shows a "Recent" group of 5 when the query is empty, leaving out the page on screen and the item open in its peek (`onScreenPaths`, `otherRecents`). Pure functions in `recents.ts` and the store have Vitest coverage.
- Sidebar data: `listProjects` (with counts).
- `QuickCreate`: global create dialog host so the sidebar button and `n i` shortcut open the same dialog as lane C's screen (lane C exports `CreateWorkItemDialog`; lane B mounts it).
- Home at `/home` (`PanelPage width="reading"`): Recents, then the "Since you were last here" placeholder card (P5/P9 fill it), then project rows from `listProjects` in a `List` with `edgeCompensation="inline"` (no Section around it: Section bleeds outward and would shift the heading).
- Keyboard: `useHotkeys` from `@astryxdesign/core/hooks` (verify the call form in `node_modules/@astryxdesign/core/hooks`); shortcut list per docs/PLAN.md §6. `isTypingTarget` lives in `shortcuts.ts`.
- Colour scheme: the account menu in the top bar holds "Colour scheme" (Frappé (dark), Latte (light), Match system). State lives in `src/components/shell/color-scheme.ts` (`useColorScheme`, `setColorScheme`, `localStorage` key `tessera.scheme.v1`); its values are the Astryx `<Theme mode>` values, which `src/app/providers.tsx` passes through.

## Theme

- The theme is the local Astryx theme `catppuccin` in `src/themes/catppuccin/`. Edit `palette.ts` (colours and `[latte, frappe]` token pairs, the only place for hex) or `catppuccinTheme.ts` (`defineTheme`). Then run `npm run astryx -- theme build src/themes/catppuccin/catppuccinTheme.ts`, and again after every Astryx upgrade.
- Never edit the generated `catppuccin.{css,js,d.ts,css.d.ts}` (`npm run check:theme` fails when they are stale) or `src/astryx-themes.ts` (regenerate it with `npm run astryx -- theme add catppuccin --import`; `npm run astryx -- doctor` fails its theme-module check when it drifts). Every local import of the theme must resolve inside `src/themes/catppuccin/`; Astryx refuses the theme otherwise, which is why the icons live there.
- A new colour pair gets a case in `tests/themes/catppuccin-contrast.test.ts` (text 4.5:1; icons, control outlines and the focus ring 3:1; translucent fills composited over their surface). `tests/themes/catppuccin-wiring.test.ts` checks the built CSS carries the palette, the syntax mapping and the overrides the contrast test assumes.
- Density: the theme's type scale is `{ base: 14, ratio: 1.2 }` (body 14px, supporting 12px, h1 24px), with sm controls (28px) in headers and rows. A 16px or `1rem` assumption in app CSS is a bug; use the tokens.
- Corners: `--radius-inner` (4, chips and tokens), `--radius-element` (8, buttons, inputs, cards nested in a column), `--radius-container` (12, cards, menus, dialogs), `--radius-page` (16, page panels). Use `--radius-full` only for avatars and badges. A container's corner is the radius of the surface nested in it plus the padding between them, written with `calc()` on tokens (`src/components/styles/board.css`: 8px cards in 8px padding give 16px columns).
- Exceptions to "only avatars and badges are round", inherent to the component: the `Switch` track and thumb, the radio indicator, status dots and spinners, the `Token` remove button, tab underline caps, and in date pickers the `Calendar` range bands and the touch month-scroller puck (neither themeable; revisit if a range or touch picker lands).
- `--radius-page` (16) is the content panel's corner (`.tessera-panel`, 8px from the wash). The side peek is a 12px card 4px inside the panel's 1px border (5px from its outer edge), so its corners follow the panel's 16px ones.
- Control outlines (inputs, selectors, checkbox and radio rings, the off switch track) use `--color-border-emphasized`, tuned to 3:1 on every surface (WCAG 1.4.11). Change it only together with the contrast test.
- A restyle of a whole component goes in `components` in `catppuccinTheme.ts`, keyed by `npm run astryx -- theme targets <Name>`, never in app CSS and never through private `--_*` variables. Per-instance layout stays className + tokens. Current overrides:
  - Hairline borders on `popover` and `context-menu`.
  - Token text colour on `popover`, `context-menu` and `dialog`; the browser's default styles for `<dialog>` and `[popover]` set `color: CanvasText` (pure white or black), which glyphs without their own colour would inherit.
  - The off `switch` track takes `--color-border-emphasized` (the gray chip tint is too faint). Only the off state, so the checked track keeps Astryx's accent, hover tint and forced-colors colours. Trade-offs: the off track loses Astryx's 5% hover tint, and a disabled off track shows the outline colour at Astryx's half opacity.
  - Rounded-square `nav-icon`, `tab-scroll-button` and `calendar-day`.
  - `banner` scopes two tokens: secondary text reads as primary on the status tint, and `--color-neutral` is the plain surface, so secondary buttons in a banner do not stack their fill and hover overlay on the tint (Astryx's own themes scope banner tokens the same way). `banner-icon` gives the warning and success glyphs their text colours, because Latte yellow and green stay under 3:1 on their tint.
  - `onDark`/`onLight`: the focus ring on inverted surfaces (toasts) uses the on-colour, as the accent does there.
- Accepted trade-offs (not every pair can pass; these are recorded rather than tuned away): a ghost button's hover on a Latte error banner falls to 4.4:1 on the shell wash and 4.1:1 on a muted well, where banners do not render (the test covers content surfaces); the table cell-selection tint and active bubble-menu marks differ from their resting state by less than 3:1, as they did under paper.
- Editor surfaces (`src/components/styles/editor.css`) follow the same rules: the frame is a control outline (`--color-border-emphasized`, accent while focused), entity links are purple chips (`--color-background-purple` / `--color-text-purple`), the placeholder is secondary text, and the bubble menu and suggestion popover are shaped like Astryx menus (12px around 8px rows at a 4px inset).
- Code highlighting uses Astryx's default syntax mapping (`syntaxTokenDefaults`, declared in the theme so it resolves to the Catppuccin text tokens). Code colours therefore follow `--color-text-{accent,green,orange,blue,purple,cyan,red,teal,secondary,primary}`.
- The root layout sets `<html data-theme="dark">`, the Astryx SSR hint for the Frappé default; the root `<Theme>` updates it after hydration. Until then `<html>` and `<body>` resolve Astryx's default tokens, because the root `<Theme>` copies `data-astryx-theme` onto `<html>` in an effect. So every page paints its own surface inside the Theme wrapper: the shell does, and the root not-found page uses `.tessera-root-frame` (`src/app/globals.css`).

## Astryx usage rules that caught agents before

- Verify every component's props with `npx astryx component <Name>` or the `.d.ts` under `node_modules/@astryxdesign/core/<Name>` before use; names in the plan marked *check* changed between versions.
- Templates under `node_modules/@astryxdesign/cli/assets/templates/pages/` are reference code under MIT: port them (className + tokens, Phosphor icons), never import or paste them; they use `@stylexjs/stylex` and `@heroicons/react`, both forbidden by `scripts/check-conventions.ts`.
- `Link` goes through Astryx's `LinkProvider` (already configured in `src/app/providers.tsx` with `next/link`).
- CSS lives in `src/components/styles/<area>.css`, imported once from `src/app/globals.css` (one additive `@import` line per area), tokens only.

## Verification per phase

- Vitest for pure helpers (`url-state`, `recents`, the DnD reducer, grouping adapters).
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
  `{ width: 480, mode: "side" }`, same pattern as the recents store). Only `?peek` is in the URL.
- Resizing: `const peek = useResizable({ defaultSize: prefs.width, minSize: 360, maxSize: 720, direction: "horizontal", onSizeChange: (size) => savePeekPrefs({ width: size }) })`
  then `<LayoutPanel resizable={peek.props} hasDivider={false} padding={1} isScrollable={false} label="Work item" role="complementary">`
  holding `<Card padding={0} height="100%" elevation="low" className="tessera-peek-card">` around the slot,
  with `<ResizeHandle resizable={peek.props} direction="horizontal" isReversed hasDivider={false} />`
  placed before the panel. The side peek is an inset card (layout rework, 2026-10-11): 12px corners
  4px inside the 16px content panel, its own hairline and low shadow, the detail scrolling inside it (`dist/Resizable/useResizable.d.ts`: `ResizableRegion.props`
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
- Recents labels: `src/components/shell/entity-labels.ts` (D3) — module store
  `registerEntityLabel(id: string, label: string)`, `useEntityLabels(): ReadonlyMap<string, string>`
  via `useSyncExternalStore` (server snapshot: empty map; never cleared so a recent
  entry keeps its label after navigating away). `WorkItemDetail` registers
  `${item.key} ${item.name}` in an effect. The recents store (`recents-store.ts`) labels
  each path with `resolveRoute(path, { ...lookupFromNames(projectNames), workItemLabel: (id) => labels.get(id) })`
  (`recents.ts`, tests in `tests/ui/recents.test.ts`): `/work-items/[id]` →
  `{ label: lookup.workItemLabel?.(id) ?? "Work item", icon: "work-item" }` and
  `/browse/[key]` → `{ label: key.toUpperCase(), icon: "work-item" }`. (Until the
  layout rework these labels named the tabs of the removed `TabBar`.)

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
  onHostChange?: (host: DetailHost) => void;  // the "Open as" menu in the header
  onOpenItem: (id: string) => void;           // parent, sub-item, `#` link: host decides (peek → replace ?peek, page → push)
};
export function WorkItemDetail(props: WorkItemDetailProps): JSX.Element;
```

- `WorkItemDetail` — one component, three hosts. Must mount inside
  `ProjectProvider` (reads `useProject()` for states, labels, actors, cycles,
  modules). Layout: `DetailHeader`; title (`Heading` that turns into an input on
  click/Enter, saved on blur or Enter via `updateWorkItemAction({ work_item_id, name })`);
  `PropertyRail` (a 320–384 px column behind a hairline on `page` once the detail is
  960 px wide, a `detail` container query; stacked under the title between hairlines
  on `modal`, a 760 px Dialog, and on `peek` with `compact`); `DescriptionEditor`; `SubItems`;
  `LinksList`; `ActivityFeed` (collapsed to the last 20 with "Show all"). Registers
  the entity label (D3's store) and the command context (D4's store, below) in one
  effect, both unregistered on unmount.
- `DetailHeader` `{ item, parent, host, onClose, onHostChange, onOpenItem, onCopyItem, onDelete }`:
  one 44px `PanelBar size="subheader"` (class `tessera-detail-header`), pinned
  while the detail scrolls. Start: Astryx `Breadcrumbs` + `BreadcrumbItem`
  (`dist/Breadcrumbs/*.d.ts`: `href`, `onClick`, `isCurrent`, `startIcon`) —
  project (logo, href `/projects/<id>/work-items`), "Work items" on the full
  page, parent key (onClick → `onOpenItem`), current key `isCurrent`. End, in
  this order: copy link (`IconButton`, `useClipboard({ announce: "Copied" })`,
  `dist/hooks/useClipboard.d.ts`: `copy`, `isCopied`; copies the full page
  URL); `MoreMenu` "More actions" (Make a copy when `onCopyItem`, `Copy ID (<KEY>)`,
  Delete… when `onDelete`); the "Open as" menu (`DropdownMenu` whose trigger
  shows the current mode's icon, a `DropdownMenuRadioGroup` of Side panel /
  Modal / Full page; a choice focuses the trigger before the host moves the
  detail, so focus comes back to it); Close "Close (Esc)" (peek and modal).
  Icons come from `src/themes/catppuccin/icons.tsx`, added there additively
  (`export const <Name>Icon = duotoneIcon(<Phosphor>);`, alphabetical).
- `PropertyRail` `{ item, currentActorId, compact }` — four Astryx `MetadataList`s
  (`dist/MetadataList/MetadataList.d.ts`: `columns`, `label: { position, width }`,
  `orientation`) split by hairlines: status (State, Priority, Labels), people
  (Assignees, Subscription), planning (Cycle, Modules, Parent, Estimate) and dates
  (Start, Target, Created, Updated). One column; each row is a 16px icon and muted
  label in a 120px label column (104 px in the peek) and the value. The rows hold the P2a controls from `@/components/work-items/properties`
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
- `ActivityFeed` `{ entries: ActivityLogEntry[] }`: a timeline, newest first. Each
  entry is a 28px icon tile for the kind of change (by verb: created, archived,
  restored, deleted, copied, moved; else by field; else a pencil) on a hairline
  that joins the tiles, then `actor_name`, verb and field in words ("changed state",
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
  `openCommandBar(initialQuery?: string)` to `ShellContextValue`, which the top bar's
  search field calls; a call while the palette is open does nothing).
- Opening: `useHotkeys([{ keys: "mod+k", onPress: () => open(), allowInInputs: true }, { keys: "mod+/", onPress: openHelp, allowInInputs: true }])`.
  `mod+/` is a shift-free combo, so `event.key` matching is layout-safe here.
- Search source (`src/components/shell/command-source.ts`, pure apart from `fetch`):
  implements `SearchSource` from `@astryxdesign/core/Typeahead`
  (`dist/Typeahead/types.d.ts` line 77: `search(q)`, `bootstrap()`, `cancel?()`);
  items are `SearchableItem` (`{ id, label, element?, auxiliaryData? }`, auto-grouped
  by `auxiliaryData.group`, line 26). `bootstrap()` and an empty `search("")` return
  the "Recent" group (the newest 5 recents not on screen, empty in the Ask tab)
  followed by the static commands for the current context; a non-empty `search(q)`
  leaves the recents out, aborts the previous request (`cancel()` holds an
  `AbortController`), waits 150 ms, fetches `/api/search` and merges the hits with
  the static commands whose label or keywords contain `q`. Selection: the palette
  closes and `onValueChange(value)` delivers the chosen item id (picker mode,
  `value`/`onValueChange` props); `CommandBar` keeps a `Map<id, () => void>` built
  with the items and runs the handler. Section order (group names): "Recent", "Work items",
  "Projects", "Cycles", "Modules", "Pages", "Actions", "Create", "Navigate", "Settings".
  Hit ids are `hit:<type>:<id>`; command ids are `CommandId`s: the `ShortcutId`s below plus the palette-only theme commands; the open-item command is `open:<workItemId>`; a recent route is `recent:<path>` (`auxiliaryData.kind === "recent"`, which pushes the path).
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
  (`shortcuts.ts`; it lived in `tab-registry.ts` until the layout rework) blocks everything except
  `palette.open` and `shortcuts.help`; `hasItem = useCommandContext() !== null`;
  item ids run the registered context action, `create.workItem` pushes
  `/projects/<current or last>/work-items?create=1` (what the Sidebar does today;
  `QuickCreate` from the P2a note does not exist yet), `nav.*` push routes,
  `peek.close` is left to `PeekHost`. `event.preventDefault()` only when something resolved.
- Help dialog (`mod+/` and the "Keyboard shortcuts" command): Astryx `Dialog`
  listing `SHORTCUTS` by group with `Kbd` (`dist/Kbd/Kbd.d.ts`: `keys` string such
  as `"mod+k"`) and the single-key switch.

### Lane split and file ownership

The lane split below is the P2b record. The layout rework (2026-10-11) since
replaced `TabBar.tsx` and `tab-registry.ts` with `recents.ts`,
`recents-store.ts` and `RecentsTracker.tsx` ("Shell" above); read those names
where the table says `TabBar.tsx` or `tab-registry.ts`.

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
   without the project tabs and its Recents entry (Home, Power K) reads `WEB-1 <title>`.
7. Drag the peek's handle → width changes within 360–720 px and survives reload;
   switch to modal from the "Open as" menu → survives reload.
8. Round trip: paste a description with a table, nested task list and a
   `[WEB-1](work:WEB-1)` link, reload → the editor shows the same content and the
   chip opens the item.

Gate: `npm run check` green (lint, conventions, licences, Vitest including
`tests/editor/*` under jsdom and `tests/ui/{shortcuts,peek-url,recents}.test.ts`),
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

## P3: cycles, modules, archives

Five lanes start on the same day and do not talk to each other: **A** engine
additions (progress schemas, cycle points and snapshot, `open_count`,
breakdowns, the archived-module guard, tool descriptions; no new tools) plus the
acceptance MCP client `scripts/mcp-call.ts` and the docs/PLAN.md corrections,
**E1** cycles and the burndown/burnup chart, **E2** modules, **E3** archives
(work items, cycles, modules, projects) with every archive and restore control,
**E4** integration (the scoped work items list, project tabs, sidebar, tab
labels, Power K, editor links). Every API named here was checked against the
installed packages on 2026-10-11 (file cited in brackets; Astryx declarations
under `node_modules/@astryxdesign/core/dist/<Name>/`). `recharts@3.10.1` and
`react-is@19.3.0` (exact) were installed in the P3 prep commit, together with the
icon patch and the three empty stylesheets with their `@import` lines (see "Icons,
CSS and conventions"); E1 re-checks the Recharts props named here against
`node_modules/recharts/types/` before writing the chart. Mismatches with
docs/PLAN.md and the code are collected at the end.

### Carried items (not P3 work)

- List titles, the Home "Projects" heading, the handbook search dialog's
  accessible name and the old handbook tabs' button inside a button were fixed
  in `2c96000`; nothing to do.
- `npm run astryx -- doctor` now reports two warnings, the theme-fonts check and
  the themes summary that repeats it (the agent-instructions warning is gone;
  re-run 2026-10-11: pass 18, warn 2, fail 0).
  Fonts load through `next/font`, as AGENTS.md records; accepted until Astryx
  recognises `next/font`.
- Astryx 0.6.8 `ContextMenu` prop warnings in development: an upstream fix; P3
  adds no `ContextMenu`. React's occasional "negative time stamp" performance
  error in development: known React issue, noted since P2a, not in production.
  These two are the only dev-console entries the P3 acceptance tolerates.

### Scope and deferrals

Ships in P3: cycles list (sections Current, Upcoming, Completed, Draft) with the
active cycle summary card; create and edit dialog; cycle detail with the scoped
work items list and a side panel (progress, burndown/burnup, breakdowns by
assignee, label and state); transfer of open items (to a cycle or to no cycle);
archive, restore and delete of cycles; modules list and detail (status, lead,
members, dates, links, progress, breakdowns); "Add existing work items" for
cycles and modules; project archives (work items, cycles, modules) and archived
projects, each with restore and delete; archive and restore of a work item from
its detail; Cycles, Modules and Archives tabs in the project panel header, recent
labels, Power K targets and `cycle:` / `module:` editor links. (P3 shipped
per-project sidebar entries and tab-bar labels; the layout rework merge replaced
them with flat sidebar rows and recents, see "As built (layout rework merge,
2026-10-11)".)

| Deferred | Phase | Note |
|---|---|---|
| Module gallery and timeline layouts | P10 (timeline with gantt), P9 (gallery) | P3 modules list is a `List` |
| Module burndown chart | P9 | The panel shows counts and breakdowns only |
| Favourites of cycles and modules (`mod+f`) | P9 | No star button in P3 |
| `/active-cycles` workspace page | P9 | Engine `getActiveCycles` already exists |
| Cycle and module reorder UI | P9 (with favourites) | `reorder_cycle` / `reorder_module` stay MCP-only |
| Entity activity feeds for cycles and modules | P5 (digests) | Rows are logged already |
| `view_settings` and saved-filter cleanup when a cycle or module is deleted | P4 | Stale rows are ignored by the engine |
| Feature toggle settings UI | P4 | P3 reads `cycles_enabled` / `modules_enabled` and hides UI; MCP `update_project_features` changes them |
| Estimates UI; points mode in practice | P8 | P3 ships the points switch, shown only with an active estimate |
| Search hits marked as archived | P9 | `searchAll` excludes archived entities by default |
| Read-only UI for archived projects | P4 | P3 shows a Banner; the engine refuses writes (`ARCHIVED`, Toast) |
| Burnup scope over time (a per-day scope series from each item's join day) | P9 analytics | P3 draws the current scope (`total − cancelled`) as a flat line, so items added mid-cycle do not show as a scope step; the engine has no scope series (tools.md `get_cycle_progress` says so) |
| Filters, display options and layouts on Archives › Work items | P4 (views) | P3 shows a plain `List` ordered by last update; the `archived` view_settings scope stays unused |
| Search, sort and filter on the cycles and modules lists | P4 (views) | Engine order (`sort_order`, then creation) |
| "Copy link" in the cycle and module menus | P9 (with favourites) | The URL bar carries the link |
| Module shortcuts `s` (status) and `m` (members) | P9 | The side panel's inline controls only |
| Activity row per detached item when a module is deleted | P5 (entity feeds) | `deleteModule` logs only the module row; `deleteCycle` already logs one per item |
| Row action "Remove from cycle" / "Remove from module" in the scoped list | P8 (bulk bar) | An item leaves through its Cycle or Modules property (peek or full page); P3 adds no `remove_work_items_from_*` wrapper |
| Manual start/stop and parallel cycles | never | Decision 16: dates decide the status, no overlap |

### Routes and data loading

| Route | File (lane) | Reads in one `readTessera` |
|---|---|---|
| `/projects/[projectId]/cycles` | `src/app/(tessera)/projects/[projectId]/cycles/page.tsx` (E1) | `getProject`, `listCycles(ctx, projectId, {})`; for the current cycle `getCycle` and, with an active estimate, `getCycleProgress(ctx, id, { mode: "points" })`; `ctx.today()` |
| `/projects/[projectId]/cycles/[cycleId]` | `.../cycles/[cycleId]/page.tsx` (E1) | `getProject`, `getCycle`, points progress as above, candidates (below), `ctx.today()`; then `<ScopedWorkItems>` (E4) |
| `/projects/[projectId]/modules` | `.../modules/page.tsx` (E2) | `getProject`, `listModules(ctx, projectId, {})`, `ctx.today()` |
| `/projects/[projectId]/modules/[moduleId]` | `.../modules/[moduleId]/page.tsx` (E2) | `getProject`, `getModule`, candidates, `ctx.today()`; then `<ScopedWorkItems>` |
| `/projects/[projectId]/archives` | `.../archives/page.tsx` (E3) | none: after `await params` it redirects to `/projects/<projectId>/archives/work-items` |
| (layout) | `.../archives/layout.tsx` (E3) | none: renders `<ArchivesTabs projectId>` above `children` |
| `/projects/[projectId]/archives/work-items` | `.../archives/work-items/page.tsx` (E3) | `listWorkItems(ctx, { scope: { type: "archived", project_id }, display: { order_by: "-updated_at" }, limit: 2000 })`, the peek through `loadPeek` (E4) |
| `/projects/[projectId]/archives/cycles` | `.../archives/cycles/page.tsx` (E3) | `getProject`, `listCycles(ctx, projectId, { archived: true })` |
| `/projects/[projectId]/archives/modules` | `.../archives/modules/page.tsx` (E3) | `getProject`, `listModules(ctx, projectId, { archived: true })` |
| `/projects/archives` | `src/app/(tessera)/projects/archives/page.tsx` (E3) | `listProjects(ctx, { archived: true })` |
| `/cycles/[cycleId]`, `/modules/[moduleId]` | `src/app/(tessera)/{cycles/[cycleId],modules/[moduleId]}/page.tsx` (E4) | `getCycle` / `getModule` → `redirect` to the project route |

- Pattern for every page (copy of `/browse/[key]` and the P2b detail page): sync
  default export → `<Suspense fallback={<…Skeleton />}>` → async child that awaits
  `params` (and `searchParams` where used), `await io()` (`04-functions/io.md`:
  "call `await io()` before reading … a synchronous database driver"), validates
  ids with `IdSchema.safeParse` (from `@/lib/tessera/schemas`) and calls `notFound()`
  for a malformed id, then one `readTessera` in a `try`; `NOT_FOUND` / `VALIDATION`
  → `notFound()`; an entity whose `project_id !== projectId` → `notFound()`.
  `redirect()` stays outside the `try` (`04-functions/redirect.md`). The project
  layout's `export const instant = false` opts out only navigations *into* the
  project segment; navigations between sibling segments under it (work items →
  cycles → a cycle → archives) are still validated ("Opting out" in
  `01-app/02-guides/instant-navigation.md`: "Navigations between sibling segments
  below are still validated"). So every new P3 page (each route in the table,
  `/projects/archives` and the two alias routes included) adds
  `export const instant = false` to its own `page.tsx` when the dev validator reports
  an insight for it (typically the `notFound()` or `redirect()` path), and the lane
  names it in the hand-off. Acceptance step 15 walks the sibling navigations.
- `/projects/archives` is a static segment next to `[projectId]`, so Next routes it
  to its own page and the project layout does not wrap it. Three path parsers treat
  `archives` as a project id today (`Sidebar.tsx`, `useShortcuts.ts`, `CommandBar.tsx`;
  mismatch 12); E4 replaces them with one guarded function, which lives in
  `recents.ts` since the layout rework merge (`projectIdFromPath`).
- Feature off (`project.cycles_enabled` / `modules_enabled`, read with `getProject`
  in the same `readTessera`): the list and detail routes of that feature
  (`/cycles`, `/cycles/[cycleId]`, `/modules`, `/modules/[moduleId]`) and its
  archive route (`/archives/cycles`, `/archives/modules`) render
  `<FeatureOffState feature="cycles" | "modules" />` (E1) instead of the screen and
  skip the other reads; `ArchivesTabs` leaves out the Cycles or Modules tab; the
  alias routes `/cycles/[cycleId]` and `/modules/[moduleId]` still redirect (the
  target then shows the state). `FeatureOffState` is an Astryx `EmptyState`
  (`dist/EmptyState/EmptyState.d.ts`: `title`, `description`, `icon`, `actions`,
  `isCompact`) titled "Cycles are turned off for this project" (or "Modules …"),
  description "Project settings arrive in P4; an agent can turn them on with
  update_project_features." No action button.
- `?create=1` on `/cycles` and `/modules` opens the create dialog once and is then
  dropped with `router.replace` (the `WorkItemsScreen` `createOnOpen` handling). It
  is what `n c` / `n m` push.
- Candidates for "Add existing work items" are loaded with the detail, not searched:
  `listWorkItems(ctx, { scope: { type: "project", project_id }, filters, display: { order_by: "-updated_at" }, limit: 500 })`
  mapped to `ItemCandidate` (below). Cycles pass `filters: { state_group: ["backlog", "unstarted", "started"] }`
  (the engine refuses closed items, `RULE work_item_closed`) and the client drops
  members, items in a completed cycle (`bundle.cycles` status) and items in a cycle
  missing from the bundle (archived); modules pass no filter and drop members.
  Skipped for completed or archived cycles and archived modules.
- `today` (`ctx.today()`, server local date, decision 6) travels as a prop so
  "days left", the chart's today marker and the pace line render the same on the
  server and the client.
- Recent labels (E4; `recents.resolveRoute` since the layout rework merge, which
  replaced the tab bar's `tab-registry.ts`): `/projects/<p>/cycles` → "<project> ·
  Cycles", `/projects/<p>/cycles/<c>` → "<project> · <cycle name>" (else "Cycle"),
  `/projects/<p>/modules(/<m>)` likewise with "Modules" / "Module",
  `/projects/<p>/archives/<tab>` → "<project> · Archived work items", "· Archived
  cycles" or "· Archived modules" (one label per tab since the layout rework merge,
  so three archives recents never read as one repeated entry; any other path under
  it → "<project> · Archives"), `/projects/archives` → "Archived projects". These labels show on Home's "Recent" list and in Power K's
  "Recent" group. Never recorded (`isTransientPath`): `/cycles/<id>` and
  `/modules/<id>` (aliases that redirect, like `/browse/`), the project index
  `/projects/<p>` and the archives index `/projects/<p>/archives`, which redirect
  too. Detail screens call `registerEntityLabel(id, name)`
  (`src/components/shell/entity-labels.ts`) in an effect.

### Lane A: engine additions

No new tools, no new activity verbs, no migration (`progress_snapshot` is JSON
and the schema only widens). Signatures and rules are appended to
`docs/contracts/service-api.md` ("P3 additions") and `docs/contracts/tools.md`
("P3 changes"). Summary:

1. `schemas.ts`: `PointsCountsSchema` (the `ProgressCounts` keys as
   `z.number().nonnegative()`, since estimate values may be fractional),
   `ProgressModeSchema = z.enum(["issues", "points"])` (`CycleProgressModeSchema` stays
   as an alias), `ProgressBreakdownRowSchema = z.object({ id: IdSchema.nullable(), total: int ≥ 0, completed: int ≥ 0 })`.
   `CycleProgressSchema` changes `points` to `PointsCountsSchema.optional()` and
   `completion_chart` values to `z.number().nonnegative()`, and adds optional
   `assignees`, `labels` (breakdown rows), `chart_mode` (`ProgressModeSchema`) and
   `completion_chart_points` (written into snapshots only; never part of a returned
   `CycleProgress`, but visible inside the raw `progress_snapshot` field, because
   `Cycle` and `CycleDetail` spread the whole `CycleRow` in `toCycles` /
   `toCycleDetail`, so `list_cycles`, `get_cycle` and the project bundle carry it).
   Types `PointsCounts`, `ProgressBreakdownRow`, `ProgressMode` in `types.ts`.
2. Cycle points follow the project's active estimate (`estimates_enabled` and
   `estimate_id`), count only non-deleted points of that estimate with a numeric
   value ≥ 0, and are absent otherwise (module progress already behaves this way).
   `computeProgress` builds the items series and, with an active estimate, the
   points series; `freezeSnapshot` stores both; `forMode` returns the requested
   series with `chart_mode`, falling back to the items series (`chart_mode: "issues"`)
   when no points series exists (pre-P3 snapshots, no estimate).
3. `Cycle` and `CycleDetail` gain `open_count: number`: live count of non-deleted
   members whose state group is neither completed nor cancelled, archived and triage
   members included, so it equals what `transferCycleWorkItems` would move.
4. Archived-module guard: `syncModules` (`set_modules`, `move_work_item` grouped by
   module) and `createWorkItem` refuse with `ARCHIVED` when a module being added or
   removed is archived; memberships of archived modules the call does not change are kept.
5. Breakdowns: `CycleProgress` and `ModuleProgress` gain `assignees` and `labels`
   rows (`completed` = completed group); `ModuleProgress` also gains `by_label` and
   `by_assignee`.
6. `modules.ts` `logMembership` writes the item-side row with `field: "modules"`
   (the name `work-items.ts` uses), so one activity label covers both paths.
7. Tool descriptions: `get_cycle_progress` (drop "the ideal line"; say there is no
   scope series), `get_module_progress` (drop "the completion percentage"),
   `list_cycles` and `get_cycle` (mention `open_count`), `unarchive_cycle` (name the
   `CONFLICT` on overlapping dates and the kept snapshot). Exact text in tools.md.
8. Tests: `tests/cycles.test.ts` (points gating, fractional and negative values,
   both series frozen and served by mode, pre-P3 snapshot fallback, breakdown rows
   with `id: null`, `open_count` equals `moved`; update the fixtures at lines
   723–780 to enable the estimate on the project, and the expectations at 434–440,
   648 and 821–822), `tests/modules.test.ts` (breakdowns; `field: "modules"` at
   lines 489 and 536), `tests/work-items.test.ts` (archived-module guard on create,
   `set_modules` add and remove, kept membership). Lane A merges first; the UI lanes
   rebase onto it before using the new fields and never edit `schemas.ts` / `types.ts`.
9. Acceptance MCP client `scripts/mcp-call.ts` (lane A owns `scripts/**`), run as
   `npx tsx scripts/mcp-call.ts <tool> ['<json arguments>']`, for example
   `npx tsx scripts/mcp-call.ts get_work_item_by_key '{"key":"P3A-3"}'`:
   - `<tool>` is the registry name; the script prefixes it with `mcpToolName`
     (`@/lib/tessera/tools/mcp`). Arguments default to `{}`; destructive tools need
     `"confirm": true` in the JSON, as for any MCP client.
   - It connects a `Client` from `@modelcontextprotocol/client` (2.3.1, already a dev
     dependency) named `p3-acceptance` through `StdioClientTransport`
     (`@modelcontextprotocol/client/stdio`) to `command: "npx"`,
     `args: ["tsx", "scripts/mcp-stdio.ts"]`, `cwd` the repo root, `stderr: "pipe"`,
     and an environment from `getDefaultEnvironment()` (a whitelist) with the
     directory of `process.execPath` prepended to `PATH` (Node-API 10 for
     better-sqlite3) and `TESSERA_DB_PATH` copied over when the calling shell sets it. This is
     the spawn form `.mcp.json` and `tests/mcp-stdio.test.ts` use. No `--db` and no
     `--migrate`: the stdio server resolves the database exactly as the dev server
     does (`TESSERA_DB_PATH` from `.env.local`, else `data/tessera.db`) and refuses
     pending migrations (exit 2) instead of migrating a database the dev server owns.
   - Output: the stdio server's stderr (it names the absolute database path) is
     copied to the script's stderr; `structuredContent` (else the first text
     content) is printed to stdout as JSON; exit code 1 when the result `isError`,
     2 when the connection fails. The actor is `mcp:p3-acceptance` (kind `agent`),
     so `ChangesPoller` refreshes open tabs.
   - No test: it is a verification tool. `npm run typecheck` covers it.
10. docs/PLAN.md corrections (lane A, which owns `docs/contracts/**`; no other lane
    owns the plan):
    §11 step 2 and §9 (Recharts and `react-is` are added in P3 with the burndown, P9
    reuses them for analytics), §5 (the alias routes `/cycles/[cycleId]` and
    `/modules/[moduleId]`, and `/projects/archives` owned by lane E), §6 and §13
    (project Archives is a frame tab plus `g r` and a link on `/projects` until the P9
    sidebar pass adds the project `…` menu; listed under deviations).

Burnup and the ideal line are derived in the client from `completion_chart`
(pending per day), the dates and the scope; the engine does not store them. There
is no scope series: the burnup draws today's scope as a flat line (deferral table).

### Shared planning pieces (E1 creates, E2 and E3 import)

`src/components/planning/types.ts` (client-safe imports from `@/lib/tessera/types` only):

```ts
import type { CycleDetail, CycleProgress, ModuleDetail, WorkItem } from "@/lib/tessera/types";

/** A row of the "Add existing work items" dialog, mapped server-side from listWorkItems. */
export type ItemCandidate = Pick<WorkItem, "id" | "key" | "name" | "state_id" | "cycle_id">;

export type CycleDetailData = {
  cycle: CycleDetail;                  // getCycle: status, open_count, progress (issues mode)
  pointsProgress: CycleProgress | null; // getCycleProgress(points) when the project has an active estimate, else null
  candidates: ItemCandidate[];         // [] for completed or archived cycles
  today: string;                       // ctx.today()
};

export type ModuleDetailData = { module: ModuleDetail; candidates: ItemCandidate[]; today: string };

export type ProgressTarget = { type: "cycle"; cycle_id: string } | { type: "module"; module_id: string };
```

- `ProgressPanel` (`src/components/planning/ProgressPanel.tsx`, `"use client"`):
  ```ts
  export type ProgressPanelProps = {
    title: string;                        // "Progress"
    counts: ProgressCounts;               // items: drives the top bar and the five state-group rows
    points?: PointsCounts;                // second line "12 of 20 points" when present
    byState: Record<string, number>;      // States tab: one row per state id, count only
    assignees?: ProgressBreakdownRow[];   // absent on snapshots frozen before P3
    labels?: ProgressBreakdownRow[];
    byAssignee: Record<string, number>;   // fallback rows (totals only) when assignees is absent
    byLabel: Record<string, number>;
    includesArchived?: boolean;           // cycles: true → caption "Includes archived work items."
    isFrozen?: boolean;                   // cycles: cycle.progress_snapshot !== null → caption "Frozen when the open items moved or the cycle was archived."
    chart?: ReactNode;                    // cycles pass <BurndownChart/>; modules pass nothing (chart in P9)
  };
  ```
  Top: Astryx `ProgressBar` (`dist/ProgressBar/ProgressBar.d.ts`: `label` required,
  `value`, `max`, `hasValueLabel` (default false; the formatter renders only when it
  is true), `formatValueLabel`, `variant` accent | success | warning | neutral |
  error) with `label="Completed"`, `value={completed}`, `max={total - cancelled}`,
  `variant="success"`, `hasValueLabel`, `formatValueLabel` → "3 of 8"; `max` 0
  renders the text "No work items" instead of the bar. Then the five state groups
  from `counts` (backlog, unstarted, started, completed, cancelled) as rows
  (`StatusDot` with the decision 22 variant via `stateGroupVariant` from
  `@/components/work-items/properties`, group label, count), then `chart`, then
  `<BreakdownTabs>`, then the captions as `Text type="supporting"`. A cycle counts as
  frozen exactly when `cycle.progress_snapshot !== null` (lane A item 1: the raw
  snapshot reaches the client); the frozen caption shows only then, and the
  archived-items caption always shows for cycles (mismatch 22).
- `BreakdownTabs` (`BreakdownTabs.tsx`): the WAI-ARIA tabs pattern, because the tabs
  swap a panel in place: `<TabList role="tablist" value onChange size="sm" layout="hug">`
  (`dist/TabList/TabList.d.ts`: `value` and `onChange` required; `role="tablist"`
  gives `role="tab"` + `aria-selected` and wires `panelId` as `aria-controls`; without
  it the strip is a `<nav>` and `Tab.js` warns in development that `panelId` does
  nothing). Each `Tab` gets `value`, `label`, `id={`${base}-tab-${key}`}` and
  `panelId={`${base}-panel-${key}`}` (`dist/TabList/Tab.d.ts`; other props spread onto
  the element), `base` from `useId()` so two panels on one page never collide; no
  `href`. Tabs Assignees, Labels, States; the open panel renders as
  `<VStack id={`${base}-panel-${key}`} role="tabpanel" aria-labelledby={`${base}-tab-${key}`}>`
  (`VStack` props extend `BaseProps`, which extends `React.HTMLAttributes`,
  `dist/BaseProps.d.ts`). Rows are an Astryx `List density="compact"` of `ListItem`
  (`dist/List/ListItem.d.ts`: `label` ReactNode, `startContent`, `endContent`):
  - Assignees (from `assignees`): `Avatar name size="sm"` + name (`ActorLabel`),
    `id: null` → "No assignee"; Labels (from `labels`): `Token label
    color={paletteTokenColor(label.color)} size="sm"`, `id: null` → "No label". Their
    `endContent` is a 64px `ProgressBar isLabelHidden label="<name> completed"
    variant="success" value={completed} max={total}` plus the text "2/5". When
    `assignees` / `labels` are absent (pre-P3 snapshot), the rows come from
    `byAssignee` / `byLabel` with the count only and no bar.
  - States (from `byState`): `StatusDot` (group variant) + state name and the count
    as text. No `ProgressBar`: a state's items are all completed or none are, so a bar
    would only repeat the group.
  Rows keep the engine order (States follow `bundle.states` order); a deleted actor,
  label or state shows "Removed".
- `AddExistingItemsDialog` (`AddExistingItemsDialog.tsx`):
  ```ts
  export type AddExistingItemsDialogProps = {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;                          // "Add work items to Sprint 1"
    target: ProgressTarget;
    candidates: ItemCandidate[];
    onAdd: (ids: string[]) => Promise<boolean>; // the screen calls addWorkItemsTo{Cycle,Module}Action; true closes
  };
  ```
  Astryx `Dialog purpose="form" width={560} maxHeight="80dvh"` with the house
  layout (`Layout` header / content / footer as in
  `src/components/projects/CreateProjectDialog.tsx`; Astryx has no `DialogFooter`):
  `DialogHeader title hasDivider`, a `TextInput` "Filter" (client-side match on key
  or name, case-insensitive), a `List` of candidates, footer "Cancel" + primary "Add
  N work items" (disabled at 0, `isLoading` while pending). At most 500 rows; an
  empty list shows `EmptyState isCompact title="Nothing to add"`. Each row is a small
  `CandidateRow` component owning `const rowRef = useRef<HTMLInputElement>(null)`:
  `<ListItem label={<>{key} {name}</>} interactiveRef={rowRef} startContent={<CheckboxInput label={`${key} ${name}`} isLabelHidden value={selected} onChange={(checked) => toggle(id, checked)} ref={rowRef} />} />`
  (`dist/CheckboxInput/CheckboxInput.d.ts`: `label: string` and `value: boolean |
  "indeterminate"` required, `isLabelHidden`, `onChange(checked, event)`,
  `ref?: React.Ref<HTMLInputElement>`; `ListItem.d.ts` `interactiveRef`: the row
  delegates clicks to the checkbox and adds no second tab stop). `isLabelHidden`
  keeps the label for assistive technology without printing it twice.
- `FeatureOffState` (`FeatureOffState.tsx`): the EmptyState described under routes.
- `panel-prefs.ts`: `localStorage` key `tessera.planningPanel.v1` =
  `{ "open": boolean, "chart": "burndown" | "burnup", "unit": "issues" | "points" }`,
  read through `useSyncExternalStore` with server snapshot
  `{ open: true, chart: "burndown", unit: "issues" }` (the `peek-prefs.ts` pattern),
  writes wrapped in `try`. Shared by cycles and modules (modules use `open` only).
  The unit in use is `effectiveUnit(prefs.unit, pointsProgress !== null)` from
  `burndown.ts`: `"issues"` whenever the cycle has no points progress; the stored
  `"points"` is kept, not applied, and applies again on a cycle that has points.

### Cycles (E1): `src/components/planning/`

- `CyclesScreen` (`"use client"`):
  ```ts
  export type CyclesScreenProps = {
    projectId: string;
    cycles: Cycle[];                 // non-archived, engine order
    active: CycleDetailData | null;  // the current cycle with full progress, candidates []
    today: string;
    createOnOpen: boolean;
  };
  ```
  Header row: `Heading level={2}` "Cycles" (the frame holds the `h1`) and a primary
  `Button size="sm" label="New cycle" icon={<PlusIcon />}`. Then
  `<ActiveCycleSummary data={active} />` when a cycle is current. Then one Astryx
  `List` per non-empty section in the order Current, Upcoming, Completed, Draft
  (`List.d.ts` `header`, `hasDividers`), grouped by `groupCycles(cycles)`
  (`cycle-format.ts`). No cycles at all → `EmptyState` "No cycles yet" with the New
  cycle button in `actions`.
- `CycleRow`: ``ListItem href={`/projects/${projectId}/cycles/${id}`}`` (`ListItem.d.ts`:
  `href` renders an invisible anchor, so the menu in `endContent` is a sibling, not
  nested). `startContent` = `StatusDot variant label` (current accent, upcoming
  neutral, completed success, draft neutral; label = status label), `label` = name,
  `description` = `formatCycleRange(start, end)` plus, when current, `daysLeftLabel`.
  `endContent` = "3/8" + `ProgressBar isLabelHidden label="<name> progress"` (96px),
  an "N open" `Badge` when completed with `open_count > 0`, and `<CycleMenu>`.
- `CycleMenu`: Astryx `MoreMenu` (`dist/MoreMenu/`: `items`, `label`, `size`) with
  `DropdownMenuItemData` (`dist/DropdownMenu/DropdownMenu.d.ts`: `id`, `label`, `icon`,
  `onClick`, `isDisabled`, `description`, `variant: "default" | "destructive"`)
  from `cycleActions(cycle, today)` (`cycle-format.ts`, pure):
  Edit… (not completed, not archived), Transfer open items… (completed, not archived,
  `open_count > 0`), Archive (enabled only when completed; otherwise disabled with
  description "Cycles can be archived after their end date"), Restore (archived),
  Delete… (destructive; disabled on a completed, non-archived cycle with
  description "Archive it first"; the engine answers `LOCKED`). Delete confirms with
  `AlertDialog` (`dist/AlertDialog/`: `title`, `description`, `actionLabel`,
  `actionVariant="destructive"`, `onAction`, `isActionLoading`): "Delete Sprint 1? Its
  work items stay and leave the cycle."
- `ActiveCycleSummary`: Astryx `Card` (`dist/Card/`: `padding`, `variant`) with
  `Heading level={3}` name + `Token label="Current"`, the range with `CalendarDotsIcon`,
  `daysLeftLabel` with `TimerIcon`, the same top `ProgressBar` as `ProgressPanel`
  (`hasValueLabel`, "3 of 8"), the counts by group, and a
  compact `<BurndownChart height={160} hasDataTable={false} …/>`; an "Open cycle"
  `Link` (`dist/Link/`). The chart keeps its text summary even when compact.
- `CycleDialog` (create and edit):
  ```ts
  export type CycleDialogProps = {
    projectId: string;
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    cycle?: Cycle;                    // edit when set
  };
  ```
  The other cycles come from `useProject().bundle.cycles` (non-archived, with
  `status` and, after lane A, `open_count`), the same source on the list page, the
  detail header and the summary card: `otherCycles = overlapCandidates(bundle.cycles, cycle?.id ?? null)`
  (`cycle-format.ts`: every bundle cycle except the edited one).
  `Dialog purpose="form" width={520}`; fields `TextInput` "Name" (required, ≤ 120),
  `TextArea` "Description" (plain Markdown, optional), `DateRangeInput` "Dates"
  (`dist/DateRangeInput/DateRangeInput.d.ts`: `value: DateRange | null`, `onChange`,
  `hasClear`, `dateConstraints: ReadonlyArray<(date: Date) => boolean>` where a
  `false` disables the day, `status: { type, message }`, `numberOfMonths`;
  `DateRange` = `{ start, end }` of ISO dates, `dist/utils/dateTypes.d.ts`). The
  constraint disables days inside `otherCycles` ranges (convert the `Date` with its
  local getters, never `toISOString`). No dates = draft, and the helper text says so.
  Submit → `createCycleAction({ project_id, name, description_md, start_date, end_date })`
  or `updateCycleAction({ cycle_id, … })` with only changed fields. `CONFLICT` and
  `VALIDATION` render as the date field's `status` error, other errors as a Toast.
- `CycleDetailScreen` (`"use client"`) wraps the scoped list it receives as
  `children` (a Server Component passed into a Client Component,
  `01-app/01-getting-started/05-server-and-client-components.md`, interleaving):
  ```ts
  export type CycleDetailScreenProps = { projectId: string; data: CycleDetailData; children: ReactNode };
  ```
  `<Layout height="fill" header={<CycleHeader …/>} content={<LayoutContent padding={0} isScrollable>{children}</LayoutContent>} end={panelOpen && !peekOpen ? <CycleSidePanel …/> : undefined} />`
  (`dist/Layout/Layout.d.ts` slots). `peekOpen = peekIdOf(useSearchParams()) !== null`
  (`src/components/detail/peek-url.ts`): the peek's own panel replaces the progress
  panel while an item is open. Registers `registerEntityLabel(cycle.id, cycle.name)`.
- `CycleHeader`: name (`Heading level={2}`), status `Token`, range, days left,
  buttons "Add existing" (open cycles only; opens `AddExistingItemsDialog`), a
  `IconButton` toggling the panel (`label="Show progress"` / `"Hide progress"`,
  `BurndownIcon`), `<CycleMenu>`. Completed: a `Text` line "Completed cycles are
  read-only. Transfer the open items to keep working on them." Archived: Astryx
  `Banner status="info" title="This cycle is archived"` with a Restore `Button` in
  `endContent` (`dist/Banner/Banner.d.ts`: no `actions` prop).
- `CycleSidePanel`: `LayoutPanel width={360} hasDivider padding={4} isScrollable label="Cycle progress" role="complementary"`
  (`dist/Layout/LayoutPanel.d.ts`) containing `ProgressPanel` with the chart block:
  a `SegmentedControl size="sm" label="Chart"` (`dist/SegmentedControl/`: `value`,
  `onChange`, `label`; items `value`, `label`, `icon`) Burndown / Burnup with
  `BurndownIcon` / `BurnupIcon`, and, only when `pointsProgress !== null`, a second
  `SegmentedControl label="Unit"` with items labelled "Work items" (value `issues`,
  the engine's mode name) and "Points" (value `points`). Visible text never says
  "issues": summaries read "5 of 8 work items pending". Choices persist in
  `panel-prefs`; the unit in use is `effectiveUnit` (above). `ProgressPanel` gets
  `includesArchived` and `isFrozen={cycle.progress_snapshot !== null}`.
- `TransferDialog`:
  ```ts
  export type TransferDialogProps = {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    cycle: Cycle;            // completed, not archived; N = cycle.open_count
  };
  ```
  Targets come from `useProject().bundle.cycles`:
  `transferTargets(bundle.cycles, cycle.id)` (`cycle-format.ts`: status current,
  upcoming or draft, the source excluded; the bundle holds no archived cycles).
  `Dialog purpose="form" width={480}`; text "Move the N open work items of Sprint 1.
  Its progress is frozen as it is now." (`cycle-format.transferText`); when
  `cycle.progress_snapshot !== null` (frozen earlier, for example archived and then
  restored; the engine never replaces a snapshot) the second sentence reads "Its
  progress was frozen earlier and stays as it was then."; Astryx `Selector label="Move to"`
  (`dist/Selector/Selector.d.ts`) with targets (status in the option description)
  plus "No cycle" (value `__none__`, the `DisplayMenu` NONE pattern); footer primary
  "Transfer N work items". → `transferCycleWorkItemsAction({ cycle_id, to_cycle_id })`;
  Toast "Moved N work items to Sprint 2" (or "out of the cycle").
- Server Actions `src/app/actions/cycles.ts` (`"use server"`, `toolAction` from `./_run`):
  `createCycleAction`, `updateCycleAction`, `archiveCycleAction`,
  `unarchiveCycleAction`, `deleteCycleAction`, `addWorkItemsToCycleAction`,
  `transferCycleWorkItemsAction` (tools `create_cycle`, `update_cycle`,
  `archive_cycle`, `unarchive_cycle`, `delete_cycle`, `add_work_items_to_cycle`,
  `transfer_cycle_work_items`; inputs per tools.md: `{ cycle_id, … }`,
  `{ cycle_id, work_item_ids }`, `{ cycle_id, to_cycle_id }`). No wrapper for
  `remove_work_items_from_cycle`: nothing in P3 calls it (deferral table).
- `cycle-format.ts` (pure, no directive, `tests/ui/cycle-format.test.ts`):
  `CYCLE_STATUS_LABEL`, `cycleStatusVariant(status)`, `groupCycles(cycles)` →
  `{ key, label, cycles }[]` in section order without empty sections,
  `formatCycleRange(start, end)` ("Mar 1 – Mar 14", "No dates") through
  `formatShortDate` imported from `@/components/work-items/properties/date-format`
  (directive-free, created by E4, mismatch 27; never from the `"use client"`
  `DateControl.tsx`), `daysLeftLabel(end, today)` ("Ends today", "1 day left", "N
  days left") with `daysBetween` from `@/lib/tessera/core/time`,
  `cycleActions(cycle, today)`, `overlapCandidates(cycles, exceptId)`,
  `transferTargets(cycles, sourceId)`. Server Components may call these helpers.

### Burndown and burnup chart (E1)

- Library: `recharts@3.10.1` (MIT) plus `react-is@19.3.0` (MIT) as exact direct
  dependencies (mismatches 1 and 10). After install run `npm run check:licenses`
  (Recharts' tree is MIT and ISC, both allowed by `scripts/check-licenses.ts`).
  Recharts ships no `"use client"` banner, so only files marked `"use client"`
  import it; `BurndownChart.tsx` starts with `"use client"` and is imported by client
  components only.
- `burndown.ts` (pure, no React, `tests/ui/burndown.test.ts`):
  ```ts
  export type ChartKind = "burndown" | "burnup";
  export type ChartRow = { date: string; actual: number | null; ideal: number };
  export type ChartEmpty = "draft" | "upcoming" | "no_items";
  export type ChartModel = {
    kind: ChartKind;
    unit: ProgressMode;            // progress.chart_mode ?? "issues", never the requested unit blindly
    rows: ChartRow[];              // every day start_date..end_date inclusive
    scope: number;                 // total − cancelled in the unit (points.* in points)
    today: string | null;          // today when start_date ≤ today ≤ end_date, else null
    current: { actual: number; ideal: number } | null;  // at min(today, end_date)
    pace: { status: "on_track" | "ahead" | "behind"; delta: number } | null;
    empty: ChartEmpty | null;
  };
  export function buildChartModel(input: { start_date: string | null; end_date: string | null; status: CycleStatus; today: string; progress: CycleProgress; kind: ChartKind }): ChartModel;
  export function idealSeries(scope: number, days: number): number[];
  export function paceOf(actualPending: number, idealPending: number, scope: number): ChartModel["pace"];
  export function summarizeChart(model: ChartModel): string;
  export function formatAmount(value: number, unit: ProgressMode): string;   // "1 work item", "3 work items", "4.5 points" (one decimal at most)
  export function effectiveUnit(preferred: ProgressMode, hasPoints: boolean): ProgressMode;  // "issues" unless hasPoints
  ```
  Burndown `actual` = `completion_chart[date]` (pending), `null` for days after
  `min(today, end_date)` so the line stops; burnup `actual` = `scope − pending`, and
  the scope line is flat at today's `scope` for the whole range (a known
  simplification: the engine has no per-day scope series, deferral table → P9). On
  a frozen cycle `scope` comes from the snapshot, so it is flat at the frozen scope.
  Ideal burndown: `scope × (n − 1 − i) / (n − 1)` for day `i` of `n` days, one day
  → `[0]`; burnup ideal is `scope − ideal`. Pace compares pending at
  `min(today, end_date)` with the ideal there: on track when
  `|delta| ≤ max(1, 5% of scope)`, behind when pending is higher, ahead when lower.
  `empty`: no dates → `"draft"`, status upcoming → `"upcoming"`, `scope === 0` → `"no_items"`.
- `chart-colors.ts`: token names only, never hex (the `hex-colour` convention rule):
  ```ts
  export const CHART_TOKENS = {
    actual: "--color-data-categorical-blue",
    ideal: "--color-text-secondary",
    scope: "--color-data-categorical-purple",
    today: "--color-border-emphasized",
    grid: "--color-border",
    axis: "--color-text-secondary",
    tooltipSurface: "--color-background-popover",
    tooltipText: "--color-text-primary",
  } as const;
  export function useChartColors(): Record<keyof typeof CHART_TOKENS, string>;
  ```
  `useChartColors` reads `useTheme().tokens` (`@astryxdesign/core/theme`,
  `dist/theme/useTheme.d.ts`: "raw CSS values … suitable for … data visualization
  libraries", resolved for the active mode and memoized per theme and mode) and maps
  the names in a `useMemo`. Recharts writes colours into SVG attributes, which is the
  case the Astryx doc reserves the resolver for; `tokenVar` stays for CSS. The data
  tokens are already wired in `palette.ts` `DATA_TOKENS`.
- Contrast (Theme rules): chart strokes are graphics and need 3:1 against the panel
  and card surfaces (`--color-background-surface` / `-card`, both `base`) and the
  body (`mantle`). Measured: blue 4.34 / 5.34 (Latte / Frappé on base), purple
  4.79 / 5.60, `--color-border-emphasized` 3.54 / 3.65, axis text (`subtext1`) 5.53 /
  6.75. Green (2.96) and peach (2.64) fail on Latte, so they are not used. E1 adds one
  case to `tests/themes/catppuccin-contrast.test.ts` ("chart strokes are visible on
  every content surface") importing `DATA_TOKENS`. Blue and purple are close in
  luminance (1.10), so lines also differ by pattern and by direct labels: actual
  solid 2px, ideal dashed `"4 4"`, scope dotted `"2 4"`, each named in the legend
  text, never by colour alone (WCAG 1.4.1).
- `BurndownChart`:
  ```ts
  export type BurndownChartProps = {
    cycle: Pick<Cycle, "name" | "start_date" | "end_date" | "status">;
    progress: CycleProgress;       // issues or points progress
    kind: ChartKind;
    today: string;
    height?: number;               // default 240
    hasDataTable?: boolean;        // default true
    onAddDates?: () => void;       // draft empty state action (open cycles only)
  };
  ```
  Recharts parts: `LineChart` with the `responsive` prop (not `ResponsiveContainer`)
  and `style={{ width: "100%", height }}`, `accessibilityLayer={false}`;
  `CartesianGrid vertical={false} stroke={grid}`; `XAxis dataKey="date"` (category,
  ticks through `formatShortDate`, `tick={{ fill: axis }}`, `stroke={grid}`);
  `YAxis allowDecimals={unit === "points"} stroke={grid} tick={{ fill: axis }}` (left
  bare, both axes fall back to Recharts' default `#666` stroke, which also colours the
  tick text: a hard-coded hex near 2:1 on Frappé base); `Line dataKey="actual"
  type="linear" stroke={actual} strokeWidth={2} dot={false} connectNulls={false}
  isAnimationActive={false}`; `Line dataKey="ideal" strokeDasharray="4 4"
  stroke={ideal} dot={false} isAnimationActive={false}`; burnup only:
  `ReferenceLine y={scope} stroke={scope} strokeDasharray="2 4" label={{ value: "Scope", fill: axis, position: "insideTopRight" }}`;
  `ReferenceLine x={today} stroke={today} label={{ value: "Today", fill: axis, position: "insideTopRight" }}`
  only when `model.today` (a bare string label sets no fill, so its text would fall
  back to SVG black); `Tooltip cursor={{ stroke: grid }} isAnimationActive={false}`
  (the default cursor is a light grey, the default animation `"auto"`) with
  `contentStyle` / `labelStyle` / `itemStyle` built from the tooltip colours and
  `var(--radius-container)`. No animation anywhere (reduced motion, stable tests), and
  no colour in the chart that does not come from `useChartColors`.
- Hydration: the theme mode resolves on the client and `responsive` measures the
  DOM, so the SVG renders only after mount (`useSyncExternalStore(noop, () => true, () => false)`,
  the `useHydrated` pattern in `src/components/detail/RelativeTime.tsx`); before
  that a `Skeleton` of the same height holds the space.
- Accessibility: the chart container is an Astryx primitive,
  `<VStack role="img" aria-label={summarizeChart(model)}>` around the `LineChart`
  (`VStack` props extend `BaseProps`, which extends `React.HTMLAttributes`,
  `dist/BaseProps.d.ts`; never a raw `div`), with the label "Burndown of Sprint 1: 5
  of 8 work items pending on Mar 9, ideal 4. Behind by 1."; the same sentence is
  visible under the chart
  (`Text type="supporting"`); a `Collapsible trigger="Data table"`
  (`dist/Collapsible/`: `trigger`, `isOpen`, `onOpenChange`) holds an Astryx
  `Table density="compact"` (`dist/Table/types.d.ts`: `data`, `columns` with `key`,
  `header`, `align: "end"`, `idKey="date"`) with Date, Pending (or Done) and Ideal.
- Empty states (`EmptyState isCompact`): draft "Add dates to see the chart" (action
  "Add dates" when `onAddDates`), upcoming "Starts <date>", no items "Add work items
  to see the chart". The panel's other sections still render.

### Modules (E2): `src/components/planning/`

- `ModulesScreen` (`"use client"`): props `{ projectId, modules: Module[], today, createOnOpen }`.
  Header `Heading level={2}` "Modules" + "New module" button; one `List` of
  `ModuleRow`s in engine order; empty → `EmptyState` "No modules yet".
- `ModuleRow`: ``ListItem href={`/projects/${projectId}/modules/${id}`}``; `startContent`
  `StatusDot` (`moduleStatusVariant`: backlog and planned neutral, in_progress accent,
  paused warning, completed success, cancelled error), `label` name, `description`
  status label · `formatModuleRange(start_date, target_date)`; `endContent` lead
  `Avatar`, members `AvatarGroup size="sm"` with `AvatarGroupOverflow count` beyond 3
  (`dist/AvatarGroup/`), "3/8" + `ProgressBar isLabelHidden`, `<ModuleMenu>`.
- `ModuleMenu` from `moduleActions(module)` (`module-format.ts`): Edit…, Archive
  (enabled only for completed or cancelled; description "Set the status to Completed
  or Cancelled first"), Restore (archived), Delete… (`AlertDialog`, "Its work items
  stay and leave the module.").
- `ModuleDialog` props `{ projectId, isOpen, onOpenChange, module?: Module }`:
  `TextInput` name, `TextArea` description, `Selector` status (default "Planned",
  decision 5), `LeadControl`, members through `AssigneeControl label="Members"`
  (`src/components/work-items/properties/AssigneeControl.tsx`, `value: string[]`),
  start and target dates through two Astryx `DateInput`s labelled "Start date" and
  "Target date" (`dist/DateInput/DateInput.d.ts`: `value?: ISODateString`,
  `onChange(value | undefined)`, `min`, `max`, `hasClear`, `format="date"`,
  `status?: { type: "error" | "warning" | "success"; message?: string }` from
  `dist/Field/types.d.ts`), linked by `max` / `min`. Not `DateControl`: it has no
  `status` prop (mismatch 29).
  Create → `createModuleAction({ project_id, name, description_md, status, lead_actor_id, member_ids, start_date, target_date })`;
  edit sends changed fields to `updateModuleAction` and members to
  `setModuleMembersAction({ module_id, actor_ids })`. Errors (the
  `CreateProjectDialog` pattern, which maps `CONFLICT` to a field `status`):
  - `CONFLICT` (names are unique per project) → `status={{ type: "error", message: "A module with this name exists" }}`
    on the Name `TextInput`.
  - `VALIDATION` whose `details` issues have `path[0]` `start_date` or `target_date`
    (`modules.ts` reports `target_date` when start is after target) → `status` on the
    Target date input with the engine's message.
  - Anything else (other `VALIDATION`, `ARCHIVED`, `NOT_FOUND`) → error Toast with the
    message; the dialog stays open.
- `LeadControl` props `{ value: string | null; onChange: (actorId: string | null) => void; readOnly?: boolean }`:
  `Selector label="Lead"` over `bundle.actors` plus "No lead" (`__none__`).
- `ModuleDetailScreen` props `{ projectId, data: ModuleDetailData, children }`: the
  cycle detail's layout with `ModuleHeader` and `ModuleSidePanel`; same peek rule,
  same `registerEntityLabel`.
- `ModuleHeader`: name, status `Selector` (inline, `size="sm"`, saves on change),
  "Add existing", panel toggle (`label` "Show details" / "Hide details" and no
  `aria-pressed`, like the cycle toggle), `ModuleMenu`; archived → info `Banner` with Restore.
- `ModuleSidePanel` (`LayoutPanel width={360}`): Astryx `MetadataList`
  (`dist/MetadataList/`: `MetadataListItem label icon`) with Lead, Members, Start,
  Target (inline controls), then `ModuleLinks`, then `ProgressPanel` without `chart`.
- Archived module (`module.archived_at !== null`): every inline control is read-only
  (header status `Selector isReadOnly`, `LeadControl readOnly`, `AssigneeControl
  readOnly`, the date inputs `isDisabled`, `ModuleLinks readOnly`), "Add existing"
  and quick-add are gone (`canCreate={false}`), and the menu offers Restore and
  Delete only. Inline saves that fail show an error Toast with the engine message.
- `ModuleLinks` props `{ moduleId: string; links: Link[]; readOnly: boolean }` (`Link` the
  type from `@/lib/tessera/types`, imported under an alias next to Astryx's `Link`): `List`
  of links, each `<AstryxLink href={link.url} isExternalLink>{link.title || link.url}</AstryxLink>`
  (`dist/Link/Link.d.ts`: `isExternalLink` opens a new tab with the external-link
  icon, sets `target="_blank"` and `rel="noopener noreferrer"`, and announces the new
  tab through `newTabLabel`; no hand-added icon), `MoreMenu` Edit… / Remove (hidden
  when `readOnly`); "Add link" opens a small form dialog (URL required, `https?://`,
  title optional). Actions `addModuleLinkAction({ module_id, url, title })`,
  `updateModuleLinkAction({ link_id, url, title })`, `removeModuleLinkAction({ link_id })`.
- Server Actions `src/app/actions/modules.ts`: `createModuleAction`,
  `updateModuleAction`, `archiveModuleAction`, `unarchiveModuleAction`,
  `deleteModuleAction`, `addWorkItemsToModuleAction`, `setModuleMembersAction`,
  `addModuleLinkAction`, `updateModuleLinkAction`, `removeModuleLinkAction`. No
  wrapper for `remove_work_items_from_module` (deferral table).
- `module-format.ts` (pure, no directive, `tests/ui/module-format.test.ts`):
  `MODULE_STATUS_LABEL`, `moduleStatusVariant`, `ARCHIVABLE_STATUSES` (the test
  asserts it equals the engine's `ARCHIVABLE_MODULE_STATUSES`; components cannot
  import `modules.ts`), `formatModuleRange` (through `formatShortDate` from
  `@/components/work-items/properties/date-format`), `moduleActions`.

### Archives (E3)

- `ArchivesTabs` (`src/components/planning/ArchivesTabs.tsx`, `"use client"`, props
  `{ projectId: string }`): navigation tabs, so no `role` and no `panelId`:
  `<TabList value={activeKind} onChange={() => {}} size="sm" layout="hug">` (both
  `value` and `onChange` are required in `dist/TabList/TabList.d.ts`; the no-op
  `onChange` is the `ProjectFrame.tsx` pattern for `href` tabs) with
  `<Tab value={kind} label href={`/projects/${projectId}/archives/${kind}`} />` for Work
  items, Cycles, Modules; `activeKind` is the path segment after `archives/` from
  `usePathname()`. The Cycles tab is left out when
  `useProject().bundle.project.cycles_enabled` is false, the Modules tab when
  `modules_enabled` is false (the archives layout sits inside the project layout,
  so the bundle is there).
- `ArchivedWorkItems` props `{ projectId: string; items: WorkItem[] }`, rendered by
  the page inside `<PeekHost projectId peek>`: a `List` whose rows open the peek
  (`peekHref` + `notePeekPush`, the `WorkItemsScreen.onOpen` body), `startContent`
  `StatusDot` of the state, `label` "WEB-3 Title", `description`
  `<RelativeTime value={item.archived_at} />` (`src/components/detail/RelativeTime.tsx`),
  `endContent` a secondary "Restore" `Button` (`RestoreIcon`) →
  `unarchiveWorkItemAction({ work_item_id })` and a `MoreMenu label="Work item actions"`
  with Delete… (destructive) → `AlertDialog` "Delete WEB-3? This cannot be undone."
  (`actionLabel="Delete"`, `isActionLoading`, closes on success) →
  `deleteWorkItemAction({ work_item_id })` (exists; `delete_work_item` works on
  archived items). Toasts "Restored WEB-3" / "Deleted WEB-3". Empty → `EmptyState`
  "No archived work items".
- `ArchivedCycles` props `{ projectId, cycles: Cycle[] }` and `ArchivedModules` props
  `{ projectId, modules: Module[] }`: rows link to the detail (which shows the archived
  Banner) and carry Restore plus a `MoreMenu` with Delete… (`AlertDialog`). Neither
  needs the other cycles: `unarchive_cycle` answers `CONFLICT` when the dates now
  overlap, and the engine message already names the cycle (`assertNoOverlap` in
  `cycles.ts`: `The dates overlap cycle "Sprint 3"`), so the Toast reads "Could not
  restore Sprint 1. The dates overlap cycle "Sprint 3"." (`ActionFailure.message`).
- `ArchivedProjects` props `{ projects: Project[] }` on `/projects/archives` (outside
  the project layout, so no `useProject()` here or in anything it renders):
  `Heading level={1}` "Archived projects", rows with `ProjectToken`
  (`src/components/work-items/ProjectFrame.tsx`) linking to the project, Restore →
  `unarchiveProjectAction({ project_id })`, Delete… → `DeleteProjectDialog`.
- `ProjectArchive.tsx` exports two components rendered by E4's `ProjectFrame`:
  `ProjectMenu({ project })` (`MoreMenu label="Project actions"`: Archive project
  (`AlertDialog`: "Archive WEB? It leaves the sidebar and becomes read-only until
  restored." → `archiveProjectAction`, then `router.push("/projects/archives")`),
  Restore project (archived), Delete project… → `DeleteProjectDialog`) and
  `ProjectArchivedBanner({ project })` (null unless archived; `Banner status="info"
  title="This project is archived"` with Restore in `endContent`).
- `DeleteProjectDialog` props `{ project: Project; isOpen; onOpenChange }`:
  `Dialog purpose="form" width={480}`, text "Deletes WEB with its work items, cycles,
  modules and views.", `TextInput label="Type WEB to confirm"`, footer Cancel +
  `Button variant="destructive" label="Delete project"` enabled when
  `confirmsDelete(project.identifier, typed)` (`archive-rules.ts`: trimmed,
  case-insensitive). → `deleteProjectAction({ project_id })` then `router.push("/projects")`.
- Work item archive and restore (additive edits in lane D's and C's files):
  `DetailHeaderProps` gains `onArchive?: () => void`, `onRestore?: () => void`,
  `archiveBlockedReason?: string`; the `MoreMenu` renders when any handler is set and
  adds Archive (`ArchiveIcon`, `isDisabled` + `description` = the reason) or Restore
  (`RestoreIcon`). `WorkItemDetail` passes them: archive only when the state group
  is completed or cancelled (`canArchiveWorkItem(group)` in `archive-rules.ts`;
  otherwise reason "Only completed or cancelled work items can be archived"), and
  shows `Banner status="info" title="This work item is archived" description="Restore it to edit it."`
  with a Restore `Button` above the title when `item.archived_at !== null`. Actions:
  `archiveWorkItemAction` (exists) and new `unarchiveWorkItemAction` in
  `src/app/actions/work-items.ts`; `archiveProjectAction`, `unarchiveProjectAction`,
  `deleteProjectAction` in `src/app/actions/projects.ts`. Toasts "Archived WEB-3" /
  "Restored WEB-3".
- `projects/page.tsx` (lane C file, additive): an "Archived projects" `Link` (with
  `ArchiveIcon`) next to "New project".
- `archive-rules.ts` (pure, `tests/ui/archive-rules.test.ts`): `canArchiveWorkItem`,
  `confirmsDelete`.

### Icons, CSS and conventions (all lanes)

- One P3 icon patch for `src/themes/catppuccin/icons.tsx`, applied in the prep
  commit; no lane edits `icons.tsx` or adds another icon (a missing one is an open
  issue in the hand-off). Phosphor files verified in `node_modules/@phosphor-icons/react/dist/csr/`.
  ```tsx
  // import list, after `RowsPlusTop,`:
    // P3 planning: cycles, charts, transfer and archives.
    Archive,
    ArrowCounterClockwise,
    ArrowsLeftRight,
    CalendarDots,
    ChartLineDown,
    ChartLineUp,
    Timer,
  // after `export const RowAddBelowIcon = duotoneIcon(RowsPlusBottom);`:
  export const ArchiveIcon = duotoneIcon(Archive);
  export const BurndownIcon = duotoneIcon(ChartLineDown);
  export const BurnupIcon = duotoneIcon(ChartLineUp);
  export const CalendarDotsIcon = duotoneIcon(CalendarDots);
  export const RestoreIcon = duotoneIcon(ArrowCounterClockwise);
  export const TimerIcon = duotoneIcon(Timer);
  export const TransferIcon = duotoneIcon(ArrowsLeftRight);
  ```
  Existing icons used: `CycleIcon`, `ModuleIcon`, `PlusIcon`, `UsersIcon`, `UserIcon`,
  `LinkIcon`, `PencilIcon`, `TrashIcon`, `CalendarIcon`, `TargetIcon`, `KanbanIcon`.
  External links get their icon from Astryx `Link isExternalLink`, not from an icon.
- CSS: `src/components/styles/planning.css` (E1: cycles list, summary card, detail
  header, side panel, progress panel, breakdowns, chart frame and data table),
  `modules.css` (E2), `archives.css` (E3); classes prefixed `tessera-planning-`,
  `tessera-modules-`, `tessera-archives-`; the three files and their `@import` lines
  in `src/app/globals.css` (order planning, modules, archives) exist since the prep
  commit, so no lane edits `globals.css`. Tokens only. Corners per the Theme rules: the summary
  card and any custom panel surface `--radius-container`, nested rows or chips
  `--radius-element` / `--radius-inner`; the chart frame has no corner of its own.
  Control outlines (filter field, inline selectors) stay Astryx's
  (`--color-border-emphasized`). No component restyles: if one is needed it is a
  request to lane B for `catppuccinTheme.ts`, not app CSS.
- Dates: `YYYY-MM-DD` values render through `formatShortDate` (from
  `properties/date-format.ts`); timestamps through `RelativeTime`. Never Astryx
  `Timestamp` on a date-only string (mismatch 13).
- Accepted trade-off (P3; lane B copies it into the Theme section's trade-offs on its
  next pass): `ProgressBar variant="success"` fills with `--color-success`
  (`pair("green")`, `palette.ts`), 2.96:1 on Latte base, under the 3:1 graphics
  rule. It stays because the fill never carries the information alone: every bar
  sits next to its text value ("3 of 8", "2/5") or is `isLabelHidden` with that text
  in the same row. A bar without an adjacent value must use `variant="accent"`.
  Chart strokes have no such text, which is why the chart avoids green (above).

### Integration (E4): scoped list, frame, sidebar, tabs, Power K, links

- Scoped work items list, `src/app/(tessera)/projects/[projectId]/work-items/scoped-list.tsx`
  (async Server Component, no directive; it imports `@/lib/tessera/server`, which
  is why it lives under `src/app/` and not `src/components/`):
  ```ts
  export type WorkItemsScope = { type: "project"; project_id: string } | { type: "cycle"; cycle_id: string } | { type: "module"; module_id: string };
  export type SettingsScope = { scope_type: "project" | "cycle" | "module"; scope_id: string };
  export type ScopeDefaults = { cycle_id?: string; module_ids?: string[] };

  export type ScopedWorkItemsProps = {
    projectId: string;
    scope: WorkItemsScope;
    settingsScope: SettingsScope;              // view_settings row (decision 23): cycle → { "cycle", cycleId }
    query: Record<string, string | string[] | undefined>; // the page's awaited searchParams: q, peek, create
    scopeDefaults?: ScopeDefaults;             // new items join the cycle / module
    canCreate?: boolean;                       // default true; false for completed or archived cycles and archived modules
    hiddenGroupFields?: readonly GroupBy[];    // cycle scope ["cycle"], module scope ["module"]
  };
  export async function ScopedWorkItems(props: ScopedWorkItemsProps): Promise<React.JSX.Element>;
  export async function loadPeek(projectId: string, peekId: string): Promise<PeekData>;   // moved here from page.tsx unchanged
  export function ListSkeleton(): React.JSX.Element;                                     // moved here from page.tsx
  ```
  Body: `await io()`, then the `loadWorkItems` body of today's `work-items/page.tsx`
  generalised to `getViewSettings(ctx, settingsScope.scope_type, settingsScope.scope_id)`
  and `listWorkItems(ctx, { scope, filters, display, limit: 2000 })`; a `group_by` or
  `sub_group_by` in `hiddenGroupFields` (from saved settings or the URL) becomes
  `null` before the list call. Then the peek and
  `<PeekHost projectId peek><WorkItemsScreen …/></PeekHost>`. `work-items/page.tsx`
  becomes a thin page rendering `<ScopedWorkItems scope={{ type: "project", project_id }} settingsScope={{ scope_type: "project", scope_id: projectId }} …/>`
  with identical behaviour. E1 and E2 render it as the `children` of their detail
  screens inside `<Suspense fallback={<ListSkeleton />}>` so the header streams first.
- `WorkItemsScreen` gains optional props (defaults keep the project list as it is):
  `settingsScope` (default `{ scope_type: "project", scope_id: projectId }`),
  `scopeDefaults`, `canCreate` (default true), `hiddenGroupFields` (default `[]`).
  The quick-add closure moves into a new pure module
  `src/components/work-items/quick-add.ts` (no directive, `tests/ui/quick-add.test.ts`)
  so it can be tested:
  ```ts
  export type OpenMemberships = {
    openModuleIds: ReadonlySet<string>;   // bundle.modules that are not archived
    openCycleIds: ReadonlySet<string>;    // bundle.cycles that are not completed (the bundle holds no archived cycle)
  };
  export type QuickAddContext = OpenMemberships & {
    projectId: string;
    states: readonly State[];        // bundle.states (state_group, sort_order); the first state per group as today
    scopeDefaults?: ScopeDefaults;
  };
  export function openMemberships(bundle: Pick<ProjectBundle, "modules" | "cycles">): OpenMemberships;
  export function isOpenGroupValue(field: GroupBy | null, value: string | null, open: OpenMemberships): boolean;
  export function acceptsGroupMove(field: GroupBy | null, fromValue: string | null, toValue: string | null, open: OpenMemberships): boolean;
  export function quickAddInput(group: QuickAddGroup, name: string, context: QuickAddContext): CreateWorkItemInputType | null;
  export function withScopeDefaults<T extends ScopeDefaults>(input: T, scopeDefaults: ScopeDefaults | undefined): T;
  export function quickAddAllowed(group: QuickAddGroup, context: QuickAddContext): boolean;
  ```
  `quickAddInput` keeps today's switch and then applies `scopeDefaults` through
  `withScopeDefaults` (`cycle_id ??=`; `module_ids` is the union); the optimistic
  placeholder follows the input; the create dialog gets
  `{ ...scopeDefaults, ...createDefaults }` (module ids united). `quickAddAllowed` is
  true for the none group (value null) and false in two cases:
  - in every scope, for a group whose value is a module or cycle that is not open
    (`isOpenGroupValue`: an archived module, a completed or archived cycle). Items
    neither join nor leave those (`ARCHIVED`, `LOCKED`), so the group shows no
    quick-add row instead of a failing request;
  - in a cycle scope (`scopeDefaults.cycle_id` set), for a group that pins a closed
    state: field `state` whose state's group is `completed` or `cancelled`, or field
    `state_group` with value `completed` or `cancelled`. Closed items cannot join a
    cycle (`RULE work_item_closed`).

  Every other group keeps the row, and a module scope adds no state rule. The board
  applies the same open-membership rule to drops and "Move to"
  (`acceptsGroupMove`; see "As built (review fixes, 2026-10-11)"). Test cases: both
  closed state group kinds hidden in a cycle scope and shown in a module scope and in
  the project list, groups of an archived module and of a completed or archived cycle
  hidden in every scope, open groups shown, `openMemberships`, `acceptsGroupMove`, and
  `quickAddInput` merging `cycle_id` and the module union.
  `canCreate` false: no "New work item" button, the `c` hotkey and `?create=1` do
  nothing, layouts get `onQuickAdd={undefined}`. The unused `settingsDisplay` prop
  stays as is.
- `src/components/work-items/types.ts`: `LayoutProps.onQuickAdd` becomes optional and
  `LayoutProps` gains `canQuickAdd?: (group: QuickAddGroup) => boolean` (absent =
  always). `ListLayout` and `BoardLayout` render a group's or column's quick-add only
  when `onQuickAdd` is set and `canQuickAdd?.(group) !== false`, passing the same
  `QuickAddGroup` they would pass to `onQuickAdd`. `WorkItemsScreen` passes
  `canQuickAdd={(group) => quickAddAllowed(group, context)}`.
- `DisplayMenu` gains `settingsScope: SettingsScope` and `hiddenGroupFields?: readonly GroupBy[]`:
  save and reset call `saveViewSettingsAction({ ...settingsScope, display })` /
  `resetViewSettingsAction(settingsScope)` instead of the hard-coded project scope;
  group and sub-group options drop the hidden fields.
- Project frame tabs, new pure module `src/components/work-items/project-tabs.ts`
  (tested in `tests/ui/project-tabs.test.ts`):
  ```ts
  export type ProjectTabKey = "work-items" | "cycles" | "modules" | "archives";
  export type ProjectTabDef = { key: ProjectTabKey; label: string; segment: string };
  export function projectTabs(project: Pick<Project, "cycles_enabled" | "modules_enabled">): ProjectTabDef[];
  export function activeProjectTab(pathname: string, projectId: string, tabs: readonly ProjectTabDef[]): ProjectTabDef | null;
  ```
  Order: Work items, Cycles (when enabled), Modules (when enabled), Archives
  (always). `ProjectFrame` replaces the static `TABS` (no other importer) with
  `projectTabs(project)`, maps icons in the component (`KanbanIcon`, `CycleIcon`,
  `ModuleIcon`, `ArchiveIcon`), passes `value={active?.key ?? ""}` (a route of a
  disabled feature selects no tab), and renders E3's `<ProjectMenu project />` at the
  end of the header row. Since the layout rework merge the header row is the
  project's `PanelHeader` (one 52px `PanelBar`: project token, name, a hairline, the
  tabs; `ProjectMenu` at its end), and `<ProjectArchivedBanner project />` sits under
  the `PanelHeader` in the `Layout` header slot (outside the scroller), not between
  the row and the tabs.
- Property controls and lane A's new refusals (an item may sit in an archived cycle
  or module, which the bundle leaves out). New pure module
  `src/components/work-items/properties/membership-rules.ts` (no directive, tested in
  `tests/ui/property-controls.test.ts`):
  ```ts
  export type CycleControlModel = {
    options: { value: string; label: string; description: string }[];
    readOnly: boolean;
    reason: "completed" | "archived" | null;
  };
  export function cycleControlModel(value: string | null, cycles: readonly Pick<Cycle, "id" | "name" | "status">[]): CycleControlModel;
  export function splitModuleValue(value: readonly string[], modules: readonly Pick<Module, "id">[]): { editable: string[]; kept: string[] };
  export function mergeModuleChange(next: readonly string[], kept: readonly string[]): string[];
  ```
  - `CycleControl.tsx`: options are the bundle cycles that are not completed, plus the
    current value. The control is read-only (`Selector isReadOnly`) when the value is
    a completed cycle (`reason: "completed"`, the engine answers `LOCKED`) or is
    missing from `bundle.cycles` (`reason: "archived"`, the engine answers
    `ARCHIVED`); a missing value gets the synthetic option `{ value, label: "Archived
    cycle", description: "Archived" }` so the selector shows it. Option descriptions
    keep the status label.
  - `ModuleControl.tsx`: ids not in `bundle.modules` (archived modules) are `kept`:
    the `MultiSelector` receives only `editable` as `value`, its `onChange` calls
    `onChange(mergeModuleChange(next, kept))` so `set_modules` never drops them, and a
    read-only `Token size="sm" color="gray"` next to it reads "1 archived module" /
    "N archived modules" (names are not in the bundle).
  - Test cases: completed value read-only; archived (missing) value read-only with the
    synthetic option; open value editable and completed cycles left out of the options;
    `kept` ids survive adding and removing an editable module; no kept ids → the value
    passes through unchanged.
- Sidebar (`src/components/shell/Sidebar.tsx`): since the layout rework merge the
  projects are flat rows with no children (P3's `projectNavItems` is gone); a
  project's Work items, Cycles, Modules and Archives are the tabs of its panel header
  (above), which follow the feature toggles. "Projects" is also selected on
  `/projects/archives` and below it (`isProjectsPage`). `projectIdFromPath` is one
  export of `src/components/shell/recents.ts` (it was in `tab-registry.ts` until the
  merge) with the guard `/^\/projects\/(?!archives(?:[/?#]|$))([^/?#]+)/`;
  `Sidebar.tsx` (the current project's row), `useShortcuts.ts` and `CommandBar.tsx`
  (the palette's project scope, which on `/projects/archives` would send
  `scope=archives` to `/api/search` and fail its `IdSchema`) import it and keep no
  local copies. `tests/ui/recents.test.ts` covers `/projects/archives` and
  `/projects/archives/` → `null`, `/projects/<id>/archives/cycles` → `<id>`,
  `/projects/<id>` → `<id>`.
- `src/components/work-items/properties/date-format.ts` (new, no directive):
  `formatShortDate` moves here unchanged from `DateControl.tsx`, which imports it and
  re-exports it so current importers keep working. `cycle-format.ts` and
  `module-format.ts` (E1, E2) import it from here (mismatch 27).
- Recents (`src/components/shell/recents.ts`, which replaced `tab-registry.ts` and
  `TabBar.tsx` in the layout rework merge): `RouteIconKey` adds `"cycles" | "cycle" |
  "modules" | "module" | "archives"`; `RouteLookup` adds `entityLabel?: (id: string)
  => string | undefined`; `resolveRoute` adds the cases under "Routes and data
  loading" (`/projects/archives` checked before the project lookup);
  `isTransientPath` also matches `/cycles/`, `/modules/`, the project index and the
  archives index. `shell-icons.ts`: `ROUTE_ICONS` maps `cycles` and `cycle` to
  `CycleIcon`, `modules` and `module` to `ModuleIcon`, `archives` to `ArchiveIcon`;
  `recents-store.ts` passes `entityLabel: (id) => entityLabels.get(id)` (the store
  `registerEntityLabel` fills).
- Power K:
  - `shortcuts.ts`: remove `arrives` from `create.cycle`, `create.module`,
    `nav.cycles`, `nav.modules`, `nav.archives`; `create.view` and `nav.views` →
    `arrives: "P4"`; `ShortcutArrival` = `"P4" | "P5" | "P6" | "P7" | "P8" | "P9"`.
  - `useShortcuts.runShortcut`: `create.cycle` → `/projects/<p>/cycles?create=1`,
    `create.module` → `/projects/<p>/modules?create=1`, `nav.cycles` →
    `/projects/<p>/cycles`, `nav.modules` → `/projects/<p>/modules` (each with
    `currentOrLastProjectId()`, else Toast "Open a project first"); `nav.archives` →
    `/projects/<p>/archives` inside a project, else `/projects/archives`.
  - `CommandBar.openHit`: `cycle` → `/projects/${hit.project_id}/cycles/${hit.id}`,
    `module` → `/projects/${hit.project_id}/modules/${hit.id}` (no-op without
    `project_id`); `work_item` opens the peek when
    `mountsPeek(window.location.pathname, hit.project_id)` and a `PeekHost` of that
    project is mounted (`peek-url.workItemHitTarget`, `peek-hosts.hasPeekHost`), else
    the full page.
  - `src/components/detail/peek-url.ts` (additive): `mountsPeek(pathname, projectId)`
    is true for `/projects/<projectId>/work-items`, `/projects/<projectId>/cycles/<id>`,
    `/projects/<projectId>/modules/<id>` and `/projects/<projectId>/archives/work-items`
    (trailing slash ignored).
- Editor links: `src/components/editor/links.ts` `entityRoute` returns
  `/cycles/<encoded ref>` for `cycle` and `/modules/<encoded ref>` for `module`
  (`page` stays `null` until P6). `DescriptionEditor.openEntity` pushes that route
  for cycles and modules instead of the "Arrives in P3" Toast. The alias pages
  `(tessera)/cycles/[cycleId]/page.tsx` and `(tessera)/modules/[moduleId]/page.tsx`
  follow `/browse/[key]`: `IdSchema` check → `getCycle` / `getModule` in a `try`
  (`NOT_FOUND` / `VALIDATION` → `notFound()`) → `redirect` to
  `/projects/<project_id>/cycles/<id>` (or modules) outside the `try`.
- `src/components/detail/activity-text.ts`: `FIELD_LABELS` gains `module: "module"`
  for item rows written before lane A's rename.

### Lane split and file ownership

All five lanes start at once from `main`. Merge order: A, E1, E4, E2, E3, so the
shared planning pieces (E1) and the scoped list (E4) are on `main` before the lanes
that use them. Until a dependency merges, a lane codes against the signatures in
this section; a stub lives at the owner's exact path with the exact exported names,
starts with the line `// STUB(P3): replaced by lane <X>`, and loses to the owner's
file in the merge (add/add conflict resolved by taking the owner's version; between
two stubs, keep the one already on `main`). Gate: `grep -rn "STUB(P3)" src` is empty
after the last merge. UI lanes never stub `src/lib/tessera/**`: they rebase onto A
before using its new fields. Lanes B, C and D are idle in P3, so E3 and E4 may change
(not only extend) the files in their middle column, keeping every behaviour this
section does not change; the hand-off names each file.

As built (prep, 2026-10-11): the lanes run at the same time in one shared checkout,
not on branches, as in P2b. "Merge order" is the order in which the integrator
resolves leftover stubs. A lane writes a stub only while the owner's file does not
exist yet, never overwrites a file it does not own, and checks again before its
hand-off (a stub whose owner has landed is deleted and the import kept). An owner
that finds a file starting with the `STUB(P3)` line replaces it. `package.json`, the
lockfile, `icons.tsx` and `globals.css` are already done (prep) and no lane edits
them; `planning.css`, `modules.css` and `archives.css` exist with a header comment
only, and each lane fills its own.

| Lane | Creates | May edit additively (name it in the hand-off) | Must not touch |
|---|---|---|---|
| A engine | `scripts/mcp-call.ts` | `src/lib/tessera/{schemas,types,cycles,modules,work-items}.ts`, `src/lib/tessera/tools/registry.ts` (five descriptions), `tests/{cycles,modules,work-items}.test.ts`, `docs/contracts/{service-api,tools}.md` (corrections only), `docs/PLAN.md` (§5, §6, §9, §11 step 2, §13; item 10) | `src/app/**`, `src/components/**`, migrations |
| E1 cycles and charts | `src/app/(tessera)/projects/[projectId]/cycles/**`, `src/components/planning/{types,panel-prefs,burndown,cycle-format,chart-colors}.ts`, `src/components/planning/{ProgressPanel,BreakdownTabs,AddExistingItemsDialog,FeatureOffState,CyclesScreen,CycleRow,CycleMenu,ActiveCycleSummary,CycleDialog,CycleDetailScreen,CycleHeader,CycleSidePanel,TransferDialog,BurndownChart}.tsx`, `src/components/styles/planning.css`, `src/app/actions/cycles.ts`, `tests/ui/{burndown,cycle-format}.test.ts` | `tests/themes/catppuccin-contrast.test.ts` (one case) | `src/components/{work-items,shell,detail,editor}/**`, other routes, `palette.ts`, `catppuccinTheme.ts` |
| E2 modules | `src/app/(tessera)/projects/[projectId]/modules/**`, `src/components/planning/{ModulesScreen,ModuleRow,ModuleMenu,ModuleDialog,ModuleDetailScreen,ModuleHeader,ModuleSidePanel,ModuleLinks,LeadControl}.tsx`, `src/components/planning/module-format.ts`, `src/components/styles/modules.css`, `src/app/actions/modules.ts`, `tests/ui/module-format.test.ts` | none | E1's planning files (stub them), `src/components/{work-items,shell,detail}/**` |
| E3 archives | `src/app/(tessera)/projects/[projectId]/archives/**`, `src/app/(tessera)/projects/archives/page.tsx`, `src/components/planning/{ArchivesTabs,ArchivedWorkItems,ArchivedCycles,ArchivedModules,ArchivedProjects,ProjectArchive,DeleteProjectDialog}.tsx`, `src/components/planning/archive-rules.ts`, `src/components/styles/archives.css`, `tests/ui/archive-rules.test.ts` | `src/app/actions/work-items.ts` (`unarchiveWorkItemAction`), `src/app/actions/projects.ts` (three wrappers), `src/components/detail/{DetailHeader,WorkItemDetail}.tsx` (archive and restore), `src/app/(tessera)/projects/page.tsx` (link) | `ProjectFrame.tsx`, `src/components/shell/**`, `src/components/work-items/**` except the files named |
| E4 integration | `src/app/(tessera)/projects/[projectId]/work-items/scoped-list.tsx`, `src/components/work-items/{project-tabs,quick-add}.ts`, `src/components/work-items/properties/{membership-rules,date-format}.ts`, `src/app/(tessera)/cycles/[cycleId]/page.tsx`, `src/app/(tessera)/modules/[moduleId]/page.tsx`, `tests/ui/{project-tabs,quick-add,property-controls}.test.ts` | `projects/[projectId]/work-items/page.tsx`, `src/components/work-items/{WorkItemsScreen,DisplayMenu,ListLayout,BoardLayout,ProjectFrame,types}.ts(x)`, `properties/{CycleControl,ModuleControl,DateControl}.tsx`, `src/components/shell/{Sidebar,recents,recents-store,shell-icons,shortcuts,useShortcuts,CommandBar}.ts(x)` (P3 edited `tab-registry.ts` and `TabBar.tsx`, which the layout rework merge replaced with the three recents files), `src/components/detail/{peek-url,activity-text,DescriptionEditor}.ts(x)`, `src/components/editor/links.ts`, `tests/ui/{recents,shortcuts,peek-url}.test.ts` (`tab-registry.test.ts` before the merge), `tests/editor/links.test.ts` | `src/components/planning/**` (renders `ProjectMenu` and `ProjectArchivedBanner` through stubs), `src/lib/tessera/**` |

Stubs expected: E2 and E3 stub E1's `planning/types.ts`, `ProgressPanel`,
`AddExistingItemsDialog`, `FeatureOffState` and `cycle-format.ts` as they need them;
E3 stubs E2's `module-format.ts`; E1, E2 and E3 stub E4's `scoped-list.tsx`
(`ScopedWorkItems` and `ListSkeleton` render a plain "Work items arrive with E4"
text, `loadPeek` returns `{ id, data: null }`); E1 and E2 stub E4's
`properties/date-format.ts` (the `formatShortDate` body copied from `DateControl.tsx`,
so the stub pulls no client file); E4 stubs E3's `ProjectArchive.tsx` (both
components return `null`). There is no `src/components/planning/index.ts` barrel:
files are imported directly, so no lane writes a file another lane owns. Lane A's
`scripts/mcp-call.ts` and docs/PLAN.md edits touch no UI file.

### Acceptance (P3)

The run uses its own database, so the user's `data/tessera.db` is never written.
The gate's `next build` needs the dev server stopped anyway (it shares `.next` with
`next dev`, and a second `next dev` in this folder exits on the lock `.next/dev/lock`,
`setup-dev-bundler.js`, `Lockfile.acquireWithRetriesOrExit`). So the verifier, after
the build:

- stops the dev server, runs `rm -rf .next/dev` (a stale Turbopack dev cache after a
  build causes an HMR reload loop), and restarts it with
  `TESSERA_DB_PATH=<repo>/data/p3-acceptance.db` in the environment (a new file;
  `.env.local` does not exist, and an exported variable wins over it anyway);
- loads `http://127.0.0.1:3000/home` once, so the server creates and migrates the
  file (the stdio MCP server refuses pending migrations), then exports the same
  `TESSERA_DB_PATH` in the shell that runs `scripts/mcp-call.ts`, whose stderr line
  names the database (the report records it);
- at the end stops the server, runs `rm -rf .next/dev` and restarts it without the
  variable (default `data/tessera.db`), and leaves `data/p3-acceptance.db` in place
  (`data/` is git-ignored).

The steps still use projects with identifiers of their own, `P3A` ("P3 Acceptance")
and `P3T` ("P3 Throwaway"). Browser: the in-app browser, or a Chrome DevTools
session at `http://127.0.0.1:3000` when the pane does not open (as in P2b).

Before step 1:

- "MCP" below means `npx tsx scripts/mcp-call.ts <tool> '<json>'`; ids come from the
  browser URL (`/projects/<projectId>/cycles/<cycleId>`) or from
  `get_work_item_by_key '{"key":"P3A-3"}'`.

Steps in order:

1. `/projects` → New project "P3 Acceptance" (`P3A`) → the project's panel header
   shows the tabs Work items, Cycles, Modules, Archives, and the sidebar lists P3
   Acceptance as one flat row with no children. MCP `list_projects` lists P3
   Acceptance, which proves the client and the server share one database (if not,
   stop: the server runs on another `TESSERA_DB_PATH`). MCP `update_project_features '{"project_id":"<id>","cycles_enabled":false}'`
   → within 5 s the Cycles tab of the panel header and the Archives › Cycles tab
   disappear; `/projects/<id>/cycles`, `/projects/<id>/cycles/00000000-0000-4000-8000-000000000000`
   and `/projects/<id>/archives/cycles` show "Cycles are turned off for this
   project". MCP `update_project_features` with `cycles_enabled: true` → all three
   come back.
2. Work items → create `P3A-1` "Existing task". `g c` → Cycles shows "No cycles yet".
   New cycle "Sprint 1" with dates today − 7 … today + 7 → listed under Current and
   the summary card shows Sprint 1 with "7 days left". New cycle again → the Dates
   picker shows the days of Sprint 1 disabled; Cancel.
3. Open Sprint 1 → quick-add "Alpha" (`P3A-2`) and "Beta" (`P3A-3`) → both show
   Sprint 1 in the cycle property. Display → group by State → the Done and Cancelled
   groups have no quick-add row, Backlog and Todo do; set grouping back. "Add
   existing" → filter "Existing" → add `P3A-1` → three items; the panel shows 0 of 3.
   The Recent entry for the cycle reads "P3 Acceptance · Sprint 1" with the cycle
   icon, on Home or in Power K's "Recent" group (open `mod+k` from another page: the
   group leaves out the page on screen).
4. Open `P3A-2` in the peek (the progress panel hides), set it to Done, close the
   peek → the panel shows 1 of 3; the burndown has a dashed ideal line, an actual
   line ending today, a "Today" marker and the sentence under it names pending and
   ideal values in work items; the axes and labels read in both colour schemes; open
   "Data table" → one row per day. Switch to Burnup → a dotted "Scope" line at 3 and
   actual 1 today; reload → Burnup is kept. The Unit switch is absent (no estimate).
5. Edit Sprint 1 → end date yesterday → the header says Completed, quick-add and
   "Add existing" are gone, the read-only line shows; a `P3A-1` peek shows the cycle
   control read-only. MCP `update_work_item '{"work_item_id":"<P3A-3 id>","priority":"high"}'`
   → the open cycle page shows High within 5 s.
6. Cycles → New cycle "Sprint 2" with dates today … today + 13 → the summary card
   now shows Sprint 2; Sprint 1 sits under Completed with a "2 open" badge and its
   menu shows Archive enabled and Delete disabled ("Archive it first").
7. Sprint 1 menu → "Transfer open items…" (targets: Sprint 2 and "No cycle") → Sprint
   2 → Toast "Moved 2 work items to Sprint 2" → Sprint 2 lists `P3A-1` and `P3A-3`;
   Sprint 1 still shows 1 of 3 in the row and in its panel, the panel says the
   progress is frozen, its chart is unchanged and the Transfer item is gone. MCP
   `get_cycle '{"cycle_id":"<Sprint 1 id>"}'` returns `open_count: 0` and a non-null
   `progress_snapshot`.
8. Sprint 1 menu → Archive → it leaves the list. Work items → open `P3A-2` (still in
   Sprint 1) in the peek → its cycle control reads "Archived cycle" and is read-only.
   Archives tab → Cycles lists Sprint 1; open it → "This cycle is archived" Banner →
   Restore → it is back under Completed. Sprint 2's menu shows Archive disabled with
   "Cycles can be archived after their end date".
9. `g m` → New module "Launch" (status Planned by default, lead and member = the
   human actor, start today, target today + 30) → the row shows the status, lead,
   member and dates. New module "Launch" again → the Name field says "A module with
   this name exists"; Cancel. Open Launch → Add link `https://example.com` "Spec" →
   listed with the external-link icon, opens in a new tab; "Add existing" → `P3A-1`;
   quick-add "Gamma" (`P3A-4`) → two items; the panel shows 0 of 2 with the
   Assignees, Labels and States tabs (arrow keys move between them).
10. Launch menu → Archive is disabled ("Set the status to Completed or Cancelled
    first"); set status Completed → Archive → Archives › Modules lists Launch. Open
    `P3A-1` in the peek → the Modules control shows "1 archived module" and no Launch
    option; MCP `get_work_item_by_key '{"key":"P3A-1"}'` still lists Launch's id in
    `module_ids`. Open Launch from Archives › Modules → the archived Banner, read-only
    controls, no "Add link", no quick-add → Restore → back in Modules.
11. Work items → open `P3A-2` (Done) → More actions → Archive → "This work item is archived"
    Banner; the list no longer shows it. Archives › Work items lists `P3A-2` → open
    it (peek with the Banner) → Restore → it is back in Work items. On `P3A-1` (open)
    the Archive item is disabled with its reason. Archive `P3A-2` again → Archives ›
    Work items → its menu → Delete… → confirm → Toast "Deleted P3A-2" and Archives ›
    Work items shows "No archived work items".
12. Project actions (the "…" at the end of the project's panel header) → Archive project → confirm → `/projects/archives`
    lists P3 Acceptance and the sidebar no longer shows it; open it → the archived
    Banner; Restore → the sidebar shows it again. Create project "P3 Throwaway"
    (`P3T`), Delete project… → the button enables only after typing `P3T` → it
    disappears everywhere.
13. Power K inside P3 Acceptance: `g c` → Cycles; `n c` → the New cycle dialog
    (Cancel); `mod+k` "Sprint 2" → Enter opens its detail; `g r` → Archives; `g m` →
    Modules. On `/projects/archives`: `mod+k` "Existing task" finds `P3A-1` (the
    palette is not scoped to a project called "archives") and `n i` opens the create
    dialog of the last project (P3 Acceptance), never `/projects/archives/work-items`. The help
    dialog (`mod+/`) shows no "Arrives in P3" hint; Views say "Arrives in P4".
14. Copy Sprint 2's id from the URL; open `P3A-1`, switch its description to source,
    add `[Sprint 2](cycle:<id>)`, switch back → a chip; click it → `/cycles/<id>`
    redirects to the cycle, and the recents (Home, or Power K's "Recent" group opened
    from another page) hold one entry for it, "P3 Acceptance · Sprint 2", and none
    for `/cycles/<id>` (the alias is transient).
15. Sibling navigations, by clicking only (no typed URLs, no reloads): Work items tab
    → Cycles tab → Sprint 2 row → Archives tab → Cycles (archives) → Modules
    (archives) → Modules tab of the panel header → Launch row → Work items tab. Each screen
    renders, and no Next dev overlay, error or instant-navigation insight appears.
16. The dev console shows no errors and no hydration warnings on any screen visited
    in steps 1–15 (only the two known dev-only entries under "Carried items" are
    allowed).
17. Clean-up: P3 Acceptance → Project actions → Delete project… → type `P3A` → it
    leaves the sidebar, `/projects` and `/projects/archives`; MCP `list_projects` and
    `list_projects '{"archived":true}'` hold neither `P3A` nor `P3T`. The deleted
    rows and their activity stay in `data/p3-acceptance.db` as soft-deleted history.

Gate: `npm run check` green (typecheck, lint, Vitest including the new
`tests/ui/{burndown,cycle-format,module-format,archive-rules,project-tabs,quick-add,property-controls}.test.ts`
and the updated engine and UI tests, conventions, licences, theme), `next build`
green, `grep -rn "STUB(P3)" src` empty, and docs/PLAN.md §9's P3 exit criteria met
(cycle rules Vitest, transfer keeps the snapshot, restore works in the browser:
steps 7, 8, 10 and 11).

### API verification and mismatches found while writing this section

| # | Source says | Installed code or package says | P3 resolution |
|---|---|---|---|
| 1 | docs/PLAN.md §11 step 2: "Recharts and Playwright are added at P9 and P11"; §9 names Recharts only in the P9 row | The burndown needs a chart in P3; `recharts` is not installed | E1 installs `recharts@3.10.1`; P9 reuses it; lane A corrects §9 and §11 (lane A item 10) |
| 2 | `palette.ts` comment "Categorical chart hues (P9 charts)" | `DATA_TOKENS` are already wired in `catppuccinTheme.ts` | No palette change; lane B updates the comment on its next pass (others may not edit `palette.ts`) |
| 3 | `shortcuts.ts` `create.view` / `nav.views` `arrives: "P3"` | Views are P4 (docs/PLAN.md §9) | E4 sets `"P4"` |
| 4 | `shortcuts.ts` `nav.archives` `arrives: "P9"` | Archives ship in P3 | E4 removes `arrives` and wires `g r` |
| 5 | docs/PLAN.md §6: project Archives in the sidebar's `…` menu, a workspace "Archives" entry | No project `…` menu exists; frame tabs are the project navigation | Archives is a permanent frame tab plus `g r` and a link on `/projects`; the sidebar entries wait for the P9 sidebar pass; lane A records the deviation in PLAN §6 and §13 and the alias routes in §5 (item 10) |
| 6 | House dialogs need a footer | Astryx has no `DialogFooter` (`dist/Dialog/`) | `Layout` header / content / footer (`CreateProjectDialog.tsx`) |
| 7 | Row menus inside clickable rows risk nested controls (the handbook tabs bug fixed in `2c96000`) | `ListItem` `href` / `onClick` render an invisible anchor or button beside the content (`dist/List/ListItem.d.ts`), and `label` is a ReactNode | Rows use `href` with menus in `endContent`; checkbox rows use `interactiveRef` |
| 8 | `get_cycle_progress` description promises "the ideal line"; `get_module_progress` "the completion percentage" | Neither is returned | Lane A rewrites the descriptions (tools.md) |
| 9 | Public product docs show a new module starting in Backlog | Decision 5 and `createModule` default to `planned` | Keep `planned` |
| 10 | Recharts declares `react-is` as a peer | The hoisted `react-is` is 16.13.1 (via `prop-types`); React 19 elements need `react-is` 19 to be recognised | E1 adds `react-is@19.3.0` as an exact direct dependency |
| 11 | P2b tests pin the pre-P3 behaviour | `tests/ui/shortcuts.test.ts` 441–446 ("Arrives in P3"), `tests/ui/tab-registry.test.ts` 77–79 (cycles icon `"page"`), `tests/editor/links.test.ts` 76–78 (cycle and module routes `null`) | E4 updates them. Since the layout rework merge the route cases live in `tests/ui/recents.test.ts` (`/projects/<id>/cycles` has the `"cycles"` icon; the generic section case uses `/settings`) |
| 12 | `/projects/archives` is a static route | Three copies of `projectIdFromPath` match `archives` as a project id: `Sidebar.tsx` 49, `useShortcuts.ts` 115 and `CommandBar.tsx` 104 (the palette scope at 147, which would send `scope=archives` to `/api/search`) | One guarded export, `recents.projectIdFromPath` (in `tab-registry.ts` until the layout rework merge), imported by all three (E4); `tests/ui/recents.test.ts` covers `/projects/archives` → `null` |
| 13 | Astryx `Timestamp` formats dates | A `YYYY-MM-DD` string parses as UTC midnight, a day early west of UTC and a hydration risk | `formatShortDate` for dates, `RelativeTime` for timestamps |
| 14 | This contract names Recharts props | Not verifiable before install | E1 checks `responsive`, `accessibilityLayer`, `Line` (`connectNulls`, `strokeDasharray`, `isAnimationActive`, `dot`), `ReferenceLine` (`x`, `y`, `label` as an object with `value`, `fill`, `position`), `XAxis` / `YAxis` (`allowDecimals`, `tick`, `stroke`; the `CartesianAxis` default stroke `#666` they override), `CartesianGrid vertical`, `Tooltip` (`contentStyle`, `labelStyle`, `itemStyle`, `cursor`, `isAnimationActive`) in `node_modules/recharts/types/` and records any deviation in its hand-off |
| 15 | `DateRangeInput` constraints could take ISO strings | `dateConstraints: ReadonlyArray<(date: Date) => boolean>` (`dist/DateRangeInput/DateRangeInput.d.ts`) | Convert with local date getters |
| 16 | `CycleProgressSchema` `points` and `completion_chart` are integers | Estimate values may be fractional; a fractional snapshot fails `safeParse` and progress silently goes live | Lane A item 1 |
| 17 | Module points follow the active estimate | Cycle points ignore `estimates_enabled` and the estimate id (`cycles.ts` `loadProgressItems`) | Lane A item 2 |
| 18 | The snapshot freezes "issues mode, points included" (schema.md "Cycles") | Points mode on a frozen cycle returns the items series under point totals | Lane A item 2 (both series frozen, `chart_mode`) |
| 19 | One activity field per membership kind | `modules.ts` writes `field: "module"`, `work-items.ts` writes `"modules"`; `activity-text.ts` labels only `modules` | Lane A item 6 plus E4's alias for stored rows |
| 20 | Decision 24: cycle and module membership log on both sides | `update_work_item.cycle_id` and `set_modules` log only the item side | Recorded; fixed with the P5 entity activity feed |
| 21 | Module tools refuse archived modules (`ARCHIVED`) | `syncModules` and `createWorkItem` let items join or leave an archived module | Lane A item 4 |
| 22 | Cycle progress counts archived items (schema.md) | The cycle-scoped list hides archived items | The panel caption says "Includes archived work items." |
| 23 | Feature toggles hide cycles and modules | The engine does not refuse cycle or module tools while a toggle is off; there is no settings UI before P4 | UI-only hiding in P3; enforcement decided with P4 settings |
| 24 | `.cursor/rules/astryx.mdc` describes Astryx | It still describes 0.6.0 | Not P3; refresh with the next Astryx upgrade |
| 25 | Acceptance could serve a fresh database on a second app server | Next 16.4 dev takes `<distDir>/lock` (`node_modules/next/dist/server/lib/router-utils/setup-dev-bundler.js` 175, `Lockfile.acquireWithRetriesOrExit`), so a second `next dev` here exits | Acceptance restarts the dev server after the build on its own database `data/p3-acceptance.db` (prep decision, 2026-10-11; the user's database is never written); MCP steps go through `scripts/mcp-call.ts` with the same `TESSERA_DB_PATH` (lane A item 9) |
| 26 | The project layout's `instant = false` covers the pages under it | `01-app/02-guides/instant-navigation.md` "Opting out": "Navigations between sibling segments below are still validated" | Each new page adds `instant = false` when the validator reports it; acceptance step 15 walks sibling navigations |
| 27 | Pure format helpers can import `formatShortDate` | It is exported from `DateControl.tsx`, a `"use client"` file: a Server Component would get a client reference, and Vitest would load Astryx client components | E4 moves it to `properties/date-format.ts` (no directive); `DateControl.tsx` re-exports it; E1 and E2 import the new path |
| 28 | `completion_chart_points` is snapshot-only | `toCycles` / `toCycleDetail` spread `CycleRow`, so `progress_snapshot` reaches `list_cycles`, `get_cycle` and the project bundle | Documented (lane A item 1, service-api.md); the UI's frozen flag is `progress_snapshot !== null` |
| 29 | Module date errors show on the date control | `DateControl` has no `status` prop; Astryx `DateInput` has `status?: InputStatus` (`dist/DateInput/DateInput.d.ts`, `dist/Field/types.d.ts`) | `ModuleDialog` uses two `DateInput`s directly |
| 30 | `ProgressBar variant="success"` meets the 3:1 graphics rule | `--color-success` is `pair("green")` (`palette.ts` 154), 2.96:1 on Latte base | Accepted trade-off: a text value accompanies every bar ("Icons, CSS and conventions") |
| 31 | A `Tab` with `panelId` works in any `TabList` | Without `role="tablist"` the strip is a `<nav>` and `dist/TabList/Tab.js` 208 warns in development that `panelId` does nothing | `BreakdownTabs` uses `role="tablist"`, tab ids and `role="tabpanel"` panels; `ArchivesTabs` and the frame tabs keep the navigation pattern without `panelId` |
| 32 | External links need a hand-added icon | Astryx `Link isExternalLink` adds the icon, `target="_blank"`, `rel` and the new-tab announcement (`dist/Link/Link.d.ts`) | `ModuleLinks` uses it |
| 33 | Quick-add works in every group | In a cycle scope a group pinned to a closed state sends `cycle_id` with that state, which `createWorkItem` refuses (`RULE work_item_closed`) | `quickAddAllowed` hides those quick-add rows (E4) |
| 34 | Property controls only need the bundle's cycles and modules | The bundle leaves out archived cycles and modules; after lane A, dropping an archived module through `set_modules` or leaving an archived cycle answers `ARCHIVED` | `membership-rules.ts` keeps archived module ids and makes an archived or completed cycle value read-only (E4) |
| 35 | The project layout wraps `/projects/archives` | It is a sibling static segment, so it has no `ProjectProvider` | `ArchivedProjects` takes its data as props and uses no `useProject()` |

Review fixes adopted with a change:

- Module date errors: shown on the Target date field as asked, but through Astryx
  `DateInput` rather than `DateControl`, which has no `status` prop (row 29).
- Acceptance MCP client: it spawns `npx tsx scripts/mcp-stdio.ts` (the form
  `.mcp.json` and `tests/mcp-stdio.test.ts` use) with no `--db` and no `--migrate`
  rather than `npm run mcp:stdio -- --db <path>`, so it opens exactly the database the
  dev server resolves and never migrates it.

### As built (integration, 2026-10-11)

Notes from the P3 integration run; the hand-off is in docs/PLAN-STATUS.md "P3
(integration, 2026-10-11)".

- No page needed `instant = false`: the project layout keeps its P2a opt-out
  (row 26), and acceptance step 15 walked the sibling navigations with no Next
  overlay, error or instant-navigation insight.
- Recents (P3 built this for the tab bar; the layout rework merge moved it to
  recents): the project index `/projects/<id>` is transient like the alias routes
  (`recents.isTransientPath`), so it never becomes a recent. Deleting a cycle, a
  module or a project forgets its recent and every recent under it
  (`recents-store.forgetRecentsUnder` over the pure `recents.removeRecentsUnder`,
  called by `CycleMenu`, `ModuleMenu`, `ArchivedCycles`, `ArchivedModules` and
  `DeleteProjectDialog`; P3's `TabBar.forgetTabsUnder` and
  `tab-registry.dropTabsUnder` are gone). Recent labels of an archived project keep
  its name: the recents tracker reads active and archived projects.
- `CycleHeader`: a completed cycle reads "Completed cycles are read-only." and adds
  the transfer hint only while it has open items.
- `ModuleControl`: an item whose only module is archived shows "No active modules
  in this project" in the empty picker.
- Power K's search input carries an id (`useId`).

### As built (fix round 1, 2026-10-11)

- Power K opens a work item hit as a peek only when the route is a list of the
  item's project (`mountsPeek`) and a `PeekHost` of that project is mounted:
  `PeekHost` counts itself in `src/components/detail/peek-hosts.ts`
  (`registerPeekHost` in an effect, `hasPeekHost`), and `peek-url.workItemHitTarget`
  makes the choice. A cycle or module route that shows `FeatureOffState` or the
  not-found screen keeps its URL but mounts no host, so the hit opens the full page.
- Power K Enter: Astryx keeps a hover highlight when a new query narrows the list.
  `PaletteInput` clears the highlight when the query changes and when it points past
  the end of the list (so `aria-activedescendant` never names a missing option), and
  Enter treats a highlight outside the list as none (`command-source.liveHighlight`)
  and opens the first result.
- `TransferDialog` text comes from `cycle-format.transferText`; a cycle that already
  has a snapshot reads "Its progress was frozen earlier and stays as it was then."
- `ModuleHeader`'s panel toggle has no `aria-pressed` (its label already changes),
  matching the cycle toggle.

### As built (fix round 2, 2026-10-11)

- Modal dialogs and hidden routes: Cache Components keeps a route the user leaves
  mounted under React `<Activity mode="hidden">` (`display: none`). The Astryx
  `Dialog` (and `AlertDialog`) opens its native `<dialog>` with `showModal()` in an
  effect and closes it only when `isOpen` turns false, with no effect cleanup, so a
  dialog open at the moment of a navigation (a chip or the breadcrumb in the modal
  peek, Power K, a link clicked from code, a redirect) stayed in the top layer
  without a box and made the next page inert. `HiddenDialogGuard`
  (`src/components/shell/HiddenDialogGuard.tsx`, mounted by `TesseraShell` in its
  own Suspense boundary) runs `closeHiddenDialogs`
  (`src/components/shell/hidden-dialogs.ts`) after every URL change: it closes each
  open `<dialog>` that has no box. React state is untouched, so Back shows the route
  again and the Dialog's effect reopens it (`showModal()`), the modal peek included.
  Upstream candidate: an effect cleanup in the Astryx Dialog that closes the element.
- Burndown and burnup: the "Today" label sits right of its marker in the first half
  of the cycle and left of it from the middle on (`burndown.todayLabelPosition`), so
  it is no longer clipped by the y-axis when today is the first day.
- Work items toolbar (`WorkItemsScreen`): the row wraps (`wrap="wrap"`), the filter
  keeps `min(16rem, 100%)` and the actions (Display, New work item) move to a line
  of their own at the end, wrapping themselves when the column is narrower still (a
  cycle or module detail beside its side panel, the list beside a side peek).
- The cycles and modules lists and the three archive lists end with
  `paddingBlockEnd={10}`, so the last row's menu scrolls clear of the bottom-end
  toasts and the Next dev indicator.

### As built (review fixes, 2026-10-11)

Fixes from the review before the P3 commit; the hand-off is in
docs/PLAN-STATUS.md "Review fixes, logic and tests".

- Open memberships, quick-add and board drops. Items neither join nor leave an
  archived module (`ARCHIVED`) or a completed (`LOCKED`) or archived (`ARCHIVED`)
  cycle. `quick-add.openMemberships(bundle)` builds `openModuleIds` and
  `openCycleIds` into `QuickAddContext`; `isOpenGroupValue` is false for a module or
  cycle group whose value is not open and true for every other field and the none
  group; `acceptsGroupMove` needs both the old and the new value open.
  `quickAddAllowed` hides the row of such a group in every scope (the E4 text above
  is corrected to match). `BoardLayout.acceptsDrop` refuses a drop into or out of
  such a column or swimlane: no placeholder shows, the card snaps back and no request
  goes out. "Move to" (`moveTargetsFrom`) leaves closed columns out, and a card in a
  closed column has no "Move to" entry. An empty closed column says why: "This module is
  archived, so work items cannot join it." or "This cycle is completed or archived,
  so work items cannot join it." The list layout takes no drops between groups, so
  it needed no change. The engine is unchanged: `filters.loadModules` still lists
  archived modules as groups.
- Cycle rows. `CycleRow` shows completed / (total − cancelled) through
  `module-format.moduleProgressValues`. These are the numbers of the progress panel,
  the summary card and the module rows. `CycleProgressSummary` (list_cycles) carries
  `cancelled` over the same rows as `total` (service-api.md "P3 additions (lane A)").
- Panel toggles while a peek is open. The side peek takes the panel's place, so the
  detail screens pass `isPanelBlocked={peekOpen}` to `CycleHeader` and
  `ModuleHeader`. The toggle is then disabled, keeps its "Show progress" or "Show
  details" label, and its tooltip reads "Close the work item to show progress" or
  "Close the work item to show details".
- Deleting a project. `DeleteProjectDialog` calls `useShortcuts.forgetLastProject`
  after the delete. It removes `tessera.lastProject.v1` when the key names the
  deleted project, so `g i`, `g c`, `g m`, `n c`, `n m` and `c` off-project say
  "Open a project first" instead of opening a not-found route. Archiving keeps the
  pointer: an archived project's routes still render, read-only under the Banner,
  and the layout rework merge kept that (see "As built (layout rework merge,
  2026-10-11)").
- Dialog names. Astryx `Dialog` takes its name from the `DialogHeader` title only
  when the `<dialog>` element attaches. A dialog whose form mounts only while
  `isOpen` is true therefore stayed unnamed. Each such dialog passes an `aria-label`
  equal to its visible title:
  - P3: `CycleDialog` ("New cycle" or "Edit <name>"), `TransferDialog`,
    `AddExistingItemsDialog` (its title), `ModuleDialog` ("New module" or "Edit
    module"), the `ModuleLinks` link dialog and `DeleteProjectDialog` ("Delete
    <name>?");
  - earlier screens: `CreateWorkItemDialog` ("New work item"; the cycle and module
    lists open it too), `CreateProjectDialog` ("New project") and the work item
    `LinksList` dialog ("Add link" or "Edit link").

  Tests: `tests/ui/planning-a11y.test.ts` and `tests/ui/dialog-names.test.ts`.
- Breakdown order. `cycles.breakdownRows` sorts by total descending, then by id.
  `tests/cycles.test.ts` pins the id tie-break: its tied labels reach the breakdown
  in the opposite order of their ids, so a sort by total alone fails the test.
- Not changed: a stray `to` attribute on app anchors. Astryx `LinkProvider` hands a
  custom link component `to={href}` (for React Router), and `next/link` passes
  unknown props on to the `<a>`. `src/app/providers.tsx` uses the documented
  `<LinkProvider component={Link}>` setup. Dropping `to` would need an adapter the
  Astryx docs do not describe, so it waits for a decision or an upstream fix.

### As built (layout rework merge, 2026-10-11)

The layout rework (`claude/app-visual-rework-250c6c`; the "Shell", "Theme" and
"Work items screen" sections above) was merged into `main` over P3. Its shell and
look stay as designed, and every P3 behaviour was ported onto them. Where the two
contradicted, the rework decided look and layout and P3 decided cycles, modules
and archives behaviour. The hand-off is in docs/PLAN-STATUS.md "Layout rework
merge (2026-10-11)". Port rules:

- No tab bar. `TabBar.tsx`, `tab-registry.ts` and `tests/ui/tab-registry.test.ts`
  are deleted. The tab-only gestures (`alt+w`, middle-click close, the tab context
  menu) are gone for good. What P3 gave the tabs now serves the recents (Home's
  "Recent" list and Power K's "Recent" group):
  - Labels and icons: `recents.resolveRoute` has P3's cases ("Routes and data
    loading": the cycle and module lists, their details with the registered name,
    "<project> · Archived work items / cycles / modules" (one label per
    archives tab; P3's single "<project> · Archives" repeated three times in
    Home's list), "Archived projects", the `/cycles/<id>` and
    `/modules/<id>` aliases). `RouteIconKey` adds `cycles`, `cycle`, `modules`,
    `module` and `archives`, drawn by `shell-icons.ROUTE_ICONS` (`CycleIcon`,
    `ModuleIcon`, `ArchiveIcon`). `recents-store` resolves cycle and module names
    through `entityLabel` from the `registerEntityLabel` store.
  - Path guard: `recents.projectIdFromPath` (`/^\/projects\/(?!archives(?:[/?#]|$))([^/?#]+)/`)
    never reads `/projects/archives` as a project, so the sidebar, `useShortcuts`
    and `CommandBar` (all three import it) never scope to "archives".
    `isTransientPath` keeps the aliases, the project index `/projects/<p>` and the
    archives index `/projects/<p>/archives` out of the list; `/projects/archives`
    is a page of its own and is recorded.
  - Forget on delete and archive: `recents-store.forgetRecentsUnder` (over the pure
    `recents.removeRecentsUnder`) drops a route and the routes under it. `CycleMenu`
    and `ArchivedCycles` call it after a cycle delete
    (`/projects/<p>/cycles/<id>`), `ModuleMenu` and `ArchivedModules` after a module
    delete, `DeleteProjectDialog` after a project delete and `ProjectMenu` after a
    project archive (`/projects/<id>`). A work item delete from the detail forgets
    both of its routes (the rework). An archived cycle, module or work item keeps
    its recents: its page still resolves, with the archived Banner.
  - Names: `(tessera)/layout.tsx` reads active and archived projects for
    `RecentsTracker`, so recents of an archived project keep its name.
  - Peeks: `PeekHost` records an item once its peek has loaded (the rework), so
    peeks on a cycle, a module and Archives › Work items become recents of the
    item's full page, like peeks on the work items list.
- Last project: P3's rule stands (P3 decides archives behaviour). Archiving a
  project keeps `tessera.lastProject.v1`, and `ProjectProvider` writes the pointer
  on every project route, archived or not, because an archived project's routes
  still render (read-only, with the Banner; the engine refuses writes with
  `ARCHIVED`). Only a delete clears it, through `forgetLastProject` in
  `DeleteProjectDialog`, when it names the deleted project. A draft of the merge
  that also cleared it on archive was dropped. Archiving does forget the project's
  recents (`forgetRecentsUnder`), since the project leaves the sidebar.
- Panel headers. P3's screens moved from their own header rows (20px inset) onto
  the rework's `PanelHeader` and `PanelBar` (16px inline padding), and their list
  rows line up with that 16px inset:
  - Project frame: one 52px `PanelBar` (project token, name, a hairline, the
    `projectTabs` tabs Work items, Cycles, Modules, Archives) with `ProjectMenu`
    ("Project actions") at its end; `ProjectArchivedBanner` sits under the
    `PanelHeader`, outside the scroller. The sidebar lists projects as flat rows;
    "Projects" is selected on `/projects/archives` too.
  - Cycles and Modules lists: a full-width `PanelPage` whose 44px sub-header holds
    the "Cycles" or "Modules" heading (`Heading level={4} accessibilityLevel={2}`;
    the frame's title is the `h1`) with the count `Badge`, and "New cycle" or "New
    module" at its end.
  - Cycle and module detail: a 44px sub-header (`PanelBar canWrap`) with the name,
    the status and, for cycles, the range and days left at its start, and "Add
    existing", the panel toggle and the menu at its end. The archived Banner and
    the completed cycle's read-only line sit in padded rows under it. The scoped
    work items list below brings its own sub-header ("Work items", the count, the
    layout switch, Display, "New work item" while `canCreate`) and filters row;
    the layout switch and the display menu save to the cycle or module settings
    scope (decision 23).
  - Archives: a `PanelHeader` "Archives" whose sub-header holds `ArchivesTabs`
    (Work items, Cycles, Modules); the lists scroll under it. The strip is pulled
    in by a tab's own 12px (`archives.css`), so the first tab's text sits on the
    16px inset like the titles above and below it.
  - `/projects/archives`: a reading `PanelPage` titled "Archived projects".
  - `/projects`: "Archived projects" (`ArchivedProjectsLink`) and "New project" at
    the end of the Projects panel header.
- Detail: `DetailHeader` keeps the rework's pinned bar (breadcrumbs, Copy link,
  "More actions", "Open as", Close). Its "More actions" menu reads Make a copy,
  Copy ID, then Restore (archived) or Archive (`isDisabled` with the reason while
  the state group is open), then Delete….
- Power K: cycle and module hits open their project route, and its "Recent" group
  leaves out the page on screen and its peek (the rework).
- The two Astryx `ContextMenu` dev warnings listed under "Carried items" (an
  unknown `moveTo` prop; invalid `start` and `cancel` props on a `div`) still appear
  after the merge. They come from the Astryx `Table` (`tableContextMenu`), so they
  show once the work items Table layout renders; they did not come from the tab
  bar. They stay the only tolerated console entries.
- Narrow panels (browser check at 375 and at 1100 with a side peek):
  - Project frame: the token and the name no longer shrink
    (`tessera-project-frame-token`, `tessera-project-frame-title`, the name capped
    at 40% of the row, `shell.css`); the four tabs scroll in the room left. On a
    phone the token had lost its label and the name read "P3 A…".
  - Side panels: the side peek (`tessera-peek-panel`, `detail.css`) and the cycle
    and module side panels (`tessera-planning-side-panel`, `planning.css`) are
    capped at `max-width: 100%`. On a phone the peek's stored width (360–720px)
    pushed More actions, Open as and Close off the screen, and the 360px planning
    panels overflowed by 3px.
  - List rows: the title's minimum share is 14rem (was 16rem), so in the 352px list
    beside a 480px peek at 1100px the title stays beside its key and only the
    properties wrap.
- Fix round 2's "Work items toolbar" note describes P3's own toolbar row. The
  rework's sub-header (`PanelBar canWrap`) and filters row replace it: the actions
  drop under the title when both do not fit, and the filter field takes its own
  row.
