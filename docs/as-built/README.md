# As-built map

Read this before reworking an area. It says what exists, where it lives and what guards it; the contracts in docs/contracts/ hold the full detail.

Snapshot: working tree after the visual alignment round, 2026-10-22 (HEAD 5f0cc7c plus uncommitted lane work). It covers P1–P11, the rework, the assistant and the visual alignment changes (touch hit areas, relations and reactions UI, tab strips, layout values); shell-detail, work-items, planning, views-settings, pages-collaboration, workspace and operations are refreshed for it, the other files still describe the 2026-10-21 tree. P12 is not in it; refresh the affected files when it lands.

| Area | File | Covers |
|---|---|---|
| Engine | [engine.md](engine.md) | src/lib/tessera/**, tools and MCP, scripts, actions, API routes |
| Shell and detail | [shell-detail.md](shell-detail.md) | shell, recents, Power K, dialogs, the work item detail, the editor, the theme |
| Work items | [work-items.md](work-items.md) | the work items screen, layouts, quick-add, properties, DnD, projects |
| Planning | [planning.md](planning.md) | cycles, modules, archives, charts |
| Assistant | [ai.md](ai.md) | the AI client, proposals, Apply, the assistant panel, MCP route |
| Views and settings | [views-settings.md](views-settings.md) | P4: saved views, view settings, counts, states, labels, project settings, workspace views, drag reorder |
| Pages and collaboration | [pages-collaboration.md](pages-collaboration.md) | P6, P7: pages, comments, reactions, relations, notifications, inbox, history dialog, page tree |
| Planning extras | [planning-extras.md](planning-extras.md) | P8: intake, drafts, estimates, bulk edit, transfer |
| Workspace | [workspace.md](workspace.md) | P9: Home, favourites, profiles, analytics, stickies, quick links, workspace settings |
| Operations | [operations.md](operations.md) | P10: calendar, gantt, modules timeline, rich filters, automations, exports, webhooks |
| Hardening | [hardening.md](hardening.md) | P11: paging, backups, retention, undo, perf budgets, e2e, bundle gate |

Process: docs/process/swarm.md. Surprises: docs/field-guide/index.md. Plans: docs/drafts/. Open work: docs/improvements.md.

Caveats from the writers:
- Some invariant-to-decision pairs come from the contracts rather than a code read; they are marked in each file.
- Areas without Vitest are listed in each file's "Tests" section.
- Each file's "Known debt" records where the code differs from a decision; check it before trusting the decision text. Decisions 109–111 were dropped and are not built.
