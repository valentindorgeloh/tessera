# As-built map

Read this before reworking an area. It says what exists, where it lives and what guards it; the contracts in docs/contracts/ hold the full detail.

Snapshot: HEAD 257798c (2026-10-17). It covers P1–P3 plus the layout rework, the dialogs wrapper and the gate checks. P4, which Cursor is building now, is not in it yet; refresh the affected files when P4 lands.

| Area | File | Covers |
|---|---|---|
| Engine | [engine.md](engine.md) | src/lib/tessera/**, tools and MCP, scripts, actions, API routes |
| Shell and detail | [shell-detail.md](shell-detail.md) | shell, recents, Power K, dialogs, the work item detail, the editor, the theme |
| Work items | [work-items.md](work-items.md) | the work items screen, layouts, quick-add, properties, DnD, projects |
| Planning | [planning.md](planning.md) | cycles, modules, archives, charts |

Process: docs/process/swarm.md. Surprises: docs/field-guide/index.md. Plans for P5–P11: docs/drafts/.

Caveats from the writers:
- Some invariant-to-decision pairs come from the contracts rather than a code read; they are marked in each file.
- Areas without Vitest are listed in each file's "Tests" section.
