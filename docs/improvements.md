# Tessera: what needs improving (2026-10-18)

Backlog collected on 2026-10-18 after P11 landed (HEAD 408a624): a production smoke test, the P10 browser acceptance, a Sonnet review of paging and perf, and Mistral's audit. "Open" items were seen at the commit named in their section; re-check each one before working on it. A Sonnet audit across all areas was planned but not run (budget).

## Fixed today (do not list as open; mention under "Fixed on 2026-10-18")
- `/agents/[actorId]` awaited params outside Suspense, so `next build` failed (aaa2b38).
- Paging review round (0dab9d7): Show more and re-fetch dropped URL-only rich filters; calendar loaded every item instead of the shown period; perf DB guard was case-sensitive; `check:e2e` missing; decision 106 cited but absent; describe_filters missing the paging keys.
- Gantt and calendar CSS used `var(--spacing-16)`, which Astryx does not define (scale stops at 12): gantt bars sat 2–5 days off their header dates (408a624).
- Backups: `VACUUM INTO` used an escaped string literal; now a bound parameter (408a624). Mistral's audit flagged the literal as SQL injection. It was not exploitable (doubled quotes are SQLite's only escape and the path is server-built), and Mistral's proposed regex allowlist would have broken backups for paths with spaces or accents.

## Verified OK today
- `npm run check` green at 408a624: 133 files, 2039 tests; 0 lint errors, 4 unused-variable warnings.
- `next build` 63/63 pages; `npm run check:bundle` passes.
- Every route returns 200 on a fresh seeded database; no console errors on 17 new screens (P5–P11).
- Perf bench on 12 000 items (10 000 in one project): every case within its decision-115 budget. Tightest: group projection by labels p95 34.8 ms vs 40 ms (it went over once on a loaded run in the perf worker's runs).
- P10 engine proofs: gantt drag writes both dates in one update; CSV/JSON export is spreadsheet-ready (BOM, CRLF, RFC 4180, formula guard); webhooks sign with HMAC-SHA256, retry on 500 and deactivate on 410; agents cannot manage webhooks.
- All five AI routes use the loopback guard; AI tests use a fake client.

## Open, from the P10 browser acceptance (at 08e5118, Sonnet, full report in this session)
- Plan items not built (p10-plan §9 steps): gantt zoom Week/Month/Quarter and gantt options in Display (5); dependency connectors, conflict state and "Show dependencies" (7); Modules list Timeline (10); project Settings "Automations" tab with Run now / Due now / Last run (13); "Week starts on Sunday" setting, decision 101, Monday is hard-coded in CalendarLayout.tsx (4); bulk Copy/Move to project (21); group headers "N pts" (22; the engine now returns Group.estimate_points on paged lists, the UI does not show it); page Outline and an Activity tab in page history (15); Analytics "Data table" CSV download (16); drag reorder beyond sidebar, favourites, board and calendar: views list, states, labels, wiki tree, stickies, quick links, Home widgets (20); a scheduler start log line (23).
- After a project move, the old key `/browse/ACC-10` shows "Page not found" and get_work_item_by_key returns NOT_FOUND; old keys live only in activity old_identifier (browse/[key]/page.tsx, getWorkItemByKey). Decision 29 (rename history) covers identifier renames, not moves.
- Version history dialog shows no actor per version (VersionHistoryDialog.tsx) though the API returns actor_id.
- Rich filter dialog: the value input is a raw text box needing ids and raw operator names; over-deep trees show raw JSON; views list says "List · no filters" for rich-only views; MCP "Invalid rich filters" error omits the JSON path that decision 93 requires (rich-filters.ts).
- Accessibility: Set-dates popover calendar has no tab stop when today is before min; date popover calendar is Sunday-first while the app calendar is Monday-first; Switch inputs and the webhook secret input lack accessible names; Export Delete shows its toast twice.
- 375 px: project tab strip truncates ("Work it…"), the Today label truncates, calendar chips wrap.
- The automation lease (two concurrent runs) was not exercised.

## Open, from the paging/perf review (Sonnet, confirmed by a refuter)
- Cycle-scope list and counts filter `work_item.cycle_id = ?` without a matching index; the list now uses work_item_project_cycle_idx, but cycle progress/counts may not. The workspace list scope keeps 2 bare `SCAN work_item` pinned in tests/perf/query-plans.test.ts; decision 126 says that should fail. Either add indexes or record the exception in decision 126.
- Bundle gate whitelists the phrase "set ANTHROPIC_API_KEY in .env.local" (scripts/bundle-rules.ts ALLOWED_PHRASES) because src/components/ai/ai-status.ts ships it to the client. Reword the help text and drop the whitelist.
- Labels group projection is close to budget because every group's first page is hydrated (about 40 label groups × 50 rows); a smaller first page for multi-valued groupings or a SQL GROUP BY path is the fallback in the plan's risk table.
- The table's select-all checkbox has no "N loaded of M" text; it is only in the BulkBar note (decision 114).
- Gantt timeline range is computed from loaded items only, so loading more rows can shift bars; table header sort is client-side over loaded rows only.
- Cache lane (decisions 109–111, `src/app/_cache/`, revision-keyed `'use cache'`) was skipped on purpose; decide whether to drop the decisions or schedule it.
- Playwright suite: config, specs and `@playwright/test` 1.63.0 are in, but Chromium was never downloaded (needs the user's approval, about 150 MB), so the suite has never run and is not part of `npm run check`.

## Open, from earlier checks
- docs/PLAN-STATUS.md: re-check every phase row against reality (P5's row said "not started" although the assistant is built; check what Cursor wrote at 4ead15f).
- P5 live acceptance with the real model never ran (needs the user's approval: about $1–3 of API usage per run). TESSERA_AI_FAKE / recorded turns (decision 124) may allow a no-cost browser pass.
- docs/PLAN.md "Resolved design decisions" has rows 1–45, 55 and 109–126 only. Decisions 46–54 and 56–108 from the P4–P10 plans were never copied in, so code cannot cite them (the convention gate would fail) and the plans in docs/drafts are the only record.
- docs/as-built/ describes P1–P3 plus the rework (HEAD 257798c); P4–P11 are not mapped.
- The convention gate does not catch CSS custom properties that Astryx does not define (the --spacing-16 bug). A rule could check `var(--spacing-N)`, `--radius-*` and `--color-*` names against the installed astryx.css.
- A stale git worktree sits at .claude/worktrees/app-visual-rework-250c6c (branch claude/app-visual-rework-250c6c, ad30062, already merged); it once made `npm run lint` red.
- 4 eslint unused-variable warnings: import-handbook.ts, pages/embeds.ts, pages/read.ts, pages/write.ts.
- `npm run perf:bench` prints "500+ in PERF" because it caps its id sample; cosmetic.
- Rework issues from 2026-10-16, never re-checked: two h1 elements on the work item detail page; at 375 px the tab strip has no scroll cue; a board column is 25 px too wide at 375; the drawer search placeholder is cut off; the burnup "Scope" label overlaps its line; an unknown cycle id is recorded in recents; the archived project list is not read-only.
- `?layout=gantt` in a project work-items URL does not switch the layout (the display lives in the `q` blob); check whether a plain layout param is meant to work.
