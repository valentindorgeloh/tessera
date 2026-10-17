# Tessera field guide (budget: 80 lines)

Surprises that cost agents time before. One line each, newest at the end of its group. The reconciler maintains this file (docs/process/swarm.md). Longer notes go in docs/field-guide/<topic>.md.

## Environment
- Prefix every node/npm/npx command with `export PATH=/opt/homebrew/bin:$PATH;`. better-sqlite3 13 needs Node >= 22.14.
- Start the dev server from Bash: `nohup node node_modules/next/dist/bin/next dev -H 127.0.0.1 -p 3000 > <log> 2>&1 &`. preview_start by name hangs.
- `next dev` and `next build` share `.next`: stop the server before a build, then `rm -rf .next/dev` before restarting. A browser tab stuck reloading means a stale `.next/dev`.
- Never open or touch data/tessera.db* (the user's data). Phases use TESSERA_DB_PATH=data/<phase>-dev.db and a fresh data/<phase>-acceptance.db; move old copies to the scratchpad, never delete them.
- MCP without the stdio server: `TESSERA_DB_PATH=<db> npx tsx scripts/mcp-call.ts <tool> '<json>'`. The stdio server refuses pending migrations unless started with --migrate.
- `astryx doctor` always shows one theme-fonts warning (fonts load through next/font). It is expected.
- Only the root planner runs state-changing git. Agents never add, commit, stash, checkout or restore.
- The /tmp scratchpad is wiped by the system (it happened on 2026-10-16). Keep drafts that must survive in docs/drafts/ in the repo.
- The Edit tool refuses a stale read. Another agent may have changed the file, so re-read it and never overwrite.

## Next 16 (Cache Components)
- Reads go under <Suspense>, with `await io()` before readTessera. refresh() only works in Server Actions; never use router.refresh().
- Mutations go through toolAction("tool_name") wrappers in src/app/actions/*.ts. redirect() and notFound() go outside try.
- Next keeps left routes mounted under React <Activity mode="hidden">. Their effects stop but their DOM and state stay. Layout-effect cleanups run at hide time.
- Import Dialog and AlertDialog from @/components/shell/dialogs, never from Astryx (lint-enforced): it closes the native <dialog> when Next hides a route, so the next page is not left inert.
- No Date.now(), Math.random() or argless new Date() in render (prerender errors). Use src/lib/tessera/core/time helpers.

## Code rules that bite
- "use client" files may import engine code only from @/lib/tessera/{types,schemas,core/keys,core/time,core/group}.
- zod 4: `.partial()` still applies `.default()` values, so `DisplaySchema.partial()` fills defaults. Use DisplayPatchSchema for patches.
- Cite numbered decisions in code as `decision N` (docs/PLAN.md). The convention gate fails on a cited number missing from the PLAN tables (docs/process/swarm.md).
- File budget: 600 lines. Do not grow files listed in scripts/file-budget.json (cycles.ts, db/schema.ts, modules.ts after the P4 split; registry and work-items are folders). The convention gate fails on growth or on a new file over 600 lines. Lower the json when you shrink one.

## Astryx and theme
- No raw <div>/<span>, hex or xstyle. Layout uses className + tokens in src/components/styles/<area>.css. Icons come only from src/themes/catppuccin/icons.tsx.
- No Astryx Toolbar in panel headers: its roving tabindex steals arrow keys. Use PanelHeader/PanelBar (src/components/shell/PanelHeader.tsx).
- Panel rows use a 16px inline inset (paddingInline={4}). Header controls are size sm. A screen inside the project frame adds no second title row.
- Badge is for counts only. RelativeTime inside a tooltip trigger needs hasTooltip={false}.
- Dev-only console noise to tolerate: Astryx Table tableContextMenu warnings (`moveTo`; `start`/`cancel` props). Every anchor carrying a `to` attribute is known (LinkProvider + next/link).
- Dialogs animate: wait 2–3 s before a screenshot.
- A MoreMenu row with nested `items` drops `description`. A disabled reason has to be a leaf row.
- A wrapping PanelBar end slot needs `max-width: 100%`, and the cluster inside it must wrap, or a right-aligned row overflows off the left.

## Shell
- There are no tabs. Navigation history is recents (src/components/shell/recents.ts, recents-store.ts). On delete or archive, call forgetRecentsUnder(path).
- Use projectIdFromPath from recents.ts, which guards /projects/archives. Never write a project-id regex of your own.
- Peek visits are recorded by PeekHost, not RecentsTracker.

## Browser checks
- If in-app browser screenshots or clicks fail because the pane is hidden, use the Chrome DevTools MCP with your own page.
- Read the console on every screen. Only the Astryx Table warnings above are tolerated.
