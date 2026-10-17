## P6: Pages and handbook retirement (phase plan)

Draft by the phase planner, 2026-10-17, on `main` at `e03e664`. It assumes the P4
contract (docs/drafts/p4-ui.md, p4-service-api.md, p4-tools.md, p4-plan-notes.md)
and the P5 plan (docs/drafts/p5-plan.md) are delivered:
- the registry and work items are folders (`tools/registry/<domain>.ts`,
  `work-items/*.ts`);
- `db/schema.ts` is the folder `db/schema/` with `pages.ts` (P5 lane 0) and
  migration `0002_ai` exists;
- decisions 29–39 are in docs/PLAN.md;
- `FeaturesSettings` shows the Pages switch disabled ("Pages arrive in P6");
- the assistant panel and `assistant-scope.ts` exist and `describeScope` ignores
  `scope.page_id`.

This is a plan, one level lighter than a contract. A planner refreshes it into the
full P6 contract right before the build. Items marked **refresh before build**
depend on code that P4 or P5 has not written yet, or on a count or line number that
only their results can give.

Sources: docs/PLAN.md U9, decisions 4, 7, 10, 15, 25, 26 and 31, §2 "Pages (P6)" and
the Pages invariants, §4 Pages tools, §5 routes, §9 P6 row, §12 step 7, §13 risk
"Handbook import loses structure"; the 12 files in `content/`; the handbook code
under `src/app/` and `src/lib/`. Astryx props were checked in
`node_modules/@astryxdesign/core/dist/*/*.d.ts` 0.6.8 ("Astryx verification" at the
end).

Exit criteria (PLAN §9 P6) and where they are proven:
- Import test on the 12 files: Vitest `tests/import-handbook.test.ts` on a fixture
  copy of `content/` (12 pages, the tree, every `item:` link rewritten to a
  `page:` link, a second run imports nothing); acceptance steps 1 and 3.
- Page round-trip: Vitest `tests/pages/body.test.ts` "CAS round-trip" and
  `tests/editor/markdown-roundtrip.test.ts` on the 12 imported bodies;
  acceptance step 5.
- `grep -ri milkdown src package.json` is empty: acceptance step 18 and the
  existing `forbidden-package` convention rule.

### 1. Scope and deferrals

Ships in P6:
- **Pages engine**: wiki pages (`project_id` NULL) and project pages. A tree
  (parent, sibling order), lock, access (public or private), archive that propagates
  to descendants, delete after archive, labels (project pages), duplicate, move
  (reparent, reorder, project ↔ wiki), markdown bodies with compare-and-set,
  version rows (collapsed per actor within 5 minutes), embeds extracted on save, and
  back-links. 15 registry tools, so MCP and the assistant get them too.
- **Pages UI**: the Wiki (`/wiki`), the project Pages tab
  (`/projects/[projectId]/pages`), and the page screen (`/pages/[pageId]` for wiki
  pages, `/projects/[projectId]/pages/[pageId]` for project pages). The list is a
  tree with Public, Private and Archived tabs. The page screen has a title, a meta
  row (access, lock, labels, last edit) and the shared `MarkdownEditor` with the
  save queue. There are Move, Delete and archive flows.
- **Editor**: `[[` suggests pages and inserts a `page:<id>` link. `page:` links
  open the page. `useDescriptionSave` serves pages as well as work items. A beacon
  route exists for page bodies.
- **Back-links**: the work item detail shows "Mentioned in" with the pages that
  link to it (PLAN §12 step 7).
- **Handbook import**: `npm run import:handbook` imports the 12 `content/*.md`
  files once into the wiki. It is idempotent.
- **Handbook retirement**: the handbook routes, components, the `lib/workspace*`
  model, the handbook MCP tools, the handbook CSS, the legacy lint and gate
  exemptions and the two Milkdown packages are removed. Home moves from `/home` to
  `/`, and `/home` redirects to `/`.
- **Shell**: the Wiki sidebar item, the project Pages tab, Power K page hits, the
  `n d` and `g d` shortcuts, page shortcuts (`shift+l`, `shift+a`, `shift+r`),
  recents labels for the page routes, and the Pages feature switch.
- **Assistant**: `scope.page_id` (a P5 deferral). On a page route the assistant gets
  the page name, path and the first 4,000 characters of its body.

| Deferred | Phase | Note |
|---|---|---|
| Version history UI (list, diff, restore) for pages and work items | P10 | P6 writes `page_version` rows and ships `list_page_versions` and `restore_page_version` (MCP and assistant). PLAN §1 already puts the UI in P10 |
| Page activity feed on the page screen | P10 (with version history) | Activity rows are written from P6 |
| Favourite a page (star, sidebar Favorites) | P9 | P6 hook: `deletePage` soft-deletes `favorite` rows of the page; `FavoriteEntityTypeSchema` already lists `page` |
| Recent pages widget and `recent_visit` rows | P9 | Recents (localStorage) record page routes from P6 |
| Drag to reorder or reparent in the page tree | P10 (pointer drag pass) | P6 has "Move up", "Move down" and the Move dialog |
| Page outline (table of contents) | P10 | Needs heading ids from the editor; the Astryx `Outline` is ready |
| Page logo picker (icon and colour) | P9 (with the view logo picker) | Rows draw `page.logo` when an agent sets one over MCP |
| Mentions of work items inside work item descriptions ("Mentioned in" from work items) | P7 (with `mention`) | P6 back-links come from pages only |
| Page embeds as block cards (rendered previews) | not planned | Links render as chips |
| Public sharing, publishing, collaborators, cover images | never | U8 |
| `/items/<slug>` redirects for old handbook URLs | not planned | Decision 47 (see open question 5) |
| Removing `content/` from the repo | after P6, once the user imported into `data/tessera.db` | Open question 3 |

### 2. New decisions (lane A writes them into docs/PLAN.md after row 39)

- **40 Page tree.** A page's parent is in the same space: the same project, or the
  wiki for both. The tree is acyclic, and there is no depth limit. `sort_order`
  (decision 4) orders siblings, meaning pages with the same space and the same
  `parent_id`. New pages append at the end of their siblings. `move_page` changes
  the space, the parent and the position in one call. Moving a page moves its
  whole subtree, and every page in the subtree keeps its id. Moving out of a project
  clears the page labels of the subtree, with one `labels` activity row per page.
  Moving into a project with Pages off is refused with `RULE feature_disabled`.
  Embeds and links stay.
- **41 Lock and archive.** A locked page refuses content writes with `LOCKED`: name,
  body, logo, labels, move, restore of a version, and delete. Unlock, access,
  archive, unarchive and duplicate still work. Archiving a page sets the same
  `archived_at` on the page and on every descendant that is not archived yet.
  Unarchive clears it on the page and on the descendants that carry the same
  timestamp. If the parent is still archived, the unarchived page moves to the
  top level of its space. Archived pages are read-only (`ARCHIVED`) except for
  unarchive and delete. Delete needs the page archived first
  (`RULE page_not_archived`) and a `confirm: true`. It soft-deletes that one page,
  its `page_fts` row and its `favorite` rows. Its children become top-level and
  stay archived (PLAN §2 invariant).
- **42 Access is a list filter.** `public` and `private` decide which tab a page
  shows in (Public or Private). There is one user (U8), so nothing is hidden from
  MCP clients or the assistant. Child pages do not inherit access.
- **43 Page bodies.** These follow decision 10, with a page-specific shape:
  - `update_page_body` takes `expected_description_version`, answers `CONFLICT`
    with `{ current_version }` in its details, and bumps `description_version`.
    Name and property writes never bump it.
  - Each body write also writes a `page_version` row `{ name, description_md,
    version }`. If the newest row has the same actor and was created less than
    5 minutes ago, that row is updated in place (text, name, version and
    `created_at`). Otherwise a new row is inserted.
  - `restore_page_version` is a body write: it carries the stored text and name,
    needs CAS and writes its own version row. Old rows are never edited.
  - Activity collapses consecutive `description` rows at read time, as decision 24
    already does for work items.
- **44 Embeds.** Every body write extracts the Markdown link hrefs with an entity
  scheme. The writes that do this are create, body, restore, duplicate and import.
  `page_embed` for that page is then replaced.
  - `work:KEY` is resolved to the work item id at write time, through
    `getWorkItemByKey`, including retired identifiers (decision 29).
  - `page:`, `cycle:` and `module:` refs are kept only when the row exists and is
    not deleted.
  - Links the engine cannot resolve and links to the page itself are skipped.
  - `list_page_backlinks(entity_type, entity_id)` lists the non-deleted pages that
    embed the entity. Archived pages are included and flagged.
- **45 Page routes.**
  - The Wiki list is at `/wiki`.
  - The project list is at `/projects/[projectId]/pages`.
  - A project page is at `/projects/[projectId]/pages/[pageId]`.
  - `/pages/[pageId]` renders a wiki page and redirects a project page to its
    project route, the way `/cycles/[id]` redirects to its cycle.
  - `page:<id>` links and Power K page hits go to `/pages/<id>`.
  - "New page" (button, `n d`, Power K) creates "Untitled" immediately and opens
    it. There is no create dialog. `n d` creates in the current project when it
    has Pages on, and in the wiki otherwise.
- **46 Handbook import.** `importHandbook` reads `content/*.md` once into the wiki
  as actor `user`, in one immediate transaction:
  - The front-matter `title` becomes `name`. `kind` is ignored: a collection is a
    page that has children.
  - `parent` becomes `parent_id`. An unknown parent puts the page at the top level
    with a warning.
  - Siblings are ordered by `order`, then by title.
  - `updated`, when present, sets `updated_at`. `created_at` is the import time.
  - A non-empty `summary` becomes the first paragraph of the body (open
    question 1).
  - `](item:<slug>)` becomes `](page:<uuid>)`. A slug that is not in the set stays
    as text and gives a warning.
  - A body that holds only `<br />` and whitespace becomes empty.
  - Each page keeps its file as `external_source = "handbook"` and
    `external_id = <slug>`. A rerun skips slugs that are already imported, so it
    is idempotent.
  - Each imported page gets one `created` activity row with the comment
    `Imported from content/<file>`.
- **47 Handbook retirement.**
  - Home is `/`. `/home` answers 308 to `/` (`next.config.ts` `redirects()`).
  - `/items/*` is not kept and answers 404.
  - `/api/mcp` registers only the Tessera tools. Its `serverInfo.name` becomes
    `"tessera"` and the handbook sentence leaves its `instructions`.
  - The convention script keeps `@milkdown/` in `FORBIDDEN_PACKAGES` so it cannot
    return.
  - The legacy exemptions (`LEGACY_HANDBOOK_FILES`, `HEX_EXEMPT_LEGACY`,
    `BUDGET_EXEMPT`, the eslint legacy block) are deleted.
- **48 Pages switch.** Decision 31 applies to pages too. With `pages_enabled`
  off, the project hides the Pages tab, its Power K entries and its `n d` target,
  and the engine refuses `create_page`, `duplicate_page` and `move_page` into that
  project with `RULE feature_disabled`. Reads and existing pages stay. The wiki
  has no switch. Wiki pages carry no labels: `update_page` with `label_ids` on a
  wiki page answers `RULE wiki_page_labels`, because labels belong to projects.

### 3. Data model changes

The page tables already exist from `0000_init`: `page`, `page_label`,
`page_version` and `page_embed` (in `db/schema/pages.ts` after the P5 split), and
`page_fts` from `0001_fts`. P6 adds only what the importer needs. Lane A edits
`src/lib/tessera/db/schema/pages.ts` and generates `drizzle/0003_*.sql` with
`npm run db:generate`. It is `0003` because P5 owns `0002_ai` (**refresh before
build**: take the next free index from `drizzle/meta/_journal.json`).

`page`, new columns (mirroring `work_item.external_source` / `external_id`):
| Column | Type | Notes |
|---|---|---|
| `external_source` | text null | `"handbook"` for imported pages; free for later importers |
| `external_id` | text null | the handbook slug (`onboarding`) |

New index: `page_external_uq`, a unique index on `(external_source, external_id)`
`WHERE deleted_at IS NULL AND external_source IS NOT NULL`, through
`uniqueIndex().on().where(sql…)` (PLAN §2 conventions).

New index for sibling reads: `page_space_parent_idx (project_id, parent_id,
sort_order)`. The existing `page_project_idx` and `page_parent_idx` stay.

No other schema change:
- `page.access` uses the existing `PageAccessSchema`.
- `page.logo` uses `LogoSchema`.
- `page_embed.entity_type` gets a zod enum `PageEmbedTypeSchema = z.enum(["work_item",
  "page", "cycle", "module"])` in `schemas.ts` (lane 0). Values are checked in the
  service, not by a CHECK constraint (decision 5).
- `ActivityEntityType` gains `"page"` if the activity zod enum is closed
  (**refresh before build**).

Migration safety follows the existing path: a `VACUUM INTO` backup before a pending
migration, and the stdio server refuses to start until it is run with `--migrate`.
`page` is not recreated (columns are added with `ALTER TABLE … ADD COLUMN`), so no
FTS rebuild is needed. If drizzle-kit chooses to recreate the table, the rule in
docs/contracts/schema.md applies (`npm run db:fts-rebuild`, and `fts.test.ts`
guards it). Lane A checks the generated SQL.

`docs/contracts/schema.md` gets the two columns, the two indexes and the
`PageEmbedTypeSchema` (lane A).

### 4. Engine additions

Lane A owns `src/lib/tessera/**`. Pages are a folder from the start, so no file
nears the 600-line budget. Importers use `./pages` (the folder index).

```
src/lib/tessera/pages/
  index.ts      barrel (export *)
  model.ts      zod inputs, hydrate(row, labels) → PageSummary / PageDetail, space helpers
  read.ts       listPages, getPage, listPageBacklinks, listPageVersions, pageAncestors
  write.ts      createPage, updatePage, duplicatePage
  tree.ts       movePage, descendantIds (recursive CTE), assertSameSpace, assertAcyclic
  lifecycle.ts  lockPage, unlockPage, archivePage, unarchivePage, deletePage
  body.ts       updatePageBody, restorePageVersion, writePageVersion (5-minute collapse)
  embeds.ts     extractEntityRefs(markdown) (pure), replacePageEmbeds(ctx, pageId, md)
src/lib/tessera/import-handbook.ts   parseHandbookFile, planHandbookImport (pure), importHandbook
src/lib/tessera/tools/registry/pages.ts
```

`index.ts` (the engine barrel) exports `./pages` and `./import-handbook`.
`tools/registry/index.ts` appends the `PAGE_TOOLS` array in its domain order, after
views (**refresh before build**: the P4 file name and array convention).

**Client-safe types (`types.ts`, lane 0).** Lane 0 writes them so the UI lanes
can start.
```ts
export type PageSummary = {
  id: string; project_id: string | null; parent_id: string | null; name: string;
  access: PageAccess; is_locked: boolean; logo: Logo | null; archived_at: string | null;
  sort_order: string; label_ids: string[]; child_count: number;
  updated_at: string; updated_by: string;
};
export type PageDetail = PageSummary & {
  description_md: string; description_version: number;
  ancestors: { id: string; name: string }[];          // root first
  embeds: { entity_type: PageEmbedType; entity_id: string }[];
  created_at: string; created_by: string;
};
export type PageBacklink = { id: string; name: string; project_id: string | null; archived_at: string | null };
export type PageVersionInfo = { id: string; version: number; name: string; actor_id: string; created_at: string; length: number; description_md?: string };
export type PageTab = "public" | "private" | "archived";
```

**Zod inputs (`pages/model.ts`).** These are strict objects, and every field has a
`.describe()`.
| Input | Fields |
|---|---|
| `ListPagesInput` | `project_id: IdSchema.nullable()` (null = wiki), `tab?: "public"\|"private"\|"archived"` (default: every non-archived page), `parent_id?: IdSchema.nullable()` (only the children of that page, or only top-level pages), `search?: string` (name substring, at most 200 characters) |
| `PageIdInput` | `page_id` |
| `CreatePageInput` | `project_id: IdSchema.nullable()`, `parent_id?: IdSchema.nullable()`, `name?: string` (1–255, default `"Untitled"`), `description_md?: string` (at most 500,000 characters), `access?: PageAccess` (default `public`), `logo?: LogoSchema.nullable()`, `label_ids?: IdListSchema` |
| `UpdatePageInput` | `page_id`, `name?`, `access?`, `logo?`, `label_ids?` (replace semantics); at least one key |
| `UpdatePageBodyInput` | `page_id`, `description_md`, `expected_description_version: z.int().min(0)` |
| `MovePageInput` | `page_id`, `project_id?: IdSchema.nullable()` (target space, default: the current one), `parent_id?: IdSchema.nullable()`, `before_id?`, `after_id?` (siblings in the target) |
| `ListPageVersionsInput` | `page_id`, `limit?: 1–100` (default 20), `include_body?: boolean` (default false) |
| `RestorePageVersionInput` | `page_id`, `version_id`, `expected_description_version` |
| `ListPageBacklinksInput` | `entity_type: PageEmbedTypeSchema`, `entity_id: IdSchema` |

**Tools (`tools/registry/pages.ts`, `phase: "P6"`, 15 in total).** The
`registry.test.ts` one-to-one rule (decision 26) covers every mutating export.
| Tool | mutates | destructive | core | Service |
|---|---|---|---|---|
| `list_pages` | no | | yes | `listPages` → `PageSummary[]` in tree order (depth-first, siblings by `sort_order`) |
| `get_page` | no | | yes | `getPage` → `PageDetail` |
| `list_page_backlinks` | no | | yes | `listPageBacklinks` → `PageBacklink[]` |
| `list_page_versions` | no | | | `listPageVersions` → `PageVersionInfo[]`, newest first |
| `create_page` | yes | | yes | `createPage` |
| `update_page` | yes | | yes | `updatePage` |
| `update_page_body` | yes | | yes | `updatePageBody` → `{ id, description_version }` |
| `move_page` | yes | | | `movePage` |
| `duplicate_page` | yes | | | `duplicatePage`: `"<name> (Copy)"`, body, access, labels and logo copied; children, lock and versions are not; placed right after the source |
| `lock_page`, `unlock_page` | yes | | | `lockPage`, `unlockPage` |
| `archive_page`, `unarchive_page` | yes | | | `archivePage`, `unarchivePage` |
| `restore_page_version` | yes | | | `restorePageVersion` |
| `delete_page` | yes | yes | | `deletePage` (decision 41) |

PLAN §4 abbreviates these as `lock/unlock`, `update_body`, `list_embeds` and so on.
The full names above replace that row (lane A edits PLAN §4). `list_embeds` becomes
`list_page_backlinks`, and `get_page` returns the outgoing embeds.

**Rules and errors.** Each rule has a Vitest case.
- `NOT_FOUND` for a missing or deleted page, parent, target project, label or
  version (a version of another page counts as missing).
- `VALIDATION` for a parent in another space, a cycle (moving under its own
  descendant), and `before_id`/`after_id` that are not siblings in the target.
- `RULE feature_disabled` (decision 48), `RULE wiki_page_labels`, and
  `RULE page_not_archived` on delete.
- `LOCKED` and `ARCHIVED` per decision 41. A page of an archived project is
  `ARCHIVED`, the same as its work items.
- `CONFLICT` with `details.current_version` on a stale
  `expected_description_version`.
- Labels must belong to the page's project.

**Side effects in the same immediate transaction (`withTx`).**
- `upsertPageFts` runs on create, rename, body, restore, duplicate and import.
  `deletePageFts` runs on delete. Moving a page into or out of a project re-upserts
  every page of the subtree, because `project_id` is in the FTS row. Archive keeps
  the FTS row: `search.ts` already filters archived pages.
- `replacePageEmbeds` runs on every body write (decision 44).
- Activity: `entity_type "page"`, `project_id` = the page's project (null for
  wiki), `work_item_id` null. The verbs are `created`, `updated` (with the field
  `name`, `access`, `logo`, `labels`, `parent`, `project` or `sort_order`),
  `description` (a body write), `locked`, `unlocked`, `archived`, `unarchived`,
  `deleted` and `restored` (with `new_value` = the version number). Archive and
  unarchive write one row per affected page. The change cursor therefore moves, and
  `ChangesPoller` refreshes open tabs on writes made by agents.
- `writePageVersion` per decision 43.

**Search and counts.** `searchAll` already returns page hits (`search.ts`
`pageHits`). No change except a test that a moved page's hit carries its new
`project_id`. Pages are not part of `getCounts`.

**Assistant (P5 deferral).** `describeScope` in `src/lib/tessera/ai/prompts.ts`
renders `scope.page_id`:
- the page name;
- the space ("Wiki" or the project name);
- the ancestors' names;
- lock and archive state;
- the first 4,000 characters of the body.

The page tools reach the assistant as read tools and `propose_*` stubs
automatically (decision 36 sends the whole registry). **Refresh before build**:
the P5 function names.

**Importer (`import-handbook.ts`).**
- `parseHandbookFile(file: string, text: string): HandbookEntry | { error }`. A
  small front-matter parser handles `key: value` lines and JSON-quoted values, the
  same grammar as the handbook's `parseFrontmatter`. No YAML dependency.
  `HandbookEntry = { slug, file, title, kind, parent: string | null, summary,
  order: number, updated: string | null, body }`.
- `planHandbookImport(entries, existing: Set<slug>)` is pure. It returns the
  topologically ordered entries to create, the slugs it skips and warnings for
  unknown parents, unknown links, duplicate slugs and bad front matter.
- `importHandbook(ctx, entries)` returns `{ created: { slug, id }[], skipped:
  string[], warnings: string[] }`.
  - It allocates ids first, then rewrites `item:` links to `page:` links, then
    inserts the rows. Inserts go through an internal `insertPage` that shares
    `createPage`'s code path: FTS, embeds, the version row and the activity row
    with its comment.
  - It writes `updated_at` from front matter.
  - It runs in one `withTx` and is all or nothing.
- `scripts/import-handbook.ts` replaces the placeholder:
  - It loads `.env.local`, prints the absolute DB path, reads
    `content/*.md` (or `--dir <path>`), opens the DB (migrations run as usual)
    and calls `importHandbook` as actor `user`.
  - It prints `Imported N pages, skipped M` plus the warnings, and exits 1 on
    parse errors.
  - `--dry-run` prints the plan and writes nothing.
  - It is not a registry tool, because it reads the file system. It is a
    one-time CLI, like `db:seed`.

**Tests (lane A).**
- `tests/pages/tree.test.ts`: create in the wiki and in a project, sibling
  order, the cycle refusal, the space refusal, a subtree move to the wiki that keeps
  ids and clears labels, a move into a project with Pages off, reordering with
  `before_id`/`after_id`.
- `tests/pages/lifecycle.test.ts`: lock refusals per decision 41, archive
  propagation, unarchive with an archived parent, delete before archive refused,
  delete re-parenting the children, the favourite rows soft-deleted, a locked
  delete refused.
- `tests/pages/body.test.ts`: the CAS round-trip, conflict details, the 5-minute
  version collapse (actor and time through `ctx.now`), restore, a name change that
  does not bump the version, the FTS row updated.
- `tests/pages/embeds.test.ts`: `extractEntityRefs` on links, code fences (links
  inside code are ignored), duplicates and self links; `work:` resolution including
  a retired identifier; back-links listing archived pages.
- `tests/pages/tools.test.ts`: the 15 tools over `runToolWithContext`, `delete_page`
  needing `confirm` over MCP (`tests/mcp.test.ts` pattern), and Pages feature
  refusals.
- `tests/import-handbook.test.ts`: a fixture copy of the 12 files in
  `tests/fixtures/handbook/` (lane A copies `content/*.md` byte for byte, so the
  test survives the later removal of `content/`). It checks:
  - 12 pages and three roots in order (Getting started, How we work, People);
  - Getting started's children (First week, Setup, Onboarding) and Setup › Accounts;
  - every `item:` link rewritten and resolvable through `page_embed`;
  - `untitled.md` is empty after the `<br />` normalisation;
  - a second run gives `created: []` and `skipped.length === 12`;
  - an unknown parent gives a warning and a top-level page.
- `tests/editor/markdown-roundtrip.test.ts` (lane P2 adds the case): every imported
  fixture body, after the link rewrite, is stable after one parse and serialise
  cycle and loses no text.
- `tests/registry.test.ts`: tool count 91 + 15 (**refresh before build**: the P5
  count).
- `tests/fts.test.ts`: page FTS after migration `0003`.

### 5. Routes and data loading

All reads follow the field guide: a synchronous shell, then `<Suspense>` with a real
fallback, then an async child that awaits `params`, calls `await io()` and then
`readTessera(fn)` from `@/lib/tessera/server`. Mutations go through
`toolAction(...)` in `src/app/actions/pages.ts`. `redirect()` and `notFound()` are
called outside `try`.

| Route | File | Reads | Fallback |
|---|---|---|---|
| `/` | `src/app/(tessera)/page.tsx` (moved from `home/page.tsx`, content unchanged except the doc comment) | `listProjects` as today | as today |
| `/home` | none: `next.config.ts` `redirects()` → `{ source: "/home", destination: "/", permanent: true }` | | |
| `/wiki` | `src/app/(tessera)/wiki/page.tsx` | `listPages(ctx, { project_id: null, tab })`, with `tab` from `?tab=` (`public` default, `private`, `archived`) | 6 × `Skeleton height={36}` |
| `/pages/[pageId]` | `src/app/(tessera)/pages/[pageId]/page.tsx` | `getPage`; a project page leads to `redirect(/projects/<pid>/pages/<id>)`; missing or deleted leads to `notFound()` | `PageScreenSkeleton` |
| `/projects/[projectId]/pages` | `src/app/(tessera)/projects/[projectId]/pages/page.tsx` | the project bundle (layout) and `listPages(ctx, { project_id, tab })`; Pages off renders the P4 feature-off screen, like cycles and modules | 6 × `Skeleton height={36}` |
| `/projects/[projectId]/pages/[pageId]` | `.../pages/[pageId]/page.tsx` | `getPage`; a page of another project or of the wiki redirects to its canonical route | `PageScreenSkeleton` |
| `POST /api/pages/[pageId]/body` | `src/app/api/pages/[pageId]/body/route.ts` | the beacon target, the same contract as the work item description route (`if_current_md` included) | |

- The two page screens load the same bundle through
  `src/app/(tessera)/pages/load-page.ts`.
- The bundle is `loadPageBundle(ctx, pageId): { page: PageDetail; labels:
  Label[] | null; actors: Actor[] }`. `labels` holds the project
  labels, or null for a wiki page. `actors` is used for "Edited by" and the `@`
  suggestions.

The work item description beacon logic moves into
`src/app/api/description-beacon.ts`:
```ts
handleDescriptionBeacon(req, { tool: "update_work_item_description" | "update_page_body", idField: "work_item_id" | "page_id", id, readCurrent(ctx): { description_md, description_version } })
```
Both routes become thin wrappers around it.

"Mentioned in": `src/app/(tessera)/work-items/load-detail.ts` adds
`backlinks: PageBacklink[]` from `listPageBacklinks(ctx, { entity_type:
"work_item", entity_id })` to the detail bundle. **Refresh before build**: the P4
bundle shape.

**Recents (`src/components/shell/recents.ts`, `resolveRoute`).** `RouteIconKey`
gains `"wiki"` and `"pages"`. `shell-icons.ts` maps `wiki → BookOpenIcon` and
`pages → FilesIcon`; `page` stays `PageIcon`.
| Path | Label | Icon |
|---|---|---|
| `/` | Home | `home` (already; `/` and `/home` stay unrecordable) |
| `/wiki` | Wiki | `wiki` |
| `/pages/[pageId]` | `entityLabel(pageId) ?? "Page"` | `page` |
| `/projects/[id]/pages` | `<project> · Pages` | `pages` |
| `/projects/[id]/pages/[pageId]` | `<project> · <entityLabel(pageId) ?? "Page">` | `page` |

The page screen calls `registerEntityLabel(page.id, page.name)` (entity-labels.ts)
on mount and on rename. `tests/ui/recents.test.ts` gains the five cases. On delete,
the page screen calls `forgetRecentsUnder` for both page paths (field guide,
"Shell").

### 6. Screens and components

Global rules apply: no raw `<div>` or `<span>`, tokens only, and icons from
`src/themes/catppuccin/icons.tsx`. `Dialog` and `AlertDialog` come from
`@/components/shell/dialogs`. Panel headers use `PanelHeader`, `PanelBar` and
`PanelTitle`, never an Astryx Toolbar. Layout classes live in the new
`src/components/styles/pages.css` (lane 0 creates it and adds its `@import` to
`globals.css`).

**`PagesScreen`** (`src/components/pages/PagesScreen.tsx`, client). It is shared
by `/wiki` and the project Pages tab, with props
`{ space: { kind: "wiki" } | { kind: "project"; project: Project }; tab: PageTab;
pages: PageSummary[]; labels: Label[] | null }`.
- Header for the wiki: `PanelHeader label="Wiki"` with `PanelTitle` "Wiki". The
  project tab uses the project frame's header (no second title row, field guide).
- Sub-header `PanelBar`:
  - start: `TabList value={tab} onChange={…} size="sm"` with
    `Tab value="public" label="Public"`, `"private"` and `"archived"`. The tab is
    written to `?tab=` with `router.replace`.
  - end: a search `TextInput label="Search pages" isLabelHidden size="sm"
    startIcon={SearchIcon} hasClear` that filters names client-side, and
    `Button variant="primary" size="sm" label="New page"` (hidden on Archived).
- Body: `TreeList items={toTreeItems(pages)} density="compact"
  variant="lineGuides" aria-label="Pages"`.
- The pure `src/components/pages/page-tree.ts` builds the items: `id`, `label`
  (name), `startContent` (`Icon` of the page logo or `PageIcon`), `href` (the
  canonical page route), `isExpanded` (true for the first level) and `children`.
  `endContent` holds a lock `Icon` when locked, label `Token`s (at most 2), and
  `PageRowMenu`.
- With a search query the tree flattens to the matching rows plus their
  ancestors.
- Empty: `EmptyState title="No pages yet" description="Pages hold specs, notes and
  decisions." icon={<Icon icon={PageIcon} />} actions={New page button}`. On
  Archived: `title="No archived pages"`, with no action.

**`PageRowMenu`** (`MoreMenu label="Page actions" size="sm" variant="ghost"`). It
offers:
- Open;
- Add sub-page;
- Duplicate;
- Move up and Move down (`move_page` with `before_id`/`after_id`);
- Move… (opens `MovePageDialog`);
- Lock or Unlock;
- Make private or Make public;
- Copy link;
- Archive, or Restore and Delete… on the Archived tab.

Locked pages disable the content items with `disabledMessage="Unlock the page
first"` (**refresh before build**: the `MoreMenu` item shape is `DropdownMenuOption`).

**`PageScreen`** (`src/components/pages/PageScreen.tsx`, client) uses
`PanelPage width="reading"`.
- Header `PanelBar`:
  - start: `Breadcrumbs` with `BreadcrumbItem href` for the space ("Wiki" or
    "<project> · Pages") and the ancestors, and `isCurrent` on the page.
  - end: `IconButton` lock toggle (`LockIcon` / `LockOpenIcon`, `label` "Lock page"
    / "Unlock page", `shift+l`), and `PageMenu` (the `PageRowMenu` items minus
    Open).
- `PageTitle`, the `DetailTitle` pattern of `WorkItemDetail.tsx`: a `Heading
  level={1}` that switches to `TextInput label="Title" isLabelHidden size="lg"`
  on click. It is read-only when the page is locked or archived.
- `PageMeta`, an `HStack gap={2}`:
  - an access `Token` (`GlobeIcon` "Public" or `EyeSlashIcon` "Private"); clicking
    it or `shift+a` toggles access;
  - a locked `Token` when locked;
  - for project pages, a labels `MultiSelector label="Labels" isLabelHidden
    size="sm" options={labels} value onChange` that calls `update_page`
    (`label_ids`);
  - `Text type="supporting" color="secondary"` "Edited <RelativeTime> by <actor>".
- Archived: `Banner status="warning" title="This page is archived"` with
  `endContent` holding `Button label="Restore"` and `Button label="Delete…"`.
  Locked: `Banner status="info" title="This page is locked"` with `Button
  label="Unlock"`.
- Body: `PageBodyEditor` (lane P2) with `readOnly` when locked or archived.
- Shortcuts while the screen is focused (registered through `useShortcuts`):
  `shift+l` lock, `shift+a` access, `shift+r` archive or restore, `mod+.` copy
  link.

**`MovePageDialog`** (`Dialog`, title "Move page"):
- `Selector label="Space"` offers "Wiki" and the projects with Pages on.
- `Selector label="Parent" hasSearch` offers "Top level" and the pages of the
  chosen space, excluding the page and its subtree. They load when the space
  changes, through `listPagesAction({ project_id })` in `actions/pages.ts` (the
  read tool wrapper `toolAction("list_pages")`; the route files already hold the
  current space's pages).
- Footer: Cancel and "Move" call `move_page`. A notice under the selectors says
  "Labels are removed when a page leaves its project." when the space changes from
  a project.

**`DeletePageDialog`** (`AlertDialog`):
- title: "Delete page";
- body: "<name> is deleted. Its sub-pages move to the top level.";
- actions: Cancel and a destructive "Delete".
- After the delete it calls `forgetRecentsUnder` and navigates to the list.

**Lane P2 components.**
- `useDescriptionSave` takes `target: { kind: "work_item" | "page"; id: string }`
  in place of `workItemId`. The action is `updateWorkItemDescriptionAction` or
  `updatePageBodyAction`, the beacon URL is the matching route, and the beacon
  marker records `target`. `DescriptionEditor` passes
  `{ kind: "work_item", id }`. `tests/editor/description-save.test.ts` is updated
  and gains page cases.
- `src/components/pages/PageBodyEditor.tsx` composes `MarkdownEditor`,
  `useDescriptionSave` and the same Banner states as `DescriptionEditor`. The shared
  Banner block moves into `src/components/editor/SaveBanners.tsx`, so both hosts use
  one component. Entity link clicks:
  - `work:` opens the work item: peek inside its own project, `/browse/<key>`
    elsewhere;
  - `page:`, `cycle:` and `module:` use `entityRoute`.
- `links.ts` `entityRoute`: `page` → `/pages/<id>`.
- `mentions.tsx`: the `[[` trigger becomes a `SuggestionTrigger` with
  `debounce: 150` and `allow: outsideCode`. Its items come from
  `GET /api/search?q=<query>&types=page&limit=8`, with "All pages" when the query
  is empty. Its command inserts the link `[<name>](page:<id>)` (an
  `insertPageLink` helper next to `insertWorkItemLink`). The empty text is
  "No pages match" and the heading is "Pages". `extensions.ts` moves `page` from
  the mention list to the suggestion list.
- `src/components/detail/MentionedIn.tsx` is a `List density="compact"
  header="Mentioned in"` with one `ListItem` per back-link (`PageIcon`, the name,
  `href` `/pages/<id>`, "Archived" `Token` when archived). It renders nothing when
  the list is empty. It is placed in `WorkItemDetail` after the sub-items
  (**refresh before build**: the P4 detail layout).

**Lane H shell edits.**
- `Sidebar.tsx`: `SideNavItem label="Wiki" icon={BookOpenIcon} href="/wiki"`
  after Home. Home's `href` becomes `/` with `isSelected={pathname === "/"}`.
- `project-tabs.ts`: a Pages tab after Views when `pages_enabled`.
- `FeaturesSettings.tsx`: the Pages switch becomes live (`pages_enabled`,
  description "Documents for the project.").
- `CommandBar.tsx`: a page hit runs `router.push('/pages/' + hit.id)`.
- `command-source.ts`: `create.page` and `nav.pages` get commands.
- `shortcuts.ts`: the `arrives: "P6"` flags are removed and the page shortcuts are
  listed in the shortcut sheet.
- `useShortcuts.ts`: `g h` → `/`; `g d` goes to the current project's Pages when
  it is on, else `/wiki`; `n d` per decision 45.
- `/home` → `/` in `TopBar.tsx`, `NotFoundScreen.tsx`, `SidebarSkeleton.tsx`,
  `Sidebar.tsx` and `(tessera)/error.tsx`.

**Astryx verification (0.6.8, `dist/*/*.d.ts`, 2026-10-17).**
| Component | Props used | Checked in |
|---|---|---|
| `TreeList` | `items`, `density` (`compact`), `variant`, `header`, `aria-label` | `TreeList/TreeList.d.ts` |
| `TreeListItemData` | `id`, `label`, `description`, `startContent`, `endContent`, `children`, `href`, `isSelected`, `isExpanded`, `isDisabled`, `className` | `TreeList/TreeListTypes.d.ts` |
| `Breadcrumbs`, `BreadcrumbItem` | `label`; `href`, `isCurrent`, `startIcon`, `menu` | `Breadcrumbs/*.d.ts` |
| `TabList`, `Tab` | `value`, `onChange`, `size`, `hasDivider`; `value`, `label`, `icon`, `href` | `TabList/*.d.ts` |
| `EmptyState` | `title`, `description`, `icon`, `actions`, `headingLevel`, `isCompact` | `EmptyState/EmptyState.d.ts` |
| `MoreMenu` | `items`, `label`, `variant`, `size`, `isMenuOpen`, `onOpenChange` | `MoreMenu/MoreMenu.d.ts` |
| `TextInput` | `label`, `isLabelHidden`, `size`, `value`, `onChange`, `onEnter`, `onKeyDown`, `hasAutoFocus`, `hasClear`, `startIcon` | `TextInput/TextInput.d.ts` |
| `MultiSelector` | `label`, `isLabelHidden`, `options`, `value`, `onChange`, `size`, `hasSearch`, `maxBadges` | `MultiSelector/MultiSelector.d.ts` |
| `Selector` | `label`, `options`, `value`, `onChange`, `hasSearch`, `size` | `Selector/Selector.d.ts` |
| `Token` | `label`, `icon`, `color`, `size`, `onClick` | `Token/Token.d.ts` |
| `Banner` | `status`, `title`, `description`, `endContent` | `Banner/Banner.d.ts` |
| `Outline` (deferred to P10) | `items`, `activeId`, `scrollContainerRef` | `Outline/Outline.d.ts` |

**Icons (lane 0, `icons.tsx`).** `BookOpenIcon` (Phosphor `BookOpen`), `FilesIcon`
(`Files`), `LockIcon` (`LockSimple`), `LockOpenIcon` (`LockSimpleOpen`),
`GlobeIcon` (`Globe`) and `EyeSlashIcon` (`EyeSlash`) are added as `duotoneIcon`
exports. They join the existing `PageIcon` (`FileText`). `Globe` and `EyeSlash`
are already imported for the logo registry, so only the exports are new.

### 7. Lane split for swarm workers

**Order.** Lane 0 runs alone and commits on its own. Then lanes A, P1, P2 and H
start together in the shared checkout.
- Lane A lands its public signatures first (step A0): `pages/model.ts`, the
  `types.ts` additions it needs beyond lane 0's, empty-bodied service functions
  that throw `TrackerError("RULE", "not_implemented")`, and the registry entries.
  UI lanes can then type-check against them.
- UI steps that need lane A are marked **[needs A]** and come last in each lane's
  list.
- P1's `PageScreen` needs P2's `PageBodyEditor`. P2 lands that file's exported
  signature first (step P2-0):
  `PageBodyEditor({ pageId, text, version, readOnly }: PageBodyEditorProps)`.
  P1 marks the step **[needs P2]**.
- The destructive half of lane H (steps H5–H7) starts only after lane A reports
  `tests/import-handbook.test.ts` green (PLAN §13: "old routes stay until the
  import is verified").
- No UI-to-UI stubs are expected. If one is needed, its first line is
  `// STUB(P6): replaced by lane <X>`, and `grep -rn "STUB(P6)" src` must be
  empty at the gate.

**File budget.** No file on `scripts/file-budget.json` has to grow:
- The registry and work items are folders (P4) and the schema is a folder (P5).
- `CommandBar.tsx` (616) changes one `case` body.
- `page-body.tsx` and `document-table.tsx` (exempt) are deleted.

If at refresh `CommandBar.tsx` would grow (because `n d` or `g d` are handled
inside it), lane 0 first moves its search-hit routing into
`src/components/shell/command-hits.ts` as `hitRoute(hit: SearchHit, context):
string | null`, a pure function with a test, and lowers the budget entry
(**refresh before build**).

| Lane | Creates | Edits (only these) | Must not touch |
|---|---|---|---|
| 0 prep | `src/components/styles/pages.css` (header comment only); `src/components/shell/command-hits.ts` + `tests/ui/command-hits.test.ts` (only if the budget check above requires it) | `src/themes/catppuccin/icons.tsx` (6 exports); `src/lib/tessera/types.ts` (page types §4); `src/lib/tessera/schemas.ts` (`PageEmbedTypeSchema`, `PageTabSchema`); `src/app/globals.css` (adds the `pages.css` import; deletes lines 26–403, every `[data-milkdown-root]` and `.handbook-*` rule, keeping the imports, `body` and `.tessera-root-frame`); `CommandBar.tsx` + `scripts/file-budget.json` only for the conditional split | everything else |
| A engine | `src/lib/tessera/pages/{index,model,read,write,tree,lifecycle,body,embeds}.ts`; `src/lib/tessera/import-handbook.ts`; `src/lib/tessera/tools/registry/pages.ts`; `drizzle/0003_*.sql` + `drizzle/meta/*` (generated); `tests/pages/{tree,lifecycle,body,embeds,tools}.test.ts`; `tests/import-handbook.test.ts`; `tests/fixtures/handbook/*.md` (12 copies) | `src/lib/tessera/db/schema/pages.ts`; `src/lib/tessera/index.ts`; `src/lib/tessera/server.ts` (only if it lists exports); `src/lib/tessera/tools/registry/index.ts`; `src/lib/tessera/activity.ts` (entity type, only if closed); `src/lib/tessera/ai/prompts.ts` (`describeScope` page block); `scripts/import-handbook.ts`; `tests/{registry,fts,search}.test.ts`; `docs/contracts/{schema,service-api,tools,ai}.md`; `docs/PLAN.md` (decisions 40–48, §4 Pages row, §9 P6 row and deferrals, §13); `docs/contracts/OWNERS.md` | `src/app/**`, `src/components/**`, `package.json` |
| P1 pages UI | `src/app/(tessera)/wiki/page.tsx`; `src/app/(tessera)/pages/[pageId]/page.tsx`; `src/app/(tessera)/pages/load-page.ts`; `src/app/(tessera)/projects/[projectId]/pages/page.tsx`; `.../pages/[pageId]/page.tsx`; `src/app/actions/pages.ts`; `src/components/pages/{PagesScreen,PageRowMenu,PageScreen,PageTitle,PageMeta,MovePageDialog,DeletePageDialog,PageScreenSkeleton}.tsx`; `src/components/pages/{page-tree,page-menu-items,index}.ts`; `tests/ui/{page-tree,page-menu-items,pages-screen}.test.ts(x)` | `src/components/styles/pages.css`; `src/components/work-items/project-tabs.ts` (Pages tab); `src/components/project-settings/FeaturesSettings.tsx` (live switch); `src/components/ai/assistant-scope.ts` (`page_id` from both page routes) + its test; `docs/contracts/ui.md` (new "Pages (P6)" section) | the editor, `components/detail/**`, `components/shell/**`, `src/lib/**` |
| P2 editor and back-links | `src/components/pages/PageBodyEditor.tsx`; `src/components/editor/SaveBanners.tsx`; `src/components/detail/MentionedIn.tsx`; `src/app/api/description-beacon.ts`; `src/app/api/pages/[pageId]/body/route.ts`; `tests/editor/page-links.test.ts` | `src/components/editor/{useDescriptionSave.ts,links.ts,mentions.tsx,extensions.ts,index.ts}`; `src/components/detail/{DescriptionEditor.tsx,WorkItemDetail.tsx,index.ts}`; `src/app/api/work-items/[workItemId]/description/route.ts`; `src/app/(tessera)/work-items/load-detail.ts` (`backlinks`); `src/components/styles/{editor,detail}.css`; `tests/editor/{description-save,markdown-roundtrip,markdown-editor}.test.ts`; `docs/contracts/editor.md` | `src/components/pages/*` except `PageBodyEditor.tsx`, shell, `src/lib/**` |
| H retirement and shell | `src/app/(tessera)/page.tsx` (the content of `home/page.tsx`, written new; the old file is deleted in the same step, no git commands) | **Deletes (H6):** `src/app/(handbook)/layout.tsx`, `src/app/(handbook)/page.tsx`, `src/app/(handbook)/items/[id]/page.tsx`, `src/app/(tessera)/home/page.tsx`, `src/app/actions.ts`, `src/app/document-editor.tsx`, `src/app/document-table.tsx`, `src/app/item-screen.tsx`, `src/app/page-body.tsx`, `src/app/page-column.tsx`, `src/app/page-outline.tsx`, `src/app/page-tabs.tsx`, `src/app/page.module.css`, `src/app/search-dialog.tsx`, `src/app/workspace-frame.tsx`, `src/app/workspace-screen.tsx`, `src/app/workspace-shell.tsx`, `src/lib/workspace.ts`, `src/lib/workspace-model.ts`. **Edits:** `src/app/api/mcp/route.ts` (handbook tools, imports, helpers `text`/`failure` if unused, instructions, `serverInfo.name: "tessera"`); `src/app/layout.tsx` (doc comment); `next.config.ts` (`redirects()`); `eslint.config.mjs` (legacy block); `scripts/check-conventions.ts` (`LEGACY_HANDBOOK_FILES`, `HEX_EXEMPT_LEGACY`, `BUDGET_EXEMPT`, the `src/app/items/` test and their uses); `package.json` + `package-lock.json` (`npm uninstall @milkdown/kit @milkdown/react`); `src/components/shell/{Sidebar,SidebarSkeleton,TopBar,NotFoundScreen,CommandBar,command-source,shortcuts,useShortcuts,recents,shell-icons}.ts(x)`; `src/app/(tessera)/error.tsx`; `tests/ui/{recents,shortcuts}.test.ts`; `tests/convention-rules.test.ts` (if it names legacy files); `docs/contracts/ui.md` (Shell and Home lines only: `/home` → `/`); `docs/process/swarm.md` (the handbook exemption sentence) | `src/lib/tessera/**`, `components/pages/**`, `components/editor/**` |

`docs/contracts/ui.md` has two editors with separate sections: P1 appends the
"Pages (P6)" section, and H edits only the existing Shell and Home lines.

**Leaf tasks per lane** (each one keeps `npm run check` green for its files).
- **0**:
  - 0.1 icons;
  - 0.2 types and schemas;
  - 0.3 `pages.css` and `globals.css`;
  - 0.4 the conditional `CommandBar` split;
  - gate: `npm run check` and `next build`.
- **A**:
  - A0 signatures;
  - A1 schema and migration (`drizzle-kit generate` yields only the `ALTER`s and
    indexes);
  - A2 read and write;
  - A3 tree;
  - A4 lifecycle;
  - A5 body, versions and embeds;
  - A6 registry tools and the registry test;
  - A7 importer, script and fixture test;
  - A8 `describeScope`;
  - A9 docs and PLAN.
- **P1**:
  - P1.1 `page-tree.ts` and `page-menu-items.ts` with their tests;
  - P1.2 `PagesScreen` and `PageRowMenu`;
  - P1.3 routes, `load-page.ts` and actions **[needs A]**;
  - P1.4 `PageScreen`, `PageTitle` and `PageMeta` **[needs P2]**;
  - P1.5 Move and Delete dialogs;
  - P1.6 the project tab and Features switch;
  - P1.7 assistant scope;
  - P1.8 the `ui.md` section.
- **P2**:
  - P2-0 the `PageBodyEditor` signature;
  - P2.1 `useDescriptionSave` target generalisation and tests;
  - P2.2 `SaveBanners` extraction;
  - P2.3 the beacon helper and routes;
  - P2.4 `links.ts` and the `[[` page suggestion;
  - P2.5 `PageBodyEditor`;
  - P2.6 `MentionedIn` and `load-detail` **[needs A]**;
  - P2.7 the round-trip corpus with the fixtures **[needs A7]**.
- **H**:
  - H1 recents and shell icons;
  - H2 Sidebar, the `/` links and shortcuts;
  - H3 CommandBar and command source;
  - H4 `next.config.ts` redirects;
  - H5 the MCP route;
  - H6 Home move and the deletions, in one step **[needs A7 green]**;
  - H7 eslint, the convention script, the Milkdown uninstall and docs. Gate:
    `npm run check`, `grep -ri milkdown src package.json` empty, `next build`.

### 8. New dependencies

None. P6 removes `@milkdown/kit` and `@milkdown/react` (`^7.22.2`, MIT) with
`npm uninstall` in lane H7. The front-matter parser is about 30 lines in
`import-handbook.ts`, so no YAML or front-matter package is added. After the
uninstall, `npm run check` runs `scripts/check-licenses.ts`. The gate cannot fail
on a removal, but the lockfile must not list `@milkdown/*` anywhere
(`grep -c milkdown package-lock.json` gives 0). `@phosphor-icons/react` stays,
because `icons.tsx` uses it.

### 9. Acceptance (on a fresh `data/p6-acceptance.db` after `next build`)

Setup, by the acceptance worker:
1. Stop any dev server.
2. Move an old `data/p6-acceptance.db*` to the scratchpad.
3. Run `export PATH=/opt/homebrew/bin:$PATH; TESSERA_DB_PATH=data/p6-acceptance.db npx next build`.
4. Then run `TESSERA_DB_PATH=data/p6-acceptance.db node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000` in the background.
5. Check every screen in Frappé and Latte at 1440 and 375 and read the console on
   each. Only the Astryx Table warnings are tolerated.

1. Run `TESSERA_DB_PATH=data/p6-acceptance.db npm run import:handbook`. It prints
   the absolute DB path and `Imported 12 pages, skipped 0`, with no warnings. Run
   it again: `Imported 0 pages, skipped 12`.
2. `/` shows Home: Recents, the "Since you were last here" card and the project
   rows. `/home` answers 308 to `/`. `/items/onboarding` shows the not-found
   screen. The Tessera brand and the sidebar "Work" heading lead to `/`.
3. Sidebar › Wiki opens `/wiki`, Public tab. The tree is:
   - Getting started › First week, Setup › Accounts, Onboarding;
   - How we work › Meetings, Decisions, Untitled collection › YEah;
   - People › Who does what.

   The Private and Archived tabs are empty.
4. Open Getting started. The body shows three link chips. Click "Onboarding": it
   opens `/pages/<id>`, the breadcrumb reads Wiki › Getting started › Onboarding,
   and the Onboarding table renders as a table with no lossy-parse Banner.
5. In Onboarding, type a sentence, wait 1 s and reload: it persists. Type again and
   reload within 300 ms: the beacon persists it. Running
   `TESSERA_DB_PATH=data/p6-acceptance.db npx tsx scripts/mcp-call.ts
   tessera_list_page_versions '{"page_id":"<id>"}'` shows one collapsed row by
   `user`.
6. Create project "Web" (WEB) and the work item WEB-1 "Ship pages". In the wiki,
   New page creates "Untitled" and opens it. Rename it to "Release notes", type
   `#WEB`, pick WEB-1 and reload: the chip resolves. Open WEB-1: "Mentioned in"
   lists Release notes, and clicking it opens the page. Type a line into WEB-1's
   description and reload: it persists (the generalised save queue).
7. In Release notes type `[[mee`, pick Meetings and click the chip: it opens
   Meetings.
8. In WEB, the Pages tab shows and is empty (EmptyState). New page, rename it
   "Spec", add a label, then Make private. Spec moves to the Private tab. Recents
   on Home show "Web · Spec", "Web · Pages", "Release notes" and "Wiki" with
   their icons.
9. On Spec, Add sub-page "Spec details". Move… Spec to Wiki › Top level. The
   notice about labels shows. After the move the URL is `/pages/<same id>`, the
   label is gone, and "Spec details" is still its child.
10. On Spec press `shift+l`. The lock icon and the "This page is locked" Banner
    show, and the title and body are read-only. `tessera_update_page_body` over
    `mcp-call.ts` returns `LOCKED`. Unlock with the Banner button.
11. Press `shift+r` on Spec. Spec and Spec details are both in the Archived tab;
    the page shows the archived Banner and is read-only. Restore: both come back.
12. Archive Spec again, then Delete… from the Archived tab. The AlertDialog names
    the page; confirm. Spec is gone, Spec details is top-level under Archived, and
    Recents no longer list Spec.
13. WEB › Settings › Features: turn Pages off. The Pages tab disappears, `g d`
    from WEB opens `/wiki`, and `tessera_create_page` for WEB returns
    `RULE feature_disabled`. Turn it back on.
14. Power K: type "onboarding", pick the page hit, and Onboarding opens. `n d` on
    the wiki creates and opens an Untitled page. The shortcut sheet (`mod+/`) lists
    the page shortcuts without "Arrives in P6".
15. Run `tessera_move_page` over MCP to put Decisions under Meetings. Within 5 s
    the open `/wiki` tab shows the change (ChangesPoller).
16. If a credential resolves: on Onboarding, open the assistant and ask "What is
    this page about?". The answer names Onboarding. Ask "create a child page
    called Day two". One `create_page` proposal appears; Apply creates it under
    Onboarding as actor `assistant`. Without a credential the step is skipped and
    recorded as such.
17. MCP `tools/list` on `/api/mcp` shows only `tessera_*` tools (no `list_items`
    or `search_items`), and `serverInfo.name` is `tessera`.
18. Static checks:
    - `grep -ri milkdown src package.json` is empty;
    - `grep -c milkdown package-lock.json` gives 0;
    - `ls src/app` lists none of the deleted handbook files;
    - `grep -rn "STUB(P6)" src` is empty;
    - `npm run check` is green;
    - `next build` reports no blocking-route insight.
19. At 375 px, the wiki tree, the page screen (breadcrumb wraps, the meta row
    wraps) and the Move dialog have no horizontal scroll.

### 10. Risks

| Risk | Mitigation |
|---|---|
| Imported bodies do not survive the Tiptap round-trip: the Onboarding table, a bare `<br />` and the stray `### asdfasdfsad` heading would show the lossy-parse Banner on open | The importer normalises `<br />`-only bodies; P2.7 adds the 12 fixture bodies to the round-trip corpus before H6 deletes anything; acceptance step 4 |
| `/` has two pages during the move (`(handbook)/page.tsx` and `(tessera)/page.tsx`), which fails `next build` | H6 moves Home and deletes the handbook group in one step, and only H edits those files |
| Generalising `useDescriptionSave` (494 lines, with beacon and marker logic) breaks work item descriptions | `tests/editor/description-save.test.ts` stays green before the page cases are added. The beacon marker parser accepts the old `{ workItemId }` shape as a `work_item` target. Acceptance step 6 also edits WEB-1's description and reloads |
| An Astryx `TreeList` row with a `MoreMenu` in `endContent` fights over the arrow keys (the Toolbar lesson in the field guide) | P1 checks the keyboard path in acceptance step 3. If it fails, the row menu moves to a context menu (`ContextMenu`) plus the page screen's own menu, and the tree keeps only links |
| The user's MCP client configs call handbook tools (`list_items` and others), which vanish | Decision 47; the report to the user names the removed tools; `tessera_*` names are unchanged |
| Migration number clash if P5's `0002_ai` has not landed or was renumbered | Refresh before build: lane A takes the next free index from `_journal.json` |
| Archive and move over a deep subtree get slow | `descendantIds` is one recursive CTE over the indexed `parent_id`, never a query per level; `tests/pages/tree.test.ts` archives a 200-page, 10-level tree |
| The user's real data never gets the handbook pages, because agents never touch `data/tessera.db` | Open question 3: the user runs one command after the merge; `content/` stays until then |
| Embeds go stale when a work item is deleted | Back-links read from the page side only; a deleted target simply has no detail screen. The chip shows "Not found" through the existing link-resolution path |
| P5's assistant can propose `delete_page` | It is destructive, so U2's confirm `AlertDialog` applies; covered by P5's proposal tests |

### 11. Open questions for the user (each with the default the plan uses)

1. **What happens to the handbook "summary" lines?** Each file has a one-line
   summary, and Pages have no summary field. Default: a non-empty summary becomes
   the page's first paragraph (lossless). The alternative is to drop it.
2. **Should "Untitled collection" and "YEah" (`untitled.md`) be imported?** They
   look like leftovers. Default: import all 12 files (the exit criterion counts
   12); you can delete them in the app.
3. **How do the pages get into your real database?** Agents never touch
   `data/tessera.db`. Default: after the P6 merge you run
   `npm run import:handbook` once. Then a follow-up commit deletes `content/`
   (git history keeps it). The alternative is for the root planner to run it for
   you with your explicit go-ahead.
4. **Should "Private" pages be hidden from agents (MCP and the assistant)?**
   Default: no. Access is only a list tab, because there is one user (decision 42).
   Hiding them would make Private mean "only me, no agents".
5. **Should old handbook links (`/items/<slug>`) redirect to the imported pages?**
   Default: no, they return 404, since you did not use the handbook. A small
   redirect route through `external_id` is possible if you want it.
6. **Should the MCP server rename from `handbook` to `tessera`?** Default: yes. The
   URL `/api/mcp` stays, so client configs keep working; only the name shown in
   the client changes.

### Refresh before build (checklist for the contract planner)

- The paths that P4 and P5 create and P6 edits:
  - `src/components/project-settings/FeaturesSettings.tsx` and
    `src/components/work-items/project-tabs.ts` (P4);
  - `src/app/(tessera)/work-items/load-detail.ts` bundle shape (P4);
  - `src/components/ai/assistant-scope.ts` and `src/lib/tessera/ai/prompts.ts`
    `describeScope` (P5);
  - `src/lib/tessera/db/schema/pages.ts` (P5 lane 0);
  - the `tools/registry/index.ts` array convention (P4).
- The next free migration index, and the registry tool count (91 after P4, plus P5
  changes, plus 15).
- `CommandBar.tsx` length and where `n d` and `g d` are handled, which decides
  lane 0's conditional split.
- Whether the activity `entity_type` is a closed zod enum.
- The `MoreMenu` item type (`DropdownMenuOption`) for disabled items with a
  message.
- Whether the P4 feature-off screen component can be reused for Pages off.
- Line numbers in `globals.css`: lane 0 cuts by selector, not by line, if the
  file has changed.
