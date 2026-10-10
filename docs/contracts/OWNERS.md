# Lane ownership

One owner per file. A lane edits only the paths it owns. When a lane needs a change in another lane's file it makes an **additive** edit (new export, new CSS block, new icon) and names the edit in its hand-off note; it never rewrites or removes what the owner wrote. Conflicts are resolved by the owner.

Each lane works in its own branch and `git worktree` (`../tessera-<lane>`), starting from `main` after P0. Merge gate for every branch: `npm run check` green, plus the no-mistakes gate once a remote exists.

| Lane | Owns | Starts |
|---|---|---|
| **A Engine** | `src/lib/tessera/**` (including every ToolDef), `drizzle/**`, `scripts/**`, root configs (`package.json`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`, `drizzle.config.ts`, `.env.example`, `.nvmrc`), `docs/contracts/**`, `licenses.exceptions.json` | P0 alone, then P1 |
| **B Shell and workspace** | `src/app/(tessera)/layout.tsx`, `src/components/shell/**`, `src/components/tab-registry.ts`, `src/app/providers.tsx` (additive until P6), `src/app/globals.css` (additive until P6), `src/themes/paper/icons.tsx` (additive), `src/components/{home,inbox,settings}/**`, routes `/home` (then `/`), `/your-work/**`, `/agents/**`, `/inbox`, `/stickies`, `/settings/**` | P1 day 4 |
| **C Work items UI** | `src/components/work-items/**`, `src/components/dnd/**`, `src/app/(tessera)/projects/page.tsx`, `src/app/(tessera)/projects/[projectId]/{layout.tsx,work-items/**}`, `src/app/actions/{_run,projects,states-labels,work-items}.ts` | P1 day 4 |
| **D Detail, editor, pages** | `src/components/editor/**`, `src/components/detail/**`, `src/components/pages/**`, routes `work-items/[workItemId]/**`, `browse/**`, `pages/**`, `wiki/**`, `projects/[projectId]/pages/**`, `src/app/api/{work-items,pages,search}/**`, `src/app/actions/{relations-comments,pages}.ts` | P2a |
| **E Planning** | `src/components/{planning,intake,drafts,estimates}/**`, routes `projects/[projectId]/{cycles,modules,archives,intake}/**`, `/drafts`, `/active-cycles`, `src/app/actions/{cycles,modules,drafts-intake,estimates}.ts` | P3 |
| **F Views, analytics, settings** | `src/components/{views,analytics}/**`, routes `projects/[projectId]/{views,settings}/**`, `/workspace-views/**`, `/analytics/**`, `src/app/actions/{views,settings,workspace}.ts` | P4 |
| **G Integrations and AI** | `src/lib/tessera/tools/{mcp,anthropic}.ts`, `src/lib/tessera/ai/**`, `src/app/api/{mcp,ai,exports}/**`, `src/components/ai/**`, `src/components/shell/CommandBarAsk.tsx`, `src/app/actions/ai.ts`, `.mcp.json`, `src/instrumentation.ts` | P1 week 2 (MCP), P5 |
| **Q QA** | `tests/**`, `scripts/check-*.ts`, `THIRD_PARTY_NOTICES.md`, `docs/PLAN-STATUS.md` | P1 |

Lane G's files under `src/lib/tessera/` are the only exception to lane A owning that tree.

## Shared files and how to touch them

| File | Owner | Others may |
|---|---|---|
| `package.json` | A | add a dependency only with an exact version and a line in the hand-off note; `npm run check:licenses` must stay green |
| `src/app/globals.css` | B | append one `@import "../components/styles/<area>.css";` line per area |
| `src/themes/paper/icons.tsx` | B | append new Phosphor re-exports |
| `src/app/providers.tsx` | B | append a provider |
| `src/lib/tessera/schemas.ts`, `types.ts` | A | nothing; request the change from lane A |
| `docs/contracts/*.md` | A | nothing; a contract change is a lane A commit that other lanes then follow |

## Legacy handbook files

The files listed in `scripts/check-conventions.ts` under `LEGACY_HANDBOOK_FILES` plus `content/**` belong to no lane until P6, when lane D (pages) imports `content/*.md` and deletes them together with `@milkdown/*`. Until then nobody edits them except to keep `npm run check` green.
