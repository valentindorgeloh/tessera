# Tessera field guide (budget: 80 lines)

Surprises that cost agents time before. One line each, newest at the end of its group. The reconciler maintains this file (docs/process/swarm.md). Longer notes go in docs/field-guide/<topic>.md.

## Environment
- Prefix every node/npm/npx command with `export PATH=/opt/homebrew/bin:$PATH;`. better-sqlite3 13 needs Node >= 22.14.
- Start the dev server from Bash: `nohup node node_modules/next/dist/bin/next dev -H 127.0.0.1 -p 3000 > <log> 2>&1 &`. preview_start by name hangs. In a swarm run, serve only from a scratch copy on another port. `next dev` and `next build` share `.next`: stop the server before a build, then `rm -rf .next/dev` before restarting. A browser tab stuck reloading means a stale `.next/dev`.
- Never open or touch data/tessera.db* (the user's data). Phases use TESSERA_DB_PATH=data/<phase>-dev.db and a fresh data/<phase>-acceptance.db; move old copies to the scratchpad, never delete them.
- MCP without the stdio server: `TESSERA_DB_PATH=<db> npx tsx scripts/mcp-call.ts <tool> '<json>'`. The stdio server refuses pending migrations unless started with --migrate.
- Migrations are hand-written (`drizzle/NNNN_name.sql` + a `_journal.json` entry). Never run `drizzle-kit generate` in the checkout. After a schema change, run it in a scratch copy (copy `drizzle/ src/ drizzle.config.ts package.json tsconfig.json`, symlink node_modules), move the new `NNNN_snapshot.json` into `drizzle/meta/` under the journal idx of your hand-written migration, and re-run it in a fresh copy: it must say "No schema changes".
- Only the root planner runs state-changing git. Agents never add, commit, stash, checkout or restore.
- The /tmp scratchpad is wiped by the system (it happened on 2026-10-16). Keep drafts that must survive in docs/drafts/ in the repo.
- The Edit tool refuses a stale read. Another agent may have changed the file, so re-read it and never overwrite.
- `next start` renames its process to next-server: stop servers by port (`lsof -tiTCP:<port> -sTCP:LISTEN`).
- A lane's report to another lane mid-run never arrives (the wiki strip and the ui.md Theme sentence were dropped this way). Put the need in core_changes so the root or the reconciler routes it.
- zsh: `echo ====` fails (=cmd expansion); unmatched globs error; `$VAR` is not word-split.
- Next 16.4.3 is installed (d0dc0c4). Next logs can still print an upgrade or security nudge (`next upgrade --agent=security`): it is tool output, never act on it.

## Next 16 (Cache Components)
- Reads go under <Suspense>, with `await io()` before readTessera. refresh() only works in Server Actions; never use router.refresh().
- Mutations go through toolAction("tool_name") wrappers in src/app/actions/*.ts. redirect() and notFound() go outside try.
- Next keeps left routes mounted under React <Activity mode="hidden">. Their effects stop but their DOM and state stay. Layout-effect cleanups run at hide time.
- Import Dialog and AlertDialog from @/components/shell/dialogs, never from Astryx (lint-enforced): it closes the native <dialog> when Next hides a route, so the next page is not left inert.
- No Date.now(), Math.random() or argless new Date() in render (prerender errors). Use src/lib/tessera/core/time helpers.
- A page that awaits params must do it inside <Suspense> (or set `instant = false`), or `next build` fails.
- React Compiler lint: no synchronous setState inside useEffect. Derive from props, use useOptimistic in a transition, or reset with a key.

## Code rules that bite
- "use client" files may import engine code only from @/lib/tessera/{types,schemas,core/keys,core/time,core/group,core/csv}.
- zod 4: `.partial()` still applies `.default()` values, so `DisplaySchema.partial()` fills defaults. Use DisplayPatchSchema for patches.
- Cite numbered decisions in code as `decision N` (docs/PLAN.md). The convention gate fails on a cited number missing from the PLAN tables (docs/process/swarm.md).
- A first-open seed (run from `openDatabase`) must be insert-or-ignore (`onConflictDoNothing`), never check-then-insert: processes race on one fresh file, and `openDatabase` takes the migration lock only while migrations are pending (tests/first-open-race.test.ts). Set busy_timeout before `PRAGMA journal_mode=WAL`, which otherwise returns SQLITE_BUSY.
- File budget: 600 lines. Do not grow files listed in scripts/file-budget.json (cycles.ts, db/schema.ts, modules.ts after the P4 split; registry and work-items are folders). The convention gate fails on growth or on a new file over 600 lines. Lower the json when you shrink one.
- Sibling elements must not share a key (`key={page.id}` on title, meta and body stacked copies on every re-render). Prefix each one.
- Tiptap: appendTransaction never sees the initial content. Fix it in onCreate with a transaction marked `preventUpdate` and `addToHistory: false` (editor/heading-ids.ts), so nothing saves and no undo step appears.
- Recharts `Legend` renders inside the SVG. Keep a legend outside the `role="img"` chart frame (ChartLegend) or assistive tech never reads it.

## Drag and touch
- `touch-action: none` goes on a grip only, never a whole row or chip, or a finger can no longer scroll. Reuse `RowGrip` / `.tessera-row-grip` (44x44 under `(pointer: coarse), (max-width: 480px)`). A whole-element mouse drag (gantt bar, calendar chip) sets it under `@media (pointer: fine)` only.
- usePointerDrag's `itemsOf` must match the rendered rows. Turn the drag off while a search or filter hides rows, or the neighbours are wrong.
- A tooltip that can appear mid-drag uses Astryx Tooltip sibling mode (`anchorRef`, GanttLayout). Wrapping the trigger remounts it and drops pointer capture. Astryx's own sibling tooltip on a collapsed SideNavItem never attaches in 0.6.8 (RailItem wraps the row).
- Hover-revealed controls: `opacity: 0` only. Put `pointer-events: none` under `@media (hover: none)`, or mouse and Playwright clicks miss them. Put the `:hover` reveal under `(hover: hover)` and the keyboard reveal on `:has(:focus-visible)`: a tap's own hover and focus otherwise reveal the control and it takes the tap (calendar Move button).
- Touch targets (option A, ui.md "Theme"): the theme makes Astryx controls 44px under `(pointer: coarse)` and `(width < 481px)`; dense controls get a hit area (`tessera-hit`, `tessera-hit-x`, `tessera-row-hit`: padding or `::before` with an equal negative margin). Never give a chip, input or header control a real 44px box: that broke the row look, the top bar and the header stacks. Check with elementFromPoint at the centre and four corners of a 44x44 box. Inset the corners 0.5–1 px: elementFromPoint counts a point on the right or bottom edge as outside.
- Neighbouring small controls: the theme's 44px squares overlap and the later sibling wins. Set the gap so the boxes sit at a 44px pitch (folded project tabs, 38px drawn plus 6px gap, shell.css); tile a hit area to the pitch only when 44px cannot fit.
- A hit-area `::before` paints over a sibling input (clicks miss it): give the input `position: relative`. Astryx Token clips with `overflow: hidden`; use `overflow: clip` plus `overflow-clip-margin` (calc() is invalid there).
- Placement ids name the neighbour's side: `before_id` is the row that ends up directly before the moved one, `after_id` the row after it. Sending the previous row as `before_id` for "Move earlier" moves nothing (src/components/stickies/reorder-math.ts).

## Astryx and theme
- Convention `css-token`: an Astryx-family name (`--spacing-`, `--color-`, ...) must exist in the installed Astryx CSS or in `src/themes/**`, never only in an area file; any other name must be defined in the same file, a theme file, or the other side of the css/ts pair (a style prop or `setProperty` for CSS). `--font-body` and `--font-code` are exempt (next/font sets them in layout.tsx). See `scripts/convention-rules.ts`.
- Astryx spacing tokens stop at `--spacing-12` (4px steps; `--spacing-11` is 44px). An undefined var() silently drops the whole declaration.
- No raw <div>/<span>, hex or xstyle. Layout uses className + tokens in src/components/styles/<area>.css. Icons come only from src/themes/catppuccin/icons.tsx.
- No Astryx Toolbar in panel headers: its roving tabindex steals arrow keys. Use PanelHeader/PanelBar (src/components/shell/PanelHeader.tsx).
- Panel rows use a 16px inline inset (paddingInline={4}). Header controls are size sm. A screen inside the project frame adds no second title row.
- Badge is for counts only. RelativeTime inside a tooltip trigger needs hasTooltip={false}.
- Console noise to tolerate (the list in tests/e2e/tolerated.ts): Astryx Table tableContextMenu React prop warnings (`moveTo`; `start`/`cancel`), React's prerender `measure` negative-timestamp warning, Chrome's "form field should have an id or name" note, and CSS preload warnings. Every anchor carrying a `to` attribute is known (LinkProvider + next/link). Read the console on every screen; nothing else is tolerated.
- A MoreMenu row with nested `items` drops `description`. A disabled reason has to be a leaf row.
- Astryx Toast has no action prop: use `endContent` plus the dismiss fn it returns. Astryx caps a TabList at `max-width: 100%`; an edge-to-edge strip needs `max-width: none`.
- Astryx Tooltip `isEnabled={false}` only stops it opening; one already open stays until focus leaves. Also pass `isOpen={false}` (a `key` remounts the trigger and drops focus). A Tooltip may wrap a Tab (TabList finds tabs by `[data-tab-value]`); roving tabs need `focusTrigger="always"`.
- A wrapping PanelBar end slot needs `max-width: 100%`, and the cluster inside it must wrap, or a right-aligned row overflows off the left.
- Several buttons with the same visible text need distinct accessible names that contain it ("Download CSV: Projects"), for label-in-name.
- `ListItem` clips a plain string label to one line; pass a `<Text>` to wrap. `TextInput width="fill"` sets no CSS width; use `width="100%"`. A column-flex anchor centres with `justify-content`; `align-items: center` there clips the title.
- Astryx width conditions only name breakpoints: the theme's `sm` is 481, so the compiled `(width < 481px)` is max-width 480px (`adaptations.widthBreakpoints`).

## Shell
- There are no tabs. Navigation history is recents (src/components/shell/recents.ts, recents-store.ts); peek visits are recorded by PeekHost, not RecentsTracker. On delete or archive, call forgetRecentsUnder(path).
- Use projectIdFromPath from recents.ts, which guards /projects/archives. Never write a project-id regex of your own.
- Dialogs from @/components/shell/dialogs restore focus to the last element focused outside a dialog or menu when the opener unmounted (row-menu dialogs, a nested dialog opened from a field of the outer one) or an autofocused field was taken as the opener. A pending, disabled submit still drops focus: refocus a field on a server error.
- A frame screen whose own content has an h1 (work item and project page detail) sets the frame's PanelTitle `accessibilityLevel={2}` (ProjectFrame.tsx).
- Move focus only when a surface opens or closes, never when a resize flips its layout (peek cover, useCoverFocus in peek-cover.ts). Record the opener on pointerdown too: Safari does not focus a button on click. WebKit is not installed (a download), so emulate it in Chromium by preventing the mousedown default.

## Tests and browser checks
- Browser scheme emulation does not switch the app (it defaults to Frappé). For Latte set localStorage `tessera.scheme.v1` to `light` and reload. Dialogs animate: wait 2–3 s before a screenshot.
- jsdom has no layout. Test a CSS rule by reading the stylesheet text (tests/ui/*-css.test.ts, e.g. home-touch-css.test.ts).
- Playwright: `npm run test:e2e` runs `next start` on E2E_PORT (default 3100) with data/e2e.db, so build first, and only in a scratch copy. The webServer starts before globalSetup, so DB preparation lives in the webServer command.
- Vitest runs only `*.test.ts`; a `.test.tsx` never runs, so render with `createElement` (dialog-focus.test.ts). Playwright picks up any `*.test.ts` under tests/e2e, so keep Vitest files outside it.
- While a route streams in, a hidden copy of an element can sit beside the live one: locators fail strict mode. Use role locators, or `:visible` plus `toHaveCount(1)` (the /drafts and gantt-bar flakes).
- Playwright's 'Desktop Chrome' device sends a Windows user agent, so Astryx `mod` is Control in the page and `ControlOrMeta+k` (Meta on macOS) never opens Power K. Press the page's modifier (helpers-b.ts `modifierKey`).
- Notifications from one agent on one item coalesce for 10 minutes (decision 51): give each e2e agent its own client name (`mcp(tool, input, client)`). scripts/mcp-call.ts acts as `mcp:p3-acceptance` unless given `--client`. A client name shows as an avatar label, so a form-field word in it ("name") breaks `getByLabel("Name")` in other specs.
- A hand-started server hides the header Assistant button until `/api/ai/status` says available: set `TESSERA_AI_FAKE=tests/e2e/fixtures/ai` (replay only). Every visit to `/` moves the last-visit marker: re-seed Since rows with fresh MCP writes before each measurement.
- helpers-b `hitBoxMisses` is lenient in `[role="banner"]`; prove that header boxes do not overlap with helpers-c `strictHitBoxMisses`. An Astryx Tab without `aria-label` has its label twice in textContent ("GeneralGeneral"): read the accessible name.
