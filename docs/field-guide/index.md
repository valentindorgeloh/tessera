# Tessera field guide (budget: 80 lines)

Surprises that cost agents time before. One line each, newest at the end of its group. The reconciler maintains this file (docs/process/swarm.md). Longer notes go in docs/field-guide/<topic>.md.

## Environment
- Prefix every node/npm/npx command with `export PATH=/opt/homebrew/bin:$PATH;`. better-sqlite3 13 needs Node >= 22.14.
- Start the dev server from Bash: `nohup node node_modules/next/dist/bin/next dev -H 127.0.0.1 -p 3000 > <log> 2>&1 &`. preview_start by name hangs. In a swarm run, serve only from a scratch copy on another port.
- `next dev` and `next build` share `.next`: stop the server before a build, then `rm -rf .next/dev` before restarting. A browser tab stuck reloading means a stale `.next/dev`.
- Never open or touch data/tessera.db* (the user's data). Phases use TESSERA_DB_PATH=data/<phase>-dev.db and a fresh data/<phase>-acceptance.db; move old copies to the scratchpad, never delete them.
- MCP without the stdio server: `TESSERA_DB_PATH=<db> npx tsx scripts/mcp-call.ts <tool> '<json>'`. The stdio server refuses pending migrations unless started with --migrate.
- `astryx doctor` always shows one theme-fonts warning (fonts load through next/font). It is expected.
- Migrations are hand-written (`drizzle/NNNN_name.sql` + a `_journal.json` entry). Never run `drizzle-kit generate` in the checkout. After a schema change, run it in a scratch copy (copy `drizzle/ src/ drizzle.config.ts package.json tsconfig.json`, symlink node_modules), move the new `NNNN_snapshot.json` into `drizzle/meta/` under the journal idx of your hand-written migration, and re-run it in a fresh copy: it must say "No schema changes".
- Only the root planner runs state-changing git. Agents never add, commit, stash, checkout or restore.
- The /tmp scratchpad is wiped by the system (it happened on 2026-10-16). Keep drafts that must survive in docs/drafts/ in the repo.
- The Edit tool refuses a stale read. Another agent may have changed the file, so re-read it and never overwrite.
- `next start` renames its process to next-server: stop servers by port (`lsof -tiTCP:<port> -sTCP:LISTEN`).
- zsh: `echo ====` fails (=cmd expansion); unmatched globs error; `$VAR` is not word-split.

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
- `touch-action: none` goes on a grip only, never a whole row or chip, or a finger can no longer scroll. Reuse `RowGrip` / `.tessera-row-grip` (44x44 under `(pointer: coarse), (max-width: 480px)`).
- usePointerDrag's `itemsOf` must match the rendered rows. Turn the drag off while a search or filter hides rows, or the neighbours are wrong.
- A tooltip that can appear mid-drag uses Astryx Tooltip sibling mode (`anchorRef`). Wrapping the trigger remounts it and drops pointer capture.
- Hover-revealed controls: `opacity: 0` only. Put `pointer-events: none` under `@media (hover: none)`, or mouse and Playwright clicks miss them.
- Placement ids name the neighbour's side: `before_id` is the row that ends up directly before the moved one, `after_id` the row after it. Sending the previous row as `before_id` for "Move earlier" moves nothing (src/components/stickies/reorder-math.ts).

## Astryx and theme
- Convention `css-token`: an Astryx-family name (`--spacing-`, `--color-`, ...) must exist in the installed Astryx CSS or in `src/themes/**`, never only in an area file; any other name must be defined in the same file, a theme file, or the other side of the css/ts pair (a style prop or `setProperty` for CSS). `--font-body` and `--font-code` are exempt (next/font sets them in layout.tsx). See `scripts/convention-rules.ts`.
- Astryx spacing tokens stop at `--spacing-12` (4px steps; `--spacing-11` is 44px). An undefined var() silently drops the whole declaration.
- No raw <div>/<span>, hex or xstyle. Layout uses className + tokens in src/components/styles/<area>.css. Icons come only from src/themes/catppuccin/icons.tsx.
- No Astryx Toolbar in panel headers: its roving tabindex steals arrow keys. Use PanelHeader/PanelBar (src/components/shell/PanelHeader.tsx).
- Panel rows use a 16px inline inset (paddingInline={4}). Header controls are size sm. A screen inside the project frame adds no second title row.
- Badge is for counts only. RelativeTime inside a tooltip trigger needs hasTooltip={false}.
- Console noise to tolerate (the list in tests/e2e/tolerated.ts): Astryx Table tableContextMenu React prop warnings (`moveTo`; `start`/`cancel`), React's prerender `measure` negative-timestamp warning, Chrome's "form field should have an id or name" note, and CSS preload warnings. Every anchor carrying a `to` attribute is known (LinkProvider + next/link).
- Dialogs animate: wait 2–3 s before a screenshot.
- A MoreMenu row with nested `items` drops `description`. A disabled reason has to be a leaf row.
- A wrapping PanelBar end slot needs `max-width: 100%`, and the cluster inside it must wrap, or a right-aligned row overflows off the left.
- Several buttons with the same visible text need distinct accessible names that contain it ("Download CSV: Projects"), for label-in-name.

## Shell
- There are no tabs. Navigation history is recents (src/components/shell/recents.ts, recents-store.ts). On delete or archive, call forgetRecentsUnder(path).
- Use projectIdFromPath from recents.ts, which guards /projects/archives. Never write a project-id regex of your own.
- Peek visits are recorded by PeekHost, not RecentsTracker.
- A frame screen whose own content has an h1 (work item and project page detail) sets the frame's PanelTitle `accessibilityLevel={2}` (ProjectFrame.tsx).

## Tests and browser checks
- If in-app browser screenshots or clicks fail because the pane is hidden, use read_page/get_page_text/javascript_tool or the Chrome DevTools MCP with your own page.
- Read the console on every screen. Only the noise listed above is tolerated.
- Browser scheme emulation does not switch the app (it defaults to Frappé). For Latte set localStorage `tessera.scheme.v1` to `light` and reload.
- jsdom has no layout. Test a CSS rule by reading the stylesheet text (tests/ui/*-css.test.ts, e.g. home-touch-css.test.ts).
- Playwright: `npm run test:e2e` runs `next start` on E2E_PORT (default 3100) with data/e2e.db, so build first, and only in a scratch copy. The webServer starts before globalSetup, so DB preparation lives in the webServer command.
- Playwright picks up any `*.test.ts` under tests/e2e. Keep Vitest files outside it (tests/e2e-tolerated.test.ts).
- While a route streams in, a hidden copy of an element can sit beside the live one: locators fail strict mode. Use role locators or wait for exactly one match.
