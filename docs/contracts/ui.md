# UI contract

Owner: lane A for this document; the code is split between lanes B (shell), C (work items), D (detail, editor, pages), E (planning), F (views, analytics, settings) and G (AI) per `docs/contracts/OWNERS.md`. Astryx rules in `.cursor/rules/astryx.mdc` apply to every file: no raw `div`/`span` layout, components and tokens only, Phosphor icons through `src/themes/paper/icons.tsx`, no xstyle, no hex, no px except structural widths.

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

Property controls live in `src/components/work-items/properties/` and are reused by the detail panel (lane D) and bulk bar (lane E): `StateControl`, `PriorityControl`, `AssigneeControl`, `LabelControl`, `DateControl` (start or target), `CycleControl`, `ModuleControl`, `EstimateControl` (P8). Each takes `{ value, onChange, bundle?, compact?, readOnly? }` and renders a ghost `Selector` / `MultiSelector` / `DateInput`; state shows a `StatusDot` by group, labels and cycles show `Token` with the palette colour, priority shows the Phosphor priority icon.

Create dialog: `CreateWorkItemDialog` (Astryx `Dialog` + `FormLayout`): name, description (plain `TextArea` until the editor lands in P2b), state, priority, assignees, labels, cycle, modules, dates; "Create more" keeps it open; closing with a dirty form asks "Save this draft?" (P8 wires drafts; until then the dialog just confirms discard). Quick-add: inline row at the bottom of a group / column that creates with that group's value.

Filter bar: Astryx `PowerSearch` tokens for state, priority, labels, assignees, cycle, module, dates, text; the display menu is a `Popover` with `SegmentedControl` for layout and `Selector`s for group / sub-group / order / properties.

## Shell (lane B)

- `(tessera)/layout.tsx`: `AppShell` with `SideNav` (Tessera header, "New work item" button opening the create dialog for the current or last project, search button `mod+k`, workspace items that exist, Favorites (P9), Projects tree with per-project children by feature toggle, bottom items), `TabBar` above the content, `ToastViewport`, `ChangesPoller`. `mod+b` collapses the nav.
- Sidebar data: `listProjects` (with counts) and the sidebar's expanded state in `localStorage` key `tessera.sidebar.v1`.
- `TabBar` + `tab-registry.ts`: path-based tabs, storage key `tessera.tabs.v1`, `resolveTab(pathname, lookup) → { label, icon }`, close via decorative `Icon` inside the `Tab` (no nested button), `alt+w`, middle-click, context menu. Pure functions in `tab-registry.ts` have Vitest coverage.
- `QuickCreate`: global create dialog host so the sidebar button and `n i` shortcut open the same dialog as lane C's screen (lane C exports `CreateWorkItemDialog`; lane B mounts it).
- Home at `/home`: project cards from `listProjects`, "Since you were last here" placeholder card (P5/P9 fill it), recent items (P9).
- Keyboard: `useHotkeys` from `@astryxdesign/core/hooks` (verify the call form in `node_modules/@astryxdesign/core/hooks`); shortcut list per docs/PLAN.md §6.

## Astryx usage rules that caught agents before

- Verify every component's props with `npx astryx component <Name>` or the `.d.ts` under `node_modules/@astryxdesign/core/<Name>` before use; names in the plan marked *check* changed between versions.
- Templates under `node_modules/@astryxdesign/cli/assets/templates/pages/` are reference code under MIT: port them (className + tokens, Phosphor icons), never import or paste them; they use `@stylexjs/stylex` and `@heroicons/react`, both forbidden by `scripts/check-conventions.ts`.
- `Link` goes through Astryx's `LinkProvider` (already configured in `src/app/providers.tsx` with `next/link`).
- CSS lives in `src/components/styles/<area>.css`, imported once from `src/app/globals.css` (one additive `@import` line per area), tokens only.

## Verification per phase

- Vitest for pure helpers (`url-state`, `tab-registry`, the DnD reducer, grouping adapters).
- Browser acceptance through the in-app browser (`.claude/launch.json` → `tessera`) following the numbered steps in docs/PLAN.md §12; the verifier records what it saw with screenshots.
- `npm run check` green; `next build` green with no hydration warnings in the dev console on the screens touched.
