# Tessera build status

Where the build stands. Dates are absolute. Plan and numbered decisions: [docs/PLAN.md](PLAN.md). Open work: [docs/improvements.md](improvements.md). What exists, per area: [docs/as-built/](as-built/README.md). Ownership: [docs/contracts/OWNERS.md](contracts/OWNERS.md).

## Where it stands (2026-11-10)

All planned work is built. The last planned round, sidebar views, motion, virtual lists and calendar zoom, landed on 2026-11-09 and 2026-11-10 (commits `cb5d6f8` to `9bb3010`). What is left is backlog: the open items in docs/improvements.md, and the user approvals listed there under "Waiting for the user" (the live assistant acceptance with the real model, the Astryx upstream issue).

The cache lane (decisions 109–111) was dropped by the user on 2026-10-21 and is recorded as decision 127; it is not built.

## Rounds

| Round | Features | Done | Outcome, and what stayed open |
|---|---|---|---|
| Setup | rename, installs, configs, gates, contracts, stubs | 2026-10-10 | `npm run check` green on an empty suite, `next build` passes. Node moved to 22.23.3 (better-sqlite3 13 needs Node-API 10). |
| Engine | schema, migrations, actors, projects, states, labels, work items, cycles, modules, views, counts, search, changes, tool registry, MCP route and stdio server | 2026-10-10 | 20 test files, 640 tests; the schema, service API and tools contracts were reviewed against the code on 2026-10-11. |
| Work items core | shell, sidebar, projects, list, board and table, create dialog, quick-add, filter bar, display menu | 2026-10-11 | Browser acceptance on an empty database (create, board drag, priority and target date survive a reload), then a fix round of ten findings. Playwright now drives the same flows (`smoke`, `work-items`, `drag` specs). No sign-off by the user is recorded. |
| Detail, editor, Power K | peek, modal and full-page detail, property rail, Markdown editor with compare-and-set saves, sub-items, `/browse/[key]`, Power K, shortcuts | 2026-10-11 | Acceptance steps 1–8 pass; two fix rounds (eleven review findings, then the 4 s fixed-rate poll so an external write shows within 5 s). |
| Cycles, modules, archives | cycles, active cycle, burndown and burnup, transfer, modules, module links, archives with restore | 2026-10-11 | 17 of 17 acceptance steps on the merged shell. No Playwright spec walks the cycle or module screens by name (`coverage-timeline` covers transfer). No sign-off by the user is recorded. |
| Visual rework and layout rework | Astryx 0.6.8, the Catppuccin theme (Frappé dark by default, Latte light, Mauve accent), the colour scheme menu; recents in place of tabs, panel headers | 2026-10-11 | Both merged; the theme review fixed 18 of 21 findings. |
| Views, settings, counts | project views (save, update, duplicate, lock), sidebar counts, project settings, multi-valued grouping, sub-groups | 2026-10-17 | Acceptance 24 of 24 after one fix round; 1541 tests. |
| Assistant | assistant panel, Power K Ask with proposals and Apply, view from a prompt, digests, status route, loopback guard | 2026-10-17 (commits `75cbf0b`, `515d844`) | Engine and UI tests. **Live acceptance against the real Anthropic API never ran** (it needs the user's approval and an API key); Playwright runs the assistant against the recorded fake client (decision 124). |
| Pages | pages in SQLite, wiki and project pages, `import:handbook`, the handbook and Milkdown removed, Home at `/` | 2026-10-18 | Done; later page polish is backlog. |
| Collaboration | relations, comments, reactions, links, subscriptions, mentions, inbox, inbox digest | 2026-10-18 | Engine tests cover notifications and relations; smoke pass 2026-10-18. |
| Intake, drafts, estimates, bulk | intake with an agent policy, drafts, estimates, bulk bar, copy and move across projects | 2026-10-18 | Engine tests prove the exit criteria (an MCP create lands in triage when required; bulk archive refuses mixed groups). |
| Workspace surfaces | Home widgets, stickies, favourites, Your work, agent profiles, workspace views, active cycles, analytics | 2026-10-18 | Home renders from one `getHomeSummary`; analytics equals `getCounts`. |
| Layouts and operations | calendar, gantt, rich filters, automations, version history, exports, webhooks | 2026-10-18; exit criteria closed 2026-10-19 | Gantt drag writes both dates; Export downloads a UTF-8 BOM CSV; the webhook echo walk passed (`scripts/webhook-echo.ts`). Gantt zoom, dependency connectors and the modules timeline followed on 2026-10-19 and 2026-10-21. Still open: a gantt conflict whose other end is outside the loaded page has no bar to anchor; exports run synchronously (decision 100), capped at 50,000 rows. |
| Hardening | paging, backup rotation, retention, assistant-batch undo, 10k-item performance budgets, Playwright suite, bundle gate | 2026-10-18 | Per-group paging with exact counts and Show more; backup kinds, rotation, `/settings/backups` and `db:restore`; retention under `run_maintenance`; undo of assistant batches (engine, then the toast and Power K in fix round 3); `npm run perf:bench`; the Chromium suite on `next start`; the first-load bundle gate (decision 125) and the query-plan test (decision 126). Still open: the migration's 10-minute backup exception (decision 119) is not built; `list_backups` never runs `quick_check`; `runMaintenance` has no direct test. The decision 115 first-render budget: docs/improvements.md, "Performance". |
| Fix-all round | drag reorder on every surface, gantt zoom, connectors and Today, page history Activity tab, analytics CSV, the Playwright suite with the fake AI client | 2026-10-21 | Full Playwright suite 54 of 54 on a production build (decisions 123 and 124). |
| Visual alignment round | touch targets as 44 px hit areas, the two-row phone header, the fallback focus layer, relations and reactions UI, per-area layout fixes | 2026-10-22 | 161 audit findings merged into 130 fix items; 158 pass and 4 fail before the second fix, all closed after it. The Latte icon contrast of yellow, peach, pink and green is an accepted trade-off. |
| Fix rounds 3 to 6 | notification coalescing, snooze and mention sync; the `[[` page picker; Undo on the Applied toast and in Power K; phone rows, tab strips and touch spacing; create-time assignees; the hydration error 418 after an early sidebar toggle | 2026-10-23 | Final gate of round 6: Vitest 241 files and 3011 tests three times, Playwright 138 of 138. Details below. |
| Performance rounds | lazy date pickers, CSS one-line row text, memoised list rows with a lean row context, the lazy peek detail, the per-route first-load budget | 2026-10-24 to 2026-10-29 | Ticking a row on the 10k list 265 → 94 ms, peek open 697 → 472 ms, the list's first-load JavaScript 960 → 669 KB gzip. Details below. |
| Polish | app icon and web app manifest, the Tessera mark in the top bar, generated robot avatars for agents, the sidebar's icon column and toggle centred in the wash strip, the "Work" heading removed, the README refreshed, `schemas.ts` split for the file budget | 2026-11-09 | Commits `55ee2a8` to `6981efd`. |
| Sidebar views, motion, virtual lists and calendar zoom | three sidebar views (Full, Icons and labels, Icons only) and a floating sidebar; layout motion and the peek card slide, honouring reduced motion; virtual scrolling for the list, board, table and gantt; calendar zoom Week, Month, Quarter | 2026-11-09 to 2026-11-10 | Built and committed (`cb5d6f8` to `9bb3010`); decisions 127–139. This round in detail below. |

## Sidebar views, motion, virtual lists and calendar zoom (2026-11-09 to 2026-11-10)

Contract: [the round's plan](drafts/p12-plan.md) (decisions 127–139 are in docs/PLAN.md).

Built:
- **Sidebar:** Full, Icons and labels (60 px) and Icons only (48 px), stored in `tessera.nav.v1`; a floating sidebar that opens from an 8 px edge strip, the top bar's toggle or `mod+b`; "Sidebar options" in the sidebar footer and the same choices in Power K. Preferences and the open flag are module stores read with `useSyncExternalStore`, so the streamed sidebar still hydrates against its server HTML (`nav-prefs.ts` replaces `nav-collapse-store.ts`).
- **Motion:** the sidebar width and the floating panel animate with the theme's `--duration-medium`; the peek card slides in and out without remounting the detail; a layout switch fades. Nothing moves under `prefers-reduced-motion`.
- **Virtual lists:** windows above 30 list rows, 30 table rows, 40 gantt rows and 8 cards per board column (decision 135), with paging, sticky bands, drag and drop, Home/End and the last focused row kept working (decision 136); windowing is off while printing.
- **Calendar zoom:** Week, Month and Quarter (decision 139); a quarter cell shows two items, and a narrow quarter shows only a "+N" count per day.
- **Fixes on 2026-11-10 (`9bb3010`):** the floating panel no longer opens and closes in a loop when the pointer rests on the edge strip (the strip stays mounted while the panel is open and counts as part of it); a focused row kept in a grouped list no longer unmounts for a frame when ArrowDown scrolls it back into range (`gateWindow` in `virtual-math.ts`).

Agents by role:
- Build round 1: 5 workers (prep, sidebar, motion, calendar, virtual list; Opus 5.5) and 2 gates (Haiku).
- Build round 2: 3 workers (board, table and gantt windows; two Playwright parts; Opus 5.5), 1 reconciler (bundle check) and 2 gates (Haiku).
- Close-out: 1 worker (as-built maps, this file, docs/improvements.md, README; Opus 5.5).
- Verification: see below.

Tests: 30 Playwright spec files (new: `sidebar`, `motion`, `calendar-zoom`, `virtual-scroll`, and `virtual-perf` beside `perf`, both opt-in through `playwright.perf.config.ts`), and new Vitest files beside each part.

Measured (decision 138, `virtual-perf.spec.ts` on the 10 000-item fixture): scrolling the list, table, gantt and the board's first column keeps the median frame interval at 16.7 ms, with no long task (the table had none on the quieter of its runs); the first-render budget of decision 115 is under investigation. Numbers and the open performance items: docs/improvements.md, "Performance".

Verification: _to be filled in by the root planner (gate results, browser checks, open findings)._

## Earlier round summaries

**Fix round 3 (2026-10-23).** Notification coalescing, snooze and mention sync as decisions 51, 52, 53 and 59 are written (migration 0012); the `[[` page link picker; Undo on the Applied toast and in Power K (decision 118 in part: no History view and no confirm dialog, on purpose); phone list rows at their audit height; the covered list is `inert` with focus moved into the peek and back; tab strips that fit at 375 and 360 px; a folded Backups table; the Intake bar on one row; focus return after "Save this draft?". Next.js moved to 16.4.3 for the published advisories. Agents: contract 1 (Opus), build 9 (Sonnet), review 4, refuters 2 per finding, fixers 17, docs 1, reconciler 1.

**Fix round 4 (2026-10-23).** Notification wording that counts the events of the row's current kind (`kind_count`, migration 0013); the project header in three width bands with a `SectionMenu` below 600 px; the top bar's touch spacing; the `[[` picker leaving out the page being edited; two-line Since labels at 480 px and narrower; the peek opener recorded on pointer-down (Safari). Playwright 100 of 100. Agents: build 4 (Sonnet), fixers 4, docs 1.

**Fix round 5 (2026-10-23).** Initial assignees at create time are logged and notified through `syncAssignees` (decisions 50 and 51); Home Since rows keep the item key visible at 480 px and narrower; coarse-pointer hit areas for the labelled project tabs, the top bar search field and the project bar's end buttons. Playwright 109 of 109. 38 agents in all, about 2 h 5 min.

**Fix round 6 (2026-10-23).** The hydration error 418 after an early sidebar toggle came from the sidebar's Suspense boundary on every route; the collapse flag moved into a module store read with `useSyncExternalStore` (the rule is in docs/contracts/ui.md "Shell"). Power K keeps the first key typed into the top bar's field. Final gate: Vitest 241 files and 3011 tests three times, Playwright 138 of 138, `round6.spec.ts` 84 of 84 with `--repeat-each=3`. Not fixed, regression tests only: `AiStatusProvider` could mismatch the same way; it never reproduced.

**Performance rounds (2026-10-24 to 2026-10-29).** Decision 140 (the live app on 3000, dev on 3001), 141 (render identity in the work-item list) and 142 (load less up front). Measured on production, interleaved, n=5 per side: ticking a row on the 10k list 265 → 94 ms with no long task, a state pick 237 → 58 ms, peek open 697 → 472 ms, an agent write redraws 2,787 components instead of 40,720, the work-items list's first-load JavaScript 960 → 669 KB gzip. Report: `docs/drafts/perf-report-2026-10-28.md`.

## Hand-off notes of earlier rounds

The detailed hand-off notes, which the as-built maps and the contracts cite by their headings, are kept unchanged in [the archived status file](drafts/plan-status-before-2026-11-10.md), together with the earlier version of this page.
