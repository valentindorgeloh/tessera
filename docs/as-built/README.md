# As-built map

Read this before reworking an area. It says what exists, where it lives and what guards it; the contracts in docs/contracts/ hold the full detail.

Snapshot: working tree after fix round 6, 2026-10-23 (round 5 committed, plus uncommitted lane work; migration 0013 is committed). It covers P1–P11, the rework, the assistant, the visual alignment changes, the round 3 and round 4 changes, the round 5 changes and the round 6 changes (the sidebar collapse flag moved out of the shell context into `nav-collapse-store.ts`, so a toggle before the streamed sidebar hydrates no longer causes hydration error 418; Power K keeps the first key typed into the top bar's field and never searches a palette closed before the seed; the mobile drawer's New work item is the full button whatever the desktop collapse state; the create-time assignee side effects on webhooks and the Home Since row are pinned by tests; `round6.spec.ts` with 28 Playwright tests, 138 in the full suite). The round 5 changes were (initial assignees logged and notified through `syncAssignees` on create, the Home Since actor run that truncates at 480 px and narrower, the touch hit areas of the labelled project tabs, the top bar search field and the project bar's end buttons, 109 Playwright tests). The round 4 changes were (notification wording with `kind_count`, the `SectionMenu` and the three width bands of the project header and the project settings strip, the top bar's touch spacing, the `[[` picker leaving out the page being edited, the two-line Since labels, the peek opener recorded on pointer-down, 100 Playwright tests). The round 3 changes were (notification coalescing and mention sync, the `[[` page links, assistant Undo in the toast and Power K, phone list rows, the covered-list focus rules, tab strips and input stacking, the folded Backups table). Every file was refreshed for that tree or says in its header which lines a round touched (planning.md, workspace.md, views-settings.md and operations.md only in part; ai.md and planning.md were not touched in round 4 or round 5, and operations.md only got the round 5 webhook sentence and the round 6 ruling; shell-detail.md and workspace.md got their round 6 lines only). P12 is not in it; refresh the affected files when it lands.

| Area | File | Covers |
|---|---|---|
| Engine | [engine.md](engine.md) | src/lib/tessera/**, tools and MCP, scripts, actions, API routes |
| Shell and detail | [shell-detail.md](shell-detail.md) | shell, recents, Power K, dialogs, the work item detail, the editor, the theme |
| Work items | [work-items.md](work-items.md) | the work items screen, layouts, quick-add, properties, DnD, projects |
| Planning | [planning.md](planning.md) | cycles, modules, archives, charts |
| Assistant | [ai.md](ai.md) | the AI client, proposals, Apply, the assistant panel, Undo (toast and Power K), MCP route |
| Views and settings | [views-settings.md](views-settings.md) | P4: saved views, view settings, counts, states, labels, project settings, workspace views, drag reorder |
| Pages and collaboration | [pages-collaboration.md](pages-collaboration.md) | P6, P7: pages, comments, reactions, relations, mentions, notifications (coalescing, snooze), inbox, history dialog, page tree |
| Planning extras | [planning-extras.md](planning-extras.md) | P8: intake, drafts, estimates, bulk edit, transfer |
| Workspace | [workspace.md](workspace.md) | P9: Home, favourites, profiles, analytics, stickies, quick links, workspace settings |
| Operations | [operations.md](operations.md) | P10: calendar, gantt, modules timeline, rich filters, automations, exports, webhooks |
| Hardening | [hardening.md](hardening.md) | P11: paging, backups, retention, undo engine, perf budgets, e2e (21 specs), bundle gate |
| Superagent | [superagent.md](superagent.md) | idempotent agent comments, agent settings, the runner control client, `/agents/superagent`, the superagent chat, Send to superagent, operating the runner from Tessera |

Process: docs/process/swarm.md. Surprises: docs/field-guide/index.md. Plans: docs/drafts/. Open work: docs/improvements.md.

Caveats from the writers:
- Some invariant-to-decision pairs come from the contracts rather than a code read; they are marked in each file.
- Areas without Vitest are listed in each file's "Tests" section.
- Each file's "Known debt" records where the code differs from a decision; check it before trusting the decision text. Decisions 109–111 were dropped and are not built.
