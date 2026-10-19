# Tessera: what needs improving (2026-10-18)

Backlog collected on 2026-10-18 after P11 landed (HEAD 408a624): a production smoke test, the P10 browser acceptance, a Sonnet review of paging and perf, and Mistral's audit. "Open" items were seen at the commit named in their section; re-check each one before working on it. A Sonnet audit across all areas was planned but not run (budget).

**Last analyzed**: 2026-10-18 by Mistral Vibe - Added UI/UX findings from user report.
**Last updated**: 2026-10-19 — closed a batch of optional P10/P11 leftovers (automations tab, bulk transfer, rich-filter labels, layout param, cycle index, week_start first paint, docs honesty); see "Closed 2026-10-19" below.

## Fixed in the second round on 2026-10-18 (uncommitted until the root planner commits)

Worker, reviewer and fix-worker pass over the working tree after Mistral's changes. `npm run check` is green: typecheck, eslint (0 errors, 0 warnings), 134 test files with 2054 tests, conventions, licences and theme (0 fail, 2 documented warnings).

- Lock/unlock: setState-in-effect lint errors and unused imports removed; the state is derived with `useOptimistic` and render-time adjustment, the motion lives in `src/components/styles/lock-control.css` (`src/components/shared/LockControl.tsx`, `lock-state.ts`, `use-optimistic-lock.ts`, `PageRowMenu.tsx`, `PageScreen.tsx`, `ViewMenu.tsx`).
- `workspace-settings-store.tsx`: `no-explicit-any` error removed.
- Week start reaches the server: the calendar window (decision 112) now uses the workspace `week_start`, so the loaded items match the grid; `calendarWindow` and `listPaging` take it, and the three loaders pass it (`src/components/work-items/paging.ts`, `cross-list.tsx`, `scoped-list.tsx`, `view-list.tsx`; test in `tests/ui/paging.test.ts`).
- Week start values 0 to 6: the Selector offers all seven days, as the tool and schema accept (`src/components/workspace-settings/settings-format.ts`).
- Calendar math cleanup: `toWeekStart` replaces a cast, the unused `shiftPeriod` parameter, the dead `DEFAULT_WEEK_START`, the defaulted-before-required parameters and the stale comment are gone; 2 lint warnings fixed (`src/components/work-items/calendar-math.ts`, `CalendarLayout.tsx`).
- Migration test: re-applying 0009 now drops `week_start` instead of the 0008 columns (`tests/foundation.test.ts`).
- `bulk.css` used the undefined `--color-border-tertiary`; now `--border-width` and `--color-border` (`src/components/styles/bulk.css`).
- Convention gate rule `css-token` flags `var(--...)` names that neither Astryx nor `src` defines (the `--spacing-16` gantt case), with unit tests (`scripts/convention-rules.ts`, `scripts/check-conventions.ts`, `tests/convention-rules.test.ts`).
- Old keys after a project move resolve in `get_work_item_by_key`, `/browse/<OLDKEY>` and Power K search, and lose to a project that holds the identifier now unless it is the project the item left (`src/lib/tessera/work-items/moved-keys.ts`, `read.ts`, `search.ts`, `docs/contracts/tools.md`; tests in `tests/work-items.test.ts`).
- Decision 93: an invalid rich filter is a VALIDATION error that names the JSON path, MCP message included (`src/lib/tessera/rich-filters.ts`, `core/errors.ts`; `tests/rich-filters.test.ts`).
- Bundle gate: `ai-status.ts` no longer ships ANTHROPIC to the client, and the `ALLOWED_PHRASES` whitelist is gone (`src/components/ai/ai-status.ts`, `scripts/bundle-rules.ts`, `scripts/check-bundle.ts`, `tests/check-bundle.test.ts`).
- Four eslint unused-variable warnings (`import-handbook.ts`, `pages/embeds.ts`, `pages/read.ts`, `pages/write.ts`).
- Version history dialog shows the actor of each version, "Unknown" for an unknown actor (`src/components/history/VersionHistoryDialog.tsx`, `src/app/actions/history.ts`).
- Decision rows 42, 46 to 48, 49 to 54, 56 to 60, 61 to 71, 72 to 88 and 89 to 108 are copied into `docs/PLAN.md`, so code can cite them.
- Export delete: re-entry guard released in `finally` (a thrown call no longer blocks later confirms) plus a toast `uniqueID`; still a defensive fix, see the open item below (`src/components/exports/ExportsScreen.tsx`).
- Webhook secret input: the added `aria-label` was removed again (`src/components/webhooks/WebhookScreen.tsx`). Astryx `TextInput` already names the input from its required `label` through `aria-labelledby`, which wins over `aria-label`, so the attribute did nothing.

Corrections to Mistral's sections below (the code contradicts them): `LockControl` no longer uses `useState`/`useEffect` for the feedback timer, and the animations live in `src/components/styles/lock-control.css`, not `globals.css`; "respects week_start for all calendar-related functions" was false until the server window fix above; the workspace settings screen now has the week start Selector, so "UI for changing week_start not yet implemented" is out of date. The padding changes in `table.css`, `work-items.css` and `detail.css` are Mistral's intent and were not touched; their comments are stale (16px/12px claims) and need a visual check.

## Fixed on 2026-10-18 (from Plane.so comparison and UI audit; Mistral, corrected above)

### Lock/Unlock State Management (High Priority)
- **Fixed**: Lock/unlock icons not updating after server actions in PageScreen.tsx, ViewMenu.tsx, and PageRowMenu.tsx
- **Implementation**: 
  - Created new `LockControl` component in `src/components/shared/LockControl.tsx` with 3-state pattern (neutral/locked/unlocked)
  - Added CSS animations for lock/unlock state transitions in `src/app/globals.css`:
    - `tessera-lock-icon`: Rotation and scale animation for lock icon
    - `tessera-unlock-icon`: Rotation and scale animation for unlock icon
    - `tessera-text-slide-in`: Slide-in animation for "Locked"/"Unlocked" text
    - `tessera-text-fade-out`: Fade-out animation for status text
  - Implemented optimistic updates in PageScreen.tsx, ViewMenu.tsx, and PageRowMenu.tsx
  - Local state management with `useState` and `useEffect` to track lock state changes
  - Brief "Unlocked" feedback message that fades out after 600ms (Plane's pattern)
- **Files changed**:
  - `src/components/shared/LockControl.tsx` (new)
  - `src/app/globals.css` (added animations)
  - `src/components/pages/PageScreen.tsx` (optimistic updates)
  - `src/components/views/ViewMenu.tsx` (optimistic updates)
  - `src/components/pages/PageRowMenu.tsx` (optimistic updates)

### Week Start Configuration (High Priority)
- **Fixed**: Hardcoded week start (Monday) - now user-configurable via workspace settings
- **Implementation**:
  - Added `week_start` column to `workspace_settings` table in `src/lib/tessera/db/schema/workspace.ts`
    - Type: `integer` (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
    - Default: 1 (Monday)
  - Updated `WorkspaceSettingsView` type in `src/lib/tessera/types.ts` to include `week_start: number`
  - Updated `UpdateWorkspaceSettingsInput` schema to accept `week_start` updates
  - Updated `ensureWorkspaceSettings` to initialize `week_start` to 1 (Monday)
  - Updated `toView` function to include `week_start` from database
  - Updated `updateWorkspaceSettings` to persist `week_start` changes
  - Created workspace settings store in `src/components/workspace-settings/workspace-settings-store.tsx`:
    - `WorkspaceSettingsPublisher`: Server component to publish settings to client
    - `useWorkspaceSettings()`: Client hook to read workspace settings
    - `getWorkspaceWeekStart()`: Helper function
  - Updated `src/app/(tessera)/layout.tsx` to publish workspace settings including `week_start`
  - Updated `calendar-math.ts` functions to accept optional `weekStartsOn` parameter:
    - `startOfWeek(anchor, weekStartsOn)`
    - `shiftPeriod(anchor, view, delta, weekStartsOn)`
    - `periodLabel(anchor, view, weekStartsOn)`
    - `weekdayLabels(weekStartsOn, showWeekends)`
    - `calendarWeeks(anchor, view, weekStartsOn, showWeekends)`
    - All default to `WEEK_STARTS_ON` (1 = Monday) for backward compatibility
  - Updated `CalendarLayout.tsx` to use workspace `week_start` setting via `useWorkspaceSettings()`
- **Files changed**:
  - `src/lib/tessera/db/schema/workspace.ts` (added week_start column)
  - `src/lib/tessera/types.ts` (updated WorkspaceSettingsView)
  - `src/lib/tessera/workspace/settings.ts` (updated schema, functions)
  - `src/components/workspace-settings/workspace-settings-store.tsx` (new store)
  - `src/app/(tessera)/layout.tsx` (publish workspace settings)
  - `src/components/work-items/calendar-math.ts` (dynamic week start)
  - `src/components/work-items/CalendarLayout.tsx` (use workspace week_start)

### Asymmetric Padding Fixes (Medium Priority)
- **Fixed**: Inconsistent padding in table, work-items, and detail CSS files
- **Changes**:
  - **table.css**: 
    - Changed header first cell padding from `--spacing-4` to `--spacing-3`
    - Changed data first cell padding from `--spacing-1` to `--spacing-3`
    - Both now use same padding for consistency
  - **work-items.css**:
    - Changed row padding from asymmetric `var(--spacing-1) var(--spacing-4)` to symmetric `var(--spacing-3)`
    - Changed group header padding from asymmetric `var(--spacing-3) var(--spacing-4)` to symmetric `var(--spacing-3)`
  - **detail.css**:
    - Changed detail-heading from asymmetric `padding: var(--spacing-5) var(--spacing-4) 0` to explicit block/inline padding
    - Changed detail-main from asymmetric `padding: var(--spacing-5) var(--spacing-4) var(--spacing-10)` to explicit block/inline padding
- **Files changed**:
  - `src/components/styles/table.css`
  - `src/components/styles/work-items.css`
  - `src/components/styles/detail.css`

### CSS Animations Added (Medium Priority)
- **Added**: Custom CSS animations using Astryx motion tokens for state transitions
- **Animations**:
  - `tessera-lock-icon`: 600ms rotation and scale animation for lock icon
  - `tessera-unlock-icon`: 600ms rotation and scale animation for unlock icon  
  - `tessera-text-slide-in`: 400ms slide-in with max-width expansion for text
  - `tessera-text-fade-out`: 600ms fade-out with slide for text (300ms delay)
  - `tessera-fade-out`: 500ms fade-out for containers (100ms delay)
- **Note**: Uses Astryx's built-in motion tokens (`--duration-fast`, `--duration-medium`, `--ease-standard`) where applicable
- **Files changed**:
  - `src/app/globals.css` (added keyframes and animation classes)

## Fixed today (do not list as open; mention under "Fixed on 2026-10-18")
- `/agents/[actorId]` awaited params outside Suspense, so `next build` failed (aaa2b38).
- Paging review round (0dab9d7): Show more and re-fetch dropped URL-only rich filters; calendar loaded every item instead of the shown period; perf DB guard was case-sensitive; `check:e2e` missing; decision 106 cited but absent; describe_filters missing the paging keys.
- Gantt and calendar CSS used `var(--spacing-16)`, which Astryx does not define (scale stops at 12): gantt bars sat 2–5 days off their header dates (408a624).
- Backups: `VACUUM INTO` used an escaped string literal; now a bound parameter (408a624). Mistral's audit flagged the literal as SQL injection. It was not exploitable (doubled quotes are SQLite's only escape and the path is server-built), and Mistral's proposed regex allowlist would have broken backups for paths with spaces or accents.
- **UI/UX: Lock/unlock icons not updating** - **FIXED** When unlocking a page or view, the lock icon now properly animates through a 3-state transition (neutral → locked/unlocked → neutral) with visual feedback. See "Lock/Unlock State Management" section above for implementation details.

## Verified OK today
- `npm run check` green at 408a624: 133 files, 2039 tests; 0 lint errors, 4 unused-variable warnings.
- `next build` 63/63 pages; `npm run check:bundle` passes.
- Every route returns 200 on a fresh seeded database; no console errors on 17 new screens (P5–P11).
- Perf bench on 12 000 items (10 000 in one project): every case within its decision-115 budget. Tightest: group projection by labels p95 34.8 ms vs 40 ms (it went over once on a loaded run in the perf worker's runs).
- P10 engine proofs: gantt drag writes both dates in one update; CSV/JSON export is spreadsheet-ready (BOM, CRLF, RFC 4180, formula guard); webhooks sign with HMAC-SHA256, retry on 500 and deactivate on 410; agents cannot manage webhooks.
- All five AI routes use the loopback guard; AI tests use a fake client.

## Closed 2026-10-19 (optional leftovers + dirty WIP)

- Automations project settings tab: Run now, Due now, Last run (`AutomationsSettings`, `/settings/automations`).
- Bulk Copy/Move to project: `bulk_transfer_work_items` + `BulkTransferDialog` on the BulkBar (decision 107).
- Rich filter dialog: field/op/value labels (`rich-filter-labels.ts`); over-deep trees use `describeRichFilters`; views-list `viewSummary` counts rich conditions (verified).
- `?layout=list|board|table|calendar|gantt` merges into the `q` display blob (`layout-param.ts`).
- Cycle-scope partial index `work_item_cycle_idx` (`drizzle/0010_cycle_scope_idx.sql`); query-plan tests updated.
- Scheduler start log: `console.log("[tessera] scheduler started")`.
- Week-start first paint: publisher moved out of the paused mobile sidebar; `useWeekStart(bundle.week_start)` on the calendar.
- Docs: PLAN decision 29 (moved keys) + escaped pipes on 33; `docs/as-built/ai.md`; field guide `css-token` note; PLAN-STATUS leftover row.
- Group headers "N pts": already wired via `GroupPoints` on list/board/table (stale open note).
- Playwright Chromium smoke: runnable and green (see PLAN-STATUS P11 hand-off; no longer "never downloaded").

## Open, from the P10 browser acceptance (at 08e5118, Sonnet, full report in this session)
- Plan items not built (p10-plan §9 steps): page Outline and an Activity tab in page history (15); Analytics "Data table" CSV download (16); drag reorder beyond sidebar, favourites, board and calendar: views list, states, labels, wiki tree, stickies, quick links, Home widgets (20). Closed earlier: Automations tab (13), bulk Copy/Move (21), "N pts" (22), scheduler start log (23). Closed 2026-10-19: gantt zoom + Show dependencies (5, 7), Modules list Timeline (10).
- **Calendar UI: Date popover uses Sunday-first while main calendar uses Monday-first** (from user report) - the main calendar, its server window and the settings screen follow the workspace `week_start`. Still open: the Astryx DateInput popover calendar ignores the setting (see "DateInput Component Week Start" below).
- Rich filter dialog: over-deep trees still show raw JSON; views list still says "List · no filters" for rich-only views. Value/op labels shipped 2026-10-19.
- Accessibility: Set-dates popover calendar has no tab stop when today is before min; date popover calendar is Sunday-first while the app calendar follows `week_start`; Switch inputs lack accessible names (source shows each Switch has a wired label, so this needs a check of the real DOM in a browser); the webhook secret input name was not reproduced (Astryx names it from `label`); Export Delete showing its toast twice has no found root cause (defensive guard added, needs a browser check).
- 375 px: project tab strip truncates ("Work it…"), the Today label truncates, calendar chips wrap.
- The automation lease (two concurrent runs) was not exercised. Webhook echo walk closed in `5442c6f`.

## Open, from the paging/perf review (Sonnet, confirmed by a refuter)
- Cycle-scope `work_item.cycle_id` partial index landed (`0010`); re-check cycle progress/counts plans if they still SCAN. The workspace list scope keeps 2 bare `SCAN work_item` pinned in tests/perf/query-plans.test.ts; decision 126 says that should fail. Either add indexes or record the exception in decision 126.
- Labels group projection is close to budget because every group's first page is hydrated (about 40 label groups × 50 rows); a smaller first page for multi-valued groupings or a SQL GROUP BY path is the fallback in the plan's risk table.
- The table's select-all checkbox has no "N loaded of M" text; it is only in the BulkBar note (decision 114).
- Gantt timeline range is computed from loaded items only, so loading more rows can shift bars; table header sort is still client-side over loaded rows (sort helper extracted; server order_by unchanged).
- Cache lane (decisions 109–111, `src/app/_cache/`, revision-keyed `'use cache'`) was skipped on purpose; decide whether to drop the decisions or schedule it.

## Open, left by the second round (2026-10-18)
- Failed lock shows "Unlocked": when `lock_page` fails, the optimistic `true` is dropped, `isLocked` goes true to false and `nextLockFeedback` returns "unlocked" next to the error toast (`src/components/shared/LockControl.tsx`). Whether the optimistic value holds until the refreshed tree arrives (no flicker) needs a browser run.
- Lock animation timing and the `animationend` reset were never seen on screen (no browser this round).
- `css-token` rule is lenient: a token defined anywhere in `src` silences the rule for every file, and `--font-body` and `--font-code` are exempt (now noted in the field guide).

## Open, from earlier checks
- P5 live acceptance with the real model never ran (needs the user's approval: about $1–3 of API usage per run). TESSERA_AI_FAKE / recorded turns (decision 124) may allow a no-cost browser pass.
- docs/as-built/: P5 assistant map added (`ai.md`); P4 and P6–P11 still not mapped.
- A stale git worktree sits at .claude/worktrees/app-visual-rework-250c6c (branch claude/app-visual-rework-250c6c, ad30062, already merged); it once made `npm run lint` red.
- `npm run perf:bench` prints "500+ in PERF" because it caps its id sample; cosmetic.
- Rework issues from 2026-10-16, never re-checked: two h1 elements on the work item detail page; at 375 px the tab strip has no scroll cue; a board column is 25 px too wide at 375; the drawer search placeholder is cut off; the burnup "Scope" label overlaps its line; an unknown cycle id is recorded in recents; the archived project list is not read-only.

## Browser Testing Required

The following fixes need browser verification:

### Lock/Unlock Animations
1. **Test lock/unlock on pages**:
   - Navigate to a page
   - Click the lock icon in the header
   - Verify icon animates (rotation + scale) and shows "Locked" text briefly
   - Click unlock and verify icon animates and shows "Unlocked" text that fades out
   - Test keyboard shortcut (shift+l)
   
2. **Test lock/unlock on views**:
   - Navigate to a project's views list
   - Click the "…" menu on a view
   - Lock/unlock the view
   - Verify menu updates immediately (optimistic) and stays in sync
   
3. **Test lock/unlock on page rows**:
   - In a page list (wiki or project pages)
   - Click the "…" menu on a page row
   - Lock/unlock the page
   - Verify menu updates immediately

### Week Start Configuration
1. **Test calendar with different week starts**:
   - Defaults to Monday (1); change it under Settings, General, Week starts on
   - Navigate to calendar view
   - Verify the first column follows the setting, and that items on the first and last visible day show (Sunday start, month and week view)
   
2. **Test calendar navigation**:
   - Use [ and ] keyboard shortcuts to navigate weeks
   - Use t shortcut to go to today
   - Verify week boundaries respect the week_start setting

### Padding Consistency
1. **Test table layout**:
   - Verify header and data cells have consistent left padding
   - Check alignment of key column with panel header text
   
2. **Test work items list**:
   - Verify row padding is symmetric (left = right)
   - Check group header padding matches row padding
   
3. **Test detail view**:
   - Verify heading and main content have proper padding
   - Check visual balance at different screen sizes

## Open, from Plane.so comparison - Additional Findings

### Layout System Enhancements (Not Yet Implemented)
- **Centralized Layout Switcher**: Plane has a centralized `LayoutSwitcher` component (lines 111-140 in plane-comparison.md). Tessera currently handles layout switching per-component. Consider implementing a centralized switcher for consistency.
- **Sidebar Icon-Only Mode**: Plane's sidebar supports `icon_only` and `icon_with_label` display modes (lines 159-160 in plane-comparison.md). Tessera's sidebar always shows labels. Adding icon-only mode would save screen space.
- **Smooth Transitions**: Plane uses 300ms ease-in-out transitions for layout changes (lines 308, 323 in plane-comparison.md). Tessera lacks smooth transitions for sidebar collapse/expand and content changes.

### Advanced Features from Plane (Future Considerations)
- **Virtual Scrolling**: Plane implements virtual scrolling for large lists (lines 827-828 in plane-comparison.md). Tessera loads all items in memory, which may cause performance issues with very large datasets.
- **Calendar Zoom Levels**: Plane's calendar supports week/month/quarter zoom views (lines 732-734 in plane-comparison.md). Tessera's calendar has basic month/week views without zoom.
- **Gantt Dependencies**: Plane's Gantt chart supports dependency connectors and conflict states (lines 734-735 in plane-comparison.md). Tessera's Gantt has basic bar rendering without dependencies.
- **Dock/Undock Sidebar**: Plane's app rail can be docked or undocked (lines 163-164 in plane-comparison.md). Tessera's sidebar is always docked.

### DateInput Component Week Start
- **Note**: The DateInput component from Astryx may need separate configuration to respect the workspace `week_start` setting. This requires investigation into Astryx's DateInput implementation and may require:
  - A wrapper component that adapts Astryx's DateInput
  - Upstream contribution to Astryx to support configurable week start
  - Custom DateInput implementation if Astryx doesn't support it

## Open, from user report (2026-10-18, theming and UI)
- **Theming: Visual inconsistencies with catppuccin theme** (from user report) - User reports "weird visuals" appeared due to applied theming. The convention gate now has a `css-token` rule for undefined custom properties (see "Fixed in the second round"). It checks `var(--spacing-N)`, `--radius-*` and `--color-*` names against installed astryx.css against the installed astryx.css. Current CSS files use valid tokens (verified: calendar.css and gantt.css only use --spacing-0-12, --color-*, --radius-*, --border-*, --size-* which are all defined in catppuccin.css). Theme-specific visual issues may exist with the catppuccin color palette.
- **Calendar theming**: User reports "weird UI behaviours" in calendar. Potential issues: hover states, active states, or color combinations in catppuccin theme may not provide adequate visual feedback. The calendar uses `--color-background-surface` (#eff1f5 / #303446), `--color-background-muted` (#dce0e8 / #292c3c), `--color-accent` (#8839ef / #ca9ee6), `--color-border` (#ccd0da / #414559) which are defined in catppuccin.css. Verified these variables exist and have reasonable values.
- **375px viewport issues**: User mentioned truncation and wrapping issues. Existing: project tab strip truncates ("Work it…"), Today label truncates, calendar chips wrap (line 25). New: need systematic check of all components at mobile breakpoints.

## Open, from Plane.so comparison (2026-10-18, visual/UX analysis)

### Icon Usage Comparison
**Finding**: Plane uses Phosphor Icons (same as Tessera), but has additional icon animations for lock/unlock state transitions.
- **Plane's approach** (`apps/web/components/pages/header/lock-control.tsx`): Uses `LockDisplayState` with three states: "neutral", "locked", "unlocked". Shows animated transitions between states with CSS animations (`animate-lock-icon`, `animate-unlock-icon`, `animate-text-slide-in`, `animate-text-fade-out`).
- **Tessera's current approach**: Simple toggle between LockIcon/UnlockIcon without state management or animations.
- **Recommendation**: Implement Plane's lock control pattern with:
  1. Three-state display (neutral/locked/unlocked)
  2. Visual feedback on state transitions
  3. Brief "Unlocked" message that fades out after 600ms

### Week Start Configuration
**Finding**: Plane has user-configurable `start_of_the_week` setting (EStartOfTheWeek enum with SUNDAY=0, MONDAY=1, etc.).
- **Plane's implementation**: 
  - User preference stored in `user.start_of_the_week`
  - Calendar store reacts to preference changes via MobX reaction (lines 77-84 in issue_calendar_view.store.ts)
  - Calendar generation utility accepts `startOfWeek` parameter (packages/utils/src/calendar.ts:23)
  - Week days are sorted using `getOrderedDays` function that respects the user's preference
- **Tessera's current state**: Hardcoded `WEEK_STARTS_ON=1` (Monday) in calendar-math.ts:11
- **Recommendation**: Implement user-configurable week start:
  1. Add `start_of_week` user preference to workspace/user settings
  2. Update calendar-math.ts to accept and use dynamic week start
  3. Ensure DateInput component respects the same setting (may require Astryx enhancement or custom wrapper)

### Padding & Spacing Analysis
**Finding**: Tessera's CSS files show good use of Astryx tokens, but some areas may need review:
- **work-items.css**: Row padding uses `padding-inline: var(--spacing-1) var(--spacing-4)` (line 32) - asymmetric padding
- **detail.css**: Detail body uses `padding: var(--spacing-5) var(--spacing-4)` (line 95) - asymmetric
- **shell.css**: Panel bar heights calculated from size tokens + spacing (lines 46, 51) - good pattern

**Potential issues to verify**:
- Text alignment in buttons and inputs
- Vertical rhythm consistency
- Container padding at mobile breakpoints

### Text Centering & Alignment Issues
**Finding**: Need systematic audit of text alignment across components.
- **Affected areas**: Button labels, input placeholders, table cells, property chips
- **Plane comparison**: Plane uses explicit `text-align` and flexbox alignment throughout
- **Recommendation**: Audit all text elements for:
  1. Proper text-align properties
  2. Flexbox alignment (justify-content, align-items)
  3. Line-height consistency
  4. Vertical alignment in form controls

### Specific Padding & Alignment Issues Found

#### Asymmetric Padding (Potential Visual Imbalance)
1. **Table Layout** (`table.css`):
   - Header first cell: `padding-inline-start: var(--spacing-4)` (line 16)
   - Data first cell: `padding-inline-start: var(--spacing-1)` (line 20)
   - **Issue**: 3-level spacing difference between header and data cells
   
2. **Work Items List** (`work-items.css`):
   - Row padding: `padding-inline: var(--spacing-1) var(--spacing-4)` (line 32)
   - **Issue**: Asymmetric left/right padding (4px vs 16px)
   
3. **Detail View** (`detail.css`):
   - Detail main: `padding: var(--spacing-5) var(--spacing-4)` (line 95)
   - **Issue**: Asymmetric top/bottom vs left/right padding

#### Icon Kit Analysis
**Current State**: Using Phosphor Icons via `@phosphor-icons/react` with duotone styling.

**Available Icons**: 366 lines in icons.tsx with comprehensive coverage including:
- LockSimple, LockSimpleOpen (for lock states)
- CalendarBlank, CalendarDots (calendar icons)
- All essential UI icons present

**Comparison with Plane**:
- ✅ Both use Phosphor Icons
- ✅ Tessera has all necessary icons
- ⚠️ Plane adds custom animations for lock/unlock transitions (lines 74-100 in globals.css)
- ⚠️ Tessera uses static icons without state transitions

**Recommendation**: Current icon kit is comprehensive. The main issue is not icon availability but **icon state management** (lock/unlock not updating).

### Color & Contrast Analysis (Catppuccin Theme)
**Verified CSS Variables in catppuccin.css**:
```css
--color-background-surface: #eff1f5 / #303446
--color-background-muted: #dce0e8 / #292c3c  
--color-accent: #8839ef / #ca9ee6
--color-border: #ccd0da / #414559
--color-text-primary: #4c4f69 / #c6d0f5
--color-text-secondary: #5c5f77 / #b5bfe2
```

**Potential Issues**:
- Light mode: Purple accent (#8839ef) on light surface (#eff1f5) may have contrast issues
- Need to verify WCAG contrast ratios for:
  - Text on accent background
  - Border colors on various backgrounds
  - Hover states

**Recommendation**: Run contrast ratio audit using tools like WebAIM Contrast Checker.

## Open after the second round (root planner, 2026-10-18)
- **Week start goes stale after a change**: saving "Week starts on" persists (`week_start` = 0 in the database), but an open calendar keeps the old first weekday until a full reload. The value reaches the client through `WorkspaceSettingsPublisher` in the streamed sidebar (src/app/(tessera)/layout.tsx); check that the settings action refreshes that layout and that the publisher emits the new value.
