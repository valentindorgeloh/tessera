# Service API contract

Owner: lane A. Implementation: `src/lib/tessera/`. Every operation Tessera can perform is a function in this layer; the UI, the MCP server and the assistant call the same functions through the tool registry (`docs/contracts/tools.md`).

## Built in P1

Everything in "Module map" that is not marked as a later phase exists and is tested (`tests/*.test.ts`, 20 files). Entry points:

- `src/lib/tessera/index.ts`: barrel of the engine without `server-only`; what scripts and Vitest import (`@/lib/tessera`). It leaves out `db/client`, `db/migrate` and `tools/mcp`, which scripts and tests import by path.
- `src/lib/tessera/server.ts`: `import "server-only"`, re-exports the barrel plus `getDb`, `closeDb`, `readTessera`, `writeTessera`; what Server Components, Server Actions and route handlers import (`@/lib/tessera/server`).
- `src/app/actions/_run.ts`: `runTool` / `toolAction`, the UI's way into the registry (per-domain `actions/<domain>.ts` files arrive with their screens).
- `src/lib/tessera/tools/mcp.ts` (`registerTesseraTools`) behind `src/app/api/mcp/route.ts` (HTTP) and `scripts/mcp-stdio.ts` (stdio, registered for coding agents in `.mcp.json`).
- Node >= 22.14 (Node-API 10) for `better-sqlite3` 13; `.nvmrc` pins 22.23.3 and `vitest.config.mts` fails fast on an older Node.

## Context, errors, transactions

```ts
type TesseraContext = {
  db: TesseraDb;              // Drizzle instance over better-sqlite3
  sqlite: Database;           // the better-sqlite3 handle underneath (transactions, FTS, latestSeq)
  actor: ActorRow;            // who performs the call; fills created_by / updated_by / activity.actor_id
  now(): string;              // ISO-8601 UTC
  today(): string;            // YYYY-MM-DD, server local date
};

class TrackerError extends Error {
  code: TrackerErrorCode;     // NOT_FOUND | VALIDATION | CONFLICT | RULE | ARCHIVED | LOCKED | BUSY
  details?: unknown;          // zod issues for VALIDATION, ids for CONFLICT, { rule: <name> } for RULE
}
```

- `createContext({ db, sqlite, actorId, now?, today? })` loads the actor row (`NOT_FOUND` when it is missing or deleted) and returns a context; `withActor(ctx, actorId)` derives a context for another actor on the same handles. Server code uses `getDb()` from `@/lib/tessera/server` (a `DbHandles = { sqlite, db }` singleton); tests and scripts use `openDatabase(path = ":memory:")` from `@/lib/tessera/db/client`.
- Every mutation runs inside `withTx(ctx, fn)`, which always opens a `BEGIN IMMEDIATE` transaction (there is no `.immediate()` chain); nested calls join the open transaction; `assertInTransaction(ctx, what)` guards helpers that must run inside one. Reads run outside transactions.
- `fromSqliteError` maps `SQLITE_BUSY*` (after `busy_timeout`) to `TrackerError("BUSY")` and `UNIQUE` / `PRIMARY KEY` violations to `CONFLICT`; `withTx` applies it to anything thrown inside.
- Validation: each function validates its input with `validateInput(schema, input)` and the zod schema exported next to it (`CreateWorkItemInput`, ...; the `*InputType` alias is the `z.input` type). Invalid input throws `VALIDATION` before any write. Constructors: `notFound(entity, id)`, `validation(issues, message?)`, `conflict(message, details?)`, `rule(name, message)`, `archived()`, `locked()`, `busy()`; `isTrackerError(err)` narrows.
- Rule names are stable and tests assert them (`RULE` errors below are written as `RULE <name>`).

## Module map

```
src/lib/tessera/
  types.ts  schemas.ts  core/{keys,time,group}.ts     client-safe
  core/{errors,ids,order,context,tx}.ts              engine helpers
  db/{schema,client,fts,migrate}.ts
  activity.ts  changes.ts
  actors.ts  projects.ts  states.ts  labels.ts  work-items.ts  assignees.ts  links.ts
  cycles.ts  modules.ts  views.ts  view-settings.ts
  filters.ts  counts.ts  search.ts  seed.ts
  index.ts            barrel of everything except db/client, db/migrate and tools/mcp (no "server-only")
  server.ts           import "server-only"; export * from "./index"; export { getDb, closeDb, readTessera, writeTessera }
  tools/{define,describe-filters,registry,mcp}.ts
Later phases (not built): notifications.ts  versions.ts  relations.ts  comments.ts  pages.ts  drafts.ts  intake.ts
  estimates.ts  favorites.ts  recents.ts  stickies.ts  home.ts  analytics.ts  automations.ts  exports.ts  webhooks.ts
  import-handbook.ts  tools/anthropic.ts  ai/{client,assistant,view-from-prompt,digest,narrative,prompts}.ts
```

- `core/order.ts`: `firstSortOrder`, `sortOrderAfter`, `sortOrderBefore`, `sortOrderBetween` (a `VALIDATION` instead of the library error), `lastSortOrder(db, table, where?)`, `sortOrderForMove(rows, id, beforeId, afterId, entity)`.
- `core/group.ts`: `GROUPABLE_FIELDS`, `MULTI_VALUED_GROUP_FIELDS` (`labels`, `assignees`, `module`), `ORDERABLE_FIELDS`, `parseOrderBy`, `PRIORITY_RANK`. `core/keys.ts`: `formatKey`, `parseKey`, `normalizeIdentifier`, `nameKey`. `core/time.ts`: `nowIso`, `todayLocal`, `localDateOf`, `localDayStart`, `isIsoDate`, `addDays`, `compareDates`, `isBefore`, `isAfter`, `daysBetween`. `core/ids.ts`: `newId` (UUIDv7), `isId`.
- `db/client.ts`: `DEFAULT_DB_PATH = "data/tessera.db"`, `MEMORY_DB`, `resolveDbPath(raw?)`, `openDatabase(path)` (pragmas, `migrate`, `ensureFtsTables`, `ensureSystemActors`), `getDb()` (file databases go through `migrateIfNeeded` first), `closeDb()`. `db/migrate.ts`: `REPO_ROOT`, `pendingMigrations(sqlite)`, `migrate(db, sqlite)`, `backupDatabase`, `pruneBackups`, `migrateIfNeeded(filePath, { lockTimeoutMs? })`. `db/fts.ts`: `ensureFtsTables`, `upsertWorkItemFts`, `deleteWorkItemFts`, `upsertPageFts`, `deletePageFts`, `rebuildFts`, `buildMatchExpression`, `searchWorkItemIds(sqlite, q, { project_id?, limit? })`, `searchPageIds`.
- `server.ts`: `readTessera(fn)` runs `fn(ctx)` as the user actor (sync or async); `writeTessera(fn)` runs a synchronous `fn` inside `withTx` as the user actor.
- `server-only` is not installed as a package on purpose: Next aliases it at bundle time and tsc does not check side-effect imports. The first Server Component that imports `@/lib/tessera/server` (P2a) is the first real bundle of it and must confirm it.

### Import boundary (enforced by eslint and `scripts/check-conventions.ts`)

| Importer | May import |
|---|---|
| `'use client'` files | `@/lib/tessera/types`, `@/lib/tessera/schemas`, `@/lib/tessera/core/{keys,time,group}` |
| `src/components/**` | `@/lib/tessera/types`, `@/lib/tessera/schemas`, `@/lib/tessera/core/*`; never `@/lib/tessera/server`, `@/lib/tessera/db`, `better-sqlite3`, `drizzle-orm` |
| Server Components, pages and layouts under `src/app/**` | `@/lib/tessera/server` (eslint blocks `@/lib/tessera/db*`, `better-sqlite3`, `drizzle-orm` there) |
| Server Actions (`src/app/actions/**`), route handlers (`src/app/api/**`) | `@/lib/tessera/server` or the engine modules directly (`_run.ts` imports `db/client`, `core/context`, `tools/registry`) |
| Vitest, `scripts/*.ts` | `@/lib/tessera`, `@/lib/tessera/db/client`, `@/lib/tessera/db/migrate`, `@/lib/tessera/tools/mcp` |
| `src/lib/tessera/**` | never `server-only` except `server.ts`; never `process.cwd()` (paths resolve from the module location) |

## Common shapes

- Rows are Drizzle select types (`WorkItemRow`, `ProjectRow`, ...). Read functions return **view models** that add derived fields: `WorkItem = WorkItemRow & { key: string, label_ids: string[], module_ids: string[], assignee_ids: string[], sub_items_count: number, links_count: number, intake: { status: IntakeStatus } | null }`; `WorkItemDetail = WorkItem & { subscriber_ids: string[], links: WorkItemLinkRow[] }` (`relations` arrives in P7).
- Other view models: `Project = ProjectRow & { counts: { total, by_state_group } }` (non-deleted, non-archived items outside triage; `triage` is always 0); `State = StateRow`; `Label = LabelRow`; `View = ViewRow`; actors are `ActorRow`; `Cycle = CycleRow & { status: CycleStatus, progress: { total, completed } }`, `CycleDetail` carries the full `CycleProgress`; `Module = ModuleRow & { member_ids, links_count, progress: ProgressCounts }`, `ModuleDetail` carries `progress: ModuleProgress` (`ProgressCounts & { by_state, points? }`, a TypeScript type without a zod schema), `links: Link[]` and `work_item_ids`; `Link` is a union on `parent_type` with `work_item_id` or `module_id` set; `ActivityLogEntry = ActivityRow & { actor_name, merged_count, last_seq }`; `ViewSettings = { filters: Filters, display: Display }`.
- `ListResult<T> = { items: T[], total: number, cursor: number }` where `cursor` is `latestSeq()` at read time, so a page can start the change poller without a second query. `WorkItemListResult = ListResult<WorkItem> & { groups?: Group[]; has_more?: boolean }` with `Group = { field, id, name, color, count, item_ids, has_more, estimate_points?, sub_groups? }` (items referenced by id, `"none"` for the empty group; `has_more` and `estimate_points` are explained under "List paging" below); both are exported from `work-items.ts`. The other list functions (`listProjects`, `listStates`, `listLabels`, `listCycles`, `listModules`, `listViews`, `listActors`, `listChildren`, `listLinks`) return plain arrays; the registry wraps the ones it exposes into `ListResult` (`toListResult`).
- Ids are UUIDv7 strings; keys are `WEB-12` strings; `getWorkItemByKey` accepts either; `getProject` accepts an id or a project identifier such as `WEB` (any case).
- Every mutation returns the fresh view model of the entity it changed; deletes and removes return `void` (the tools return `{ id, deleted: true }` / `{ id, removed: true }`).

## Signatures

### P1 set

```ts
// actors.ts
USER_ACTOR_ID / ASSISTANT_ACTOR_ID / SYSTEM_ACTOR_ID                  // fixed UUIDs; ensureSystemActors(db) seeds them
listActors(ctx): ActorRow[]
getActor(ctx, id): ActorRow
registerActor(ctx, { kind: "agent", name, client_name?, color? }): ActorRow   // idempotent on name_key; mcpActorName(client) = "mcp:<client>"
touchActor(ctx, actorId): void                                          // last_seen_at
updateActor(ctx, id, { name?, color? }): ActorRow

// projects.ts
listProjects(ctx, { archived? } = {}): Project[]                         // counts included; archived lists archived only
getProject(ctx, idOrIdentifier): Project                                // archived projects are returned; deleted → NOT_FOUND
createProject(ctx, { name, identifier, description_md?, logo?, features? }): Project   // seeds the five states (+ Triage when intake is on)
updateProject(ctx, id, { name?, identifier?, description_md?, logo?, default_assignee_id?, archive_in_months?, close_in_months?, close_state_id? }): Project
updateProjectFeatures(ctx, id, { cycles_enabled?, modules_enabled?, views_enabled?, pages_enabled?, intake_enabled?, estimates_enabled?, agent_intake_required? }): Project
archiveProject(ctx, id): Project / unarchiveProject(ctx, id): Project / deleteProject(ctx, id): void

// states.ts
listStates(ctx, projectId): State[]
createState(ctx, { project_id, name, state_group, color?, description?, is_default? }): State   // state_group never "triage"
updateState(ctx, id, { name?, description?, color? }): State            // state_group is immutable
reorderState(ctx, id, { before_id?, after_id? }): State
setDefaultState(ctx, id): State
deleteState(ctx, id, { move_to_state_id? } = {}): void

// labels.ts
listLabels(ctx, projectId): Label[]
createLabel(ctx, { project_id, name, color?, parent_id? }): Label
updateLabel(ctx, id, patch): Label / reorderLabel(ctx, id, { before_id?, after_id?, parent_id? }): Label (parent_id null = top level, an id = child of that top-level label; reparent and reorder in one transaction, one level deep; omit to keep the parent) / deleteLabel(ctx, id): void

// work-items.ts
listWorkItems(ctx, {
  scope: { type: "project", project_id } | { type: "cycle", cycle_id } | { type: "module", module_id }
       | { type: "view", view_id } | { type: "workspace" } | { type: "profile", actor_id, tab: "assigned" | "created" | "subscribed" }
       | { type: "archived", project_id } | { type: "draft" },
  filters?: Filters, display?: Partial<Display>, limit?: 1..5000, offset?,
  per_group_limit?: 1..500, group_value?, sub_group_value?, group_limits?: Record<string, 1..2000>,
  calendar_window?: { from, to }                                        // List paging (decisions 112, 113)
}): WorkItemListResult                                                   // groups when display.group_by is set
getWorkItem(ctx, id): WorkItemDetail                                    // + subscribers, links
getWorkItemByKey(ctx, keyOrId): WorkItemDetail
listChildren(ctx, id): WorkItem[]
createWorkItem(ctx, {
  project_id, name, description_md?, state_id?, priority?, parent_id?, cycle_id?, label_ids?, module_ids?,
  assignee_ids?, estimate_point_id?, start_date?, target_date?, source?: IntakeSource
}): WorkItem                                                             // honours agent_intake_required for agent actors
updateWorkItem(ctx, id, patch: Partial<{ name, state_id, priority, parent_id, cycle_id, estimate_point_id, start_date, target_date }>): WorkItem
bulkUpdateWorkItems(ctx, ids /* 1..500 */, patch): WorkItem[]            // one transaction, same patch rules as updateWorkItem
updateWorkItemDescription(ctx, id, { description_md, expected_description_version }): WorkItem   // CAS → CONFLICT
moveWorkItem(ctx, id, { group_by?: GroupBy, value?: string | null, from_value?: string | null, before_id?, after_id? }): WorkItem
copyWorkItem(ctx, id, { project_id? } = {}): WorkItem
moveWorkItemToProject(ctx, id, { project_id }): WorkItem
archiveWorkItem(ctx, id): WorkItem / unarchiveWorkItem(ctx, id): WorkItem / deleteWorkItem(ctx, id): void
setLabels(ctx, id, label_ids) / setModules(ctx, id, module_ids): WorkItem   // replace semantics, up to 500 ids

// assignees.ts
setAssignees(ctx, id, actor_ids /* up to 100 */): WorkItem               // replace semantics; added actors are subscribed
subscribe(ctx, id, actor_id?) / unsubscribe(ctx, id, actor_id?): WorkItem   // default: the calling actor; idempotent

// links.ts
listLinks(ctx, { work_item_id } | { module_id }): Link[]
getLink(ctx, id): Link
addLink(ctx, { url, title?, metadata?, work_item_id } | { ..., module_id }): Link   // exactly one parent; absolute http(s) URL
updateLink(ctx, id, { title?, url?, metadata? }): Link
removeLink(ctx, id): void

// cycles.ts
listCycles(ctx, projectId, { status?: CycleStatus, archived? } = {}): Cycle[]   // Cycle carries derived status and { total, completed }
getCycle(ctx, id): CycleDetail
createCycle(ctx, { project_id, name, description_md?, start_date?, end_date? }): CycleDetail
updateCycle(ctx, id, { name?, description_md?, start_date?, end_date? }): CycleDetail
reorderCycle(ctx, id, { before_id?, after_id? }): CycleDetail
archiveCycle / unarchiveCycle (ctx, id): CycleDetail / deleteCycle(ctx, id): void
addWorkItemsToCycle(ctx, cycleId, ids /* 1..500 */) / removeWorkItemsFromCycle(ctx, cycleId, ids): CycleDetail
transferCycleWorkItems(ctx, fromCycleId, { to_cycle_id: string | null }): { moved: number }
getCycleProgress(ctx, id, { mode?: "issues" | "points" } = {}): CycleProgress
getActiveCycles(ctx): CycleDetail[]                                      // current, non-archived cycles of live projects

// modules.ts
listModules(ctx, projectId, { archived?, status? } = {}): Module[]
getModule(ctx, id): ModuleDetail
createModule(ctx, { project_id, name, description_md?, status?, lead_actor_id?, member_ids?, start_date?, target_date? }): Module
updateModule(ctx, id, { name?, description_md?, status?, lead_actor_id?, start_date?, target_date? }): Module
reorderModule(ctx, id, { before_id?, after_id? }): Module
archiveModule / unarchiveModule (ctx, id): Module / deleteModule(ctx, id): void
addWorkItemsToModule(ctx, moduleId, ids) / removeWorkItemsFromModule(ctx, moduleId, ids): Module
setModuleMembers(ctx, id, actor_ids): Module                             // replace semantics
addModuleLink(ctx, moduleId, { url, title?, metadata? }): Link / updateModuleLink(ctx, linkId, patch): Link / removeModuleLink(ctx, linkId): void
getModuleProgress(ctx, id): ModuleProgress

// views.ts
listViews(ctx, { project_id: string | null }): View[]
getView(ctx, id): View
createView(ctx, { project_id: string | null, name, description?, filters?, rich_filters?, display?: DisplayPatch, logo? }): View
updateView(ctx, id, { name?, description?, filters?, rich_filters?, display?: DisplayPatch, logo? }): View   // filters replace, display merges
duplicateView / lockView / unlockView (ctx, id): View / deleteView(ctx, id): void

// view-settings.ts
getViewSettings(ctx, scope_type, scope_id): ViewSettings                // defaults when missing
saveViewSettings(ctx, scope_type, scope_id, { filters?, display?: DisplayPatch }): ViewSettings   // merged result
resetViewSettings(ctx, scope_type, scope_id): ViewSettings              // deletes the row, returns the defaults

// counts.ts
getCounts(ctx, scope): Counts                                           // one function for sidebar, headers, progress, analytics

// search.ts
searchAll(ctx, q, { scope?: { project_id? }, types?: ("work_item" | "page" | "cycle" | "module" | "project")[], limit?, include_archived? }): SearchHit[]

// activity.ts / changes.ts
logActivity(ctx, entry): ActivityRow                                    // inside a transaction only
diffFields(ctx, target, before, after, fields, resolveIdentifier?): void
listActivity(ctx, { work_item_id, since_seq?, limit? } | { project_id, since_seq?, limit? }): ActivityLogEntry[]   // exactly one scope; oldest first
listChanges(ctx, sinceSeq, { excludeActors?, limit? }): { changes: Change[], cursor: number }
latestSeq(ctx | sqlite): number

// seed.ts
seedDemo(ctx): { project: Project, created: boolean }                   // demo project WEB; idempotent, SEED_SUMMARY says what it creates

// tools/describe-filters.ts
describeFilters(): DescribeFiltersPayload                               // cached per process; shape in docs/contracts/ai.md
```

### Later phases (same conventions)

- **P6 pages.ts**: `listPages(ctx, { project_id: string | null, parent_id?, archived? })`, `getPage`, `createPage`, `updatePage` (name, access, logo, labels), `updatePageBody(ctx, id, { description_md, expected_description_version })`, `movePage(ctx, id, { parent_id?, project_id? })`, `lockPage`/`unlockPage`, `archivePage`/`unarchivePage`, `deletePage`, `duplicatePage`, `listPageVersions`, `restorePageVersion`, `listPageEmbeds`, `listBacklinks(ctx, entity_type, entity_id)`.
- **P7**: `mentions.ts` (`extractActorMentions(md)`, `syncMentions(ctx, target, body)` -> `{ added, removed }`, `bodySnippet`; called on every description, comment and page body save), `relations.ts` (`addRelation(ctx, id, { related_id, relation_type })`, `removeRelation`, `listRelations` returning both directions with display type; `WorkItemDetail.relations`), `comments.ts` (`listComments`, `createComment`, `updateComment`, `deleteComment`, `addReaction`, `removeReaction`), `notifications.ts` (`listNotifications(ctx, { tab: "all" | "mentions" | "unread" | "archived" | "snoozed" })`, `markRead`, `markUnread`, `archiveNotification`, `snoozeNotification`, `getUnreadCount`). Links are already in P1 (`links.ts`).
- **P8**: `drafts.ts` (`listDrafts`, `createDraft`, `updateDraft`, `deleteDraft`, `moveDraftToProject`), `intake.ts` (`listIntakeItems(ctx, projectId, { status })`, `acceptIntakeItem(ctx, id, { state_id? })`, `declineIntakeItem`, `snoozeIntakeItem(ctx, id, { till })`, `markIntakeDuplicate(ctx, id, { duplicate_to_id })`), `estimates.ts` (`getEstimate`, `createEstimate(ctx, { project_id, name, type, points })`, `updateEstimatePoints`, `archiveEstimate`, `setEstimatePoint`). The intake policy on create, copy and move is already enforced in P1 (`schema.md` "Intake").
- **P9**: `favorites.ts`, `recents.ts` (`recordVisit`, `listRecents`), `stickies.ts`, `home.ts` (`getHomeSummary(ctx)`), `analytics.ts` (`getAnalytics(ctx, { tab, scope })` built on `getCounts`).
- **P10**: `versions.ts` (`listWorkItemVersions`, `restoreWorkItemVersion`), `automations.ts` (`runAutomations(ctx)` idempotent, lease-guarded), `exports.ts` (`createExport(ctx, { scope, format })` writing under `data/exports/`), `webhooks.ts`. Rich filters are already evaluated by `filters.ts` in P1; P10 adds the UI.

## Activity, notifications, versions

- Every mutation writes one `activity` row per changed field (`verb = "updated"`, `field`, `old_value`, `new_value`, plus `old_identifier` / `new_identifier` for human-readable ids). Creates, deletes, archives, restores, copies, moves and comments write one row each; `registerActor` writes `registered`. Cycle and module membership log on both sides (the item row carries `cycle_id` / `module_ids`, the cycle or module row an `added` / `removed` verb with the item id and key). Verbs: `created, updated, deleted, archived, restored, commented, added, removed, moved, copied, locked, unlocked, reacted, registered`.
- `activity.seq` is the global change cursor. `listChanges(ctx, sinceSeq, { excludeActors?, limit? })` returns rows with `seq > sinceSeq` in `seq` order, up to `limit` (default 1000, max 5000; `excludeActors` up to 100 ids); `cursor` is the last returned `seq` when the list was cut, otherwise `max(sinceSeq, latestSeq())`. The UI excludes `user` so it only refreshes on external writes.
- `listActivity` takes exactly one of `work_item_id` / `project_id` plus `since_seq?` and `limit?` (default 500, max 5000), reads the newest `limit` raw rows, collapses consecutive `description_version` edits by the same actor within 5 minutes into one entry (`merged_count`, `last_seq`), resolves `actor_name` at read time and returns the entries oldest first.
- Notifications (P7, built) come from `notifyFromActivity`, called by `logActivity` inside the mutation transaction (decisions 49-52). Kinds, in rank order: `mentioned` (an `added` `mention` activity row, from `mentions.ts`), `assigned`, `commented`, `state_changed`, `updated` (any other change to a work item itself on a subscribed item), `intake_received`, `automation`. Silent: verbs `created`, `copied`, `reacted`, `unreacted`; fields `sort_order`, `subscribers`; `removed` mention rows; comment edits and deletes. Recipients are the subscribers (plus the new assignee or the mentioned actor), minus the causing actor, system and assistant actors, deleted actors, and the user when the assistant caused it. `writeRows` merges a new event into the recipient's newest row for the same work item and causing actor when it is unread, not archived, not snoozed and `sort_at` is under `COALESCE_WINDOW_MS` (10 minutes) old: higher-ranked `kind`, newest snippet, `event_count + 1`, `sort_at = now`. `snoozeNotifications` sets `sort_at = snoozed_till` and clears `read_at`; `unsnoozeNotifications` sets `sort_at = now`. `getUnreadCount` is unread, not archived, not snoozed; `GET /api/changes` returns it as `unread_notifications` (decision 59). Page mentions notify with `entity_type` `page` and no work item. Subscriptions already exist (`work_item_subscriber`): creator and assignees are subscribed on create, added assignees on `setAssignees`, mentioned actors on a work item or comment mention.
- Description writes store the version numbers in activity (`old_value` / `new_value` of `description_version`); the `work_item_version` row and 5-minute collapse arrive in P10.

## Counts

`getCounts(ctx, scope)` with `scope ∈ { workspace, project, cycle, module, view, profile }` (`profile` counts the actor's assigned items) returns `{ total, by_state_group, by_state, by_priority, by_assignee, by_label, overdue, due_this_week, completed_points?, total_points? }`. The population is non-deleted, non-archived items outside the hidden triage state, even for a view whose filters ask for archived items; `by_state_group.triage` is always 0; `overdue` = `target_date` before today and the group is neither `completed` nor `cancelled`; `due_this_week` = `target_date` within `[today, today + 6 days]`; points appear only when a project in scope has estimates enabled. Sidebar badges, headers, progress bars, analytics, MCP `get_counts` and the assistant all read this one function so numbers never disagree. Cycle progress is the one intentional exception: it counts archived items (`schema.md` "Cycles").

## Filters and display

**List paging (P11, decisions 112 to 114; `work-items/paging.ts`).** Without `per_group_limit`, `group_value` and `group_limits`, `listWorkItems` behaves as before: `limit` / `offset` page the flat `items` (the result then also carries `has_more = offset + items.length < total`), and `groups` are built from the returned items, so their `count` counts those rows and every `Group.has_more` is false. With `display.group_by` set and any of the three keys, the list pages by group and the numbers describe the whole filtered set:

- The engine reads a narrow projection of every item of the filtered set (ids, the keys `groupItems` reads, the points estimate; labels, assignees and modules only when grouped by them) in display order over the list's own WHERE, so filters, rich filters, view scopes and cross-project scopes apply unchanged. It groups the projection with `groupItems`, takes each group's page of ids (`pageGroups`) and hydrates the union of the loaded ids once.
- `total` is the whole filtered set (distinct items). `Group.count` is the full group size. `Group.item_ids` lists the loaded page and `Group.has_more` is true when the group holds more. A multi-valued `group_by` (labels, assignees, module) repeats an item in several groups; `items` lists it once, in display order. `show_empty_groups` keeps empty groups (count 0, no ids, `has_more` false). The result's `has_more` is true when any group has more.
- `Group.estimate_points` (decision 113) is the sum of the numeric points estimates over the whole group (and each sub-group); it is set only when a project counts points (`estimates_enabled` with an active `points` estimate, like `getCounts`' `total_points`), `0` for a group with no estimated item.
- `per_group_limit` (1 to 500, default 50 when only `group_value` or `group_limits` is sent) is the page size of every leaf group: a group, or each sub-group cell when `display.sub_group_by` is set. A group with sub-groups lists the loaded ids of its cells (in its own order) in `item_ids` and is `has_more` when any cell is. `limit` and `offset` are ignored here (they belong to the flat list).
- `group_value` pages inside one group: the result holds only that group (an unknown value gives `groups: []`, no items, not an error, because a group can empty between two calls) and `limit` (else `per_group_limit`, else 50) and `offset` page inside it. With `display.sub_group_by` it returns that group's cells, each paged the same way; `sub_group_value` keeps one cell. `total` stays the whole filtered set.
- `group_limits` (up to 100 entries, values 1 to 2000) sizes named groups instead of `per_group_limit`, keyed by group id or `groupLimitKey(group_id, sub_group_id)` (`"group/sub"`, from `core/group.ts`, client-safe); a cell key beats its group key. It re-fetches expanded groups after a refresh in one call. Unknown keys are ignored; `group_value` ignores it.
- `calendar_window` (`{ from, to }`, `YYYY-MM-DD`, `from <= to`) keeps the items whose `target_date` is inside the inclusive period plus the items with no target date (the calendar draws by target date, so no other item is needed); it ANDs with every other filter and works with or without `limit`. The calendar loaders derive it from `?cal=` (default today) with `calendarWindow` in `components/work-items/paging.ts`: the whole weeks of the shown month, or the shown week (decision 112). `total` then counts the windowed set.
- A cycle scope reads `work_item` by `project_id` and `cycle_id` together, so it uses `work_item_project_cycle_idx` and the query-plan test allows no scan (decision 126).
- Validation (`VALIDATION`): `group_value` needs `display.group_by` (a saved view's counts); `sub_group_value` needs `group_value` and `display.sub_group_by`. `per_group_limit` and `group_limits` on an ungrouped list are ignored, so a loader can send them by layout.
- Moves (decision 114) need nothing new: `moveWorkItem` with `before_id` set to the last loaded item of a group puts the item directly behind it (fractional key between that item and its project-wide next key), ahead of the unloaded rest; the UI replaces its optimistic counts with the next list result.
- Cost: one projection statement per list plus one read per multi-valued key; 10 000 items group in about 15 ms (state, priority) to 35 ms (labels) on an in-memory database. Decision 115's budget applies to the first page.

`filters.ts` turns `Filters` (+ `RichFilters`) into Drizzle `where` fragments (`buildWhere(ctx, filters, { project_id?, include_triage? })`) and `Display` into `order by` (`buildOrder`) and grouping (`groupItems`). Deleted items are always excluded, archived items unless `filters.archived` is true, triage items unless the filter targets the triage state. `search` goes through FTS5 (`searchWorkItemIds`, capped at 100 000 ids inside a list query). Ordering puts `NULL` dates and estimates last and breaks ties on `sort_order` then `sequence_id`. Grouping by multi-valued fields (labels, assignees, modules) duplicates the item into every group; `moveWorkItem` with such a `group_by` adds the value and removes `from_value` instead of replacing it (`schema.md` "Work items"). `Display.type` and `Display.sub_items` act as filters when `filters` leave `type` / `sub_items` unset. Date filters: `before` and `after` are strict, `between` is inclusive, a `relative` token wins over `from` / `to`, `between` + `relative` spans today..anchor, timestamp columns (`created_at`, `updated_at`, `completed_at`) are compared on the server's local calendar day, a `DateFilter` without a usable bound is ignored. URL filter state is one base64url-encoded JSON `q=` param; `view_settings` supplies the defaults; URL wins (P2a).

## P3 additions (lane A)

Consumers: docs/contracts/ui.md "P3: cycles, modules, archives". No new service
exports that mutate, no new tools, no new activity verbs, no migration:
`cycle.progress_snapshot` is JSON and its schema only widens, so snapshots frozen
before P3 still parse.

```ts
// schemas.ts
PointsCountsSchema            // { total, completed, cancelled, started, unstarted, backlog }: z.number().nonnegative() (fractional estimate values)
ProgressModeSchema            // z.enum(["issues", "points"]); cycles.ts keeps CycleProgressModeSchema as an alias
ProgressBreakdownRowSchema    // { id: IdSchema.nullable(), total: int >= 0, completed: int >= 0 }
CycleProgressSchema = ProgressCountsSchema.extend({
  by_state, by_label, by_assignee,                       // unchanged: item counts per id
  assignees: z.array(ProgressBreakdownRowSchema).optional(),
  labels: z.array(ProgressBreakdownRowSchema).optional(),
  points: PointsCountsSchema.optional(),                 // was ProgressCountsSchema (integers)
  chart_mode: ProgressModeSchema.optional(),             // unit of completion_chart in a returned progress
  completion_chart: z.record(IsoDateSchema, z.number().nonnegative()),
  completion_chart_points: z.record(IsoDateSchema, z.number().nonnegative()).optional(),   // written into snapshots only; see "Snapshot visibility"
})
// types.ts: PointsCounts, ProgressBreakdownRow, ProgressMode

// cycles.ts
type Cycle = CycleRow & { status: CycleStatus; progress: CycleProgressSummary; open_count: number }
type CycleProgressSummary = { total: number; completed: number; cancelled: number }   // cancelled added in the P3 fix round
type CycleDetail = Omit<Cycle, "progress"> & { progress: CycleProgress }      // progress in issues mode
listCycles(ctx, projectId, { status?, archived? } = {}): Cycle[]                // + open_count
getCycle(ctx, id): CycleDetail                                                  // + open_count
getCycleProgress(ctx, id, { mode?: "issues" | "points" } = {}): CycleProgress    // chart_mode always set

// modules.ts
type ModuleProgress = ProgressCounts & {
  by_state: Record<string, number>;
  by_label: Record<string, number>;          // new
  by_assignee: Record<string, number>;       // new
  assignees: ProgressBreakdownRow[];         // new
  labels: ProgressBreakdownRow[];            // new
  points?: PointsCounts;                     // only with an active estimate
}
getModuleProgress(ctx, id): ModuleProgress
getModule(ctx, id): ModuleDetail                                                // progress: ModuleProgress
```

- **Points** (cycles now match modules): counted only when the project has an
  active estimate (`estimates_enabled` and `estimate_id` set), only for items whose
  `estimate_point` is not deleted and belongs to that estimate, and only for numeric
  values ≥ 0 (anything else counts 0). Without an active estimate `points` is absent.
- **Series**: `completion_chart` is the pending amount per day from `start_date` to
  `min(end_date, today)` (unchanged rules: local day of `completed_at`, cancelled items
  left out). Live progress builds the items series and, with an active estimate, the
  points series. `mode: "issues"` returns the items series, no `points`, no
  `completion_chart_points`, `chart_mode: "issues"`. `mode: "points"` returns `points`
  when present and the points series as `completion_chart` with `chart_mode: "points"`;
  without a points series (no active estimate, or a snapshot frozen before P3) it
  returns the items series with `chart_mode: "issues"`. Burnup and the ideal line are
  derived by clients from the series, the dates and `total − cancelled`; they are not
  stored. There is no scope series (scope per day from each item's join day): burnup
  clients draw today's scope as a flat line; a per-day scope series is P9 analytics work.
- **Snapshot**: `freezeSnapshot` (first transfer out, or archive) stores the items
  series as `completion_chart` and, with an active estimate, the points series as
  `completion_chart_points`, together with the counts, `points` and the breakdowns.
  `readSnapshot` keeps using `safeParse`; with the widened schema a snapshot holding
  fractional points no longer falls back to live progress. `unarchiveCycle` keeps the
  snapshot (and answers `CONFLICT` when the dates now overlap a non-archived cycle).
- **Snapshot visibility**: `completion_chart_points` is never part of a returned
  `CycleProgress` (`getCycleProgress`, `getCycle().progress`), but `Cycle` and
  `CycleDetail` spread the whole `CycleRow` (`toCycles`, `toCycleDetail`), so the raw
  `progress_snapshot` column, `completion_chart_points` included, is visible in
  `list_cycles`, `get_cycle` and the UI's project bundle. Clients treat a cycle as
  frozen exactly when `progress_snapshot !== null` and read progress only from
  `progress` / `getCycleProgress`, never from the raw column.
- **List summary** (`Cycle.progress`, `CycleProgressSummary`): `total`, `completed`
  and `cancelled` over the same population as `getCycleProgress` (non-deleted members
  outside triage, archived members included), from the frozen snapshot's counts once
  `progress_snapshot` is non-null. Clients show `completed` against
  `total − cancelled`, as the progress panel does.
- **`open_count`**: live count of non-deleted members whose state group is neither
  `completed` nor `cancelled`, archived and triage members included, which is exactly
  the set `transferCycleWorkItems` moves; computed even when a snapshot is frozen (one
  grouped query for the list, like `loadLiveSummaries`).
- **Breakdown rows** (`assignees`, `labels`) over the progress population (cycles:
  archived items included; modules: archived items excluded; triage excluded in both):
  one row per actor or label with at least one item, plus a row with `id: null` for
  items without an assignee or without labels when there are any; `completed` counts
  items in the `completed` group; sorted by `total` descending then `id`, the `null` row
  last. An item with two assignees counts in both rows.
- **Archived modules**: `createWorkItem` (`module_ids`) and `syncModules` (`set_modules`,
  `move_work_item` with `group_by: "module"`) throw `ARCHIVED` (`module "<name>" is archived`)
  when a module being added or removed is archived; memberships of archived modules
  that the call leaves unchanged are kept. `moveWorkItemToProject` still clears every
  membership (the item leaves the project).
- **Activity**: the item-side membership row written by `addWorkItemsToModule` /
  `removeWorkItemsFromModule` uses `field: "modules"`, the field `syncModules` already
  writes. Rows stored earlier keep `field: "module"`; the UI labels both.
- Tests: `tests/cycles.test.ts`, `tests/modules.test.ts`, `tests/work-items.test.ts`
  (cases listed in docs/contracts/ui.md "Lane A: engine additions"); `tests/registry.test.ts`
  is unchanged.
- As built (lane A, 2026-10-11): `cycles.ts` also exports three read-only helpers that
  `modules.ts` imports, so cycle and module progress follow one rule each:
  `activeEstimateId(project)` (the estimate points count against, or null),
  `parsePointValue(value)` (numeric and ≥ 0, else null) and
  `loadBreakdowns(ctx, items)` (`by_label`, `by_assignee`, `assignees`, `labels`, with
  the types `BreakdownItem` and `ProgressBreakdowns`). The snapshot is stored without
  `chart_mode`; `forMode` sets it on every returned progress.

## P4 additions (lane A)

Draft by the phase planner, 2026-10-17; lane A appends it to
docs/contracts/service-api.md. Consumers: docs/contracts/ui.md "P4: views,
settings, counts" (draft docs/drafts/p4-ui.md). Paths are after lane 0's splits
(`src/lib/tessera/work-items/`, `src/lib/tessera/tools/registry/`). One new
mutating export (`reorderView`, bound by the new tool `reorder_view`), no
migration, no new activity verb. Decisions 29–32 are defined in the P4 section of
ui.md and added to docs/PLAN.md by lane A.

### A0: land the public signatures first

UI lanes code against these names; lane A lands them (types, schemas, empty or
full implementations that typecheck) before any behaviour work, in this order:
`MoveWorkItemInput` sub-axis fields, `ReorderViewInput` / `reorderView` and the
`reorder_view` tool, `"view"` in `SEARCH_TYPES`, `TaxonomyUsage` /
`getTaxonomyUsage`, `ListWorkItemsInput.display`. Adding `"view"` to `SearchType`
breaks two `Record<SearchType, …>` literals in `src/components/shell/command-source.ts`
(`HIT_SECTION`) and `CommandBar.tsx` (`HIT_ICONS`); lane F3 fills them (its step
F3.9). Lane A lists them under `core_changes` and does not edit those files.

### A1 Partial display on a view (GAP 1, bug)

```ts
// work-items/read.ts
ListWorkItemsInput.display: DisplayPatchSchema.optional()   // was DisplaySchema.partial(): zod 4 still applied defaults
```
- Import `DisplayPatchSchema` and `mergeDisplay` from `../view-settings`.
- `resolveScope`: every non-view scope uses
  `mergeDisplay(DEFAULT_DISPLAY, data.display ?? {})`. The view scope uses
  `mergeDisplay(DisplaySchema.parse(row.display), data.display ?? {})`. Filters are
  unchanged: saved filters with the caller's defined keys replacing them.
- A full `Display` stays a valid input (callers that pass one today still work).
- Test `tests/work-items.test.ts` "view scope keeps saved display keys the caller
  omits": save a view with `{ layout: "board", order_by: "-priority", properties: { key: false } }`;
  `listWorkItems({ scope: { type: "view", view_id }, display: { group_by: "state" } })`
  returns the `-priority` order and groups by state.
- Test `tests/views.test.ts` "round-trip": `createView` with a partial display and
  filters → `getView` returns the merged display and the same filters →
  `updateView` with `{ display: { group_by: "labels" }, filters: { priority: ["high"] } }`
  → `getView` keeps the other display keys and replaces the filters →
  `listWorkItems` with the view scope and no caller display returns exactly the
  items `listWorkItems` with scope project and those filters returns, in the same
  order.

### A2 Retired identifiers (GAP 2, decision 29)

```ts
// projects.ts
export function resolveRetiredIdentifier(ctx: TesseraContext, identifier: string): ProjectRow | undefined
```
- `identifier` goes through `normalizeIdentifier` first.
- `undefined` when a non-deleted project (archived or not) holds the identifier now:
  the live holder always wins.
- Otherwise: the activity rows with `entity_type = 'project'`, `field =
  'identifier'` and `old_value` equal to the identifier in the stored form that
  `diffFields` writes (check whether it JSON-encodes strings and compare the same
  way), newest `seq` first. Return the first whose project is not deleted and whose
  current identifier differs; else `undefined`.
- `getProject(ctx, idOrIdentifier)`: when the argument is not an id and no project
  holds it, fall back to `resolveRetiredIdentifier`; `NOT_FOUND` as before when
  that is `undefined`.
- `getWorkItemByKey(ctx, keyOrId)` (`work-items/read.ts`): when the key parses and no
  project holds its identifier, look the sequence up in the project
  `resolveRetiredIdentifier` returns. The item carries its current key (`SITE-1`).
  `NOT_FOUND` otherwise.
- `/browse/[key]` needs no change: it redirects by the item's id.
- Test `tests/projects.test.ts` (replaces the assertion that `WEB-1` is `NOT_FOUND`
  after a rename, near lines 201–210) "retired identifier keeps old keys": rename
  WEB → SITE: `getWorkItemByKey("WEB-1").key === "SITE-1"` and `getProject("WEB").id`
  is SITE's; rename SITE → WEB2: `WEB-1` and `SITE-1` both resolve to `WEB2-1`; a new
  project WEB (no items): `WEB-1` is `NOT_FOUND`; after deleting WEB2, `SITE-1` is
  `NOT_FOUND`.

### A3 Reorder views (GAP 3)

```ts
// views.ts
export const ReorderViewInput = z
  .object({
    before_id: IdSchema.optional().describe("Id of the view that will come directly before this one."),
    after_id: IdSchema.optional().describe("Id of the view that will come directly after this one."),
  })
  .strict()
  .refine((value) => value.before_id !== undefined || value.after_id !== undefined, { message: "before_id or after_id is required" });
export type ReorderViewInputType = z.input<typeof ReorderViewInput>;
export function reorderView(ctx: TesseraContext, id: string, input: ReorderViewInputType): View
```
- Mirrors `reorderState`: `validateInput`, `withTx`, the new key from
  `sortOrderForMove` over `listViews(ctx, { project_id: view.project_id })`.
- `NOT_FOUND` for an unknown or deleted view and for a neighbour outside the view's
  scope (another project, or project vs workspace); `VALIDATION` for non-adjacent
  neighbours (from `sortOrderForMove`); `ARCHIVED` when the project is archived.
- Allowed on a locked view: `sort_order` is placement, not view content (schema.md
  "Views" gets this sentence). Allowed while `views_enabled` is off (decision 31
  refuses creates only).
- Activity: verb `updated`, field `sort_order`, identifier the view name (as
  `reorderState`).
- Test `tests/views.test.ts` "reorderView moves a view within its scope": three
  views A, B, C → `reorderView(C, { after_id: A })` lists C, A, B; a workspace view
  as neighbour is `NOT_FOUND`; `{ before_id: A, after_id: C }` when not adjacent is
  `VALIDATION`; a locked view moves; an archived project answers `ARCHIVED`.

### A4 Sub-grouped board drops and the None rule (GAP 4, decision 30)

```ts
// work-items/move.ts: MoveWorkItemInput gains
sub_group_by: GroupBySchema.optional().describe("Second grouping axis changed by the same drop (a board swimlane). Needs group_by and must differ from it."),
sub_value: z.string().nullable().optional().describe("Target value on sub_group_by; null or \"none\" = the none group."),
sub_from_value: z.string().nullable().optional().describe("For labels, assignees and module on sub_group_by: the value the item leaves."),
```
- Checked inside `moveWorkItem` with `validation(...)` (not a schema refine, so the
  tool's `.extend` keeps working): `sub_group_by` without `group_by` ("sub_group_by
  needs group_by"), equal to `group_by` ("sub_group_by must differ from
  group_by"), or without `sub_value` ("sub_value is required with
  sub_group_by"), each at path `sub_group_by`.
- `applyGroupChange(ctx, loaded, axis: { group_by: GroupBy; value: string | null | undefined; from_value: string | null | undefined })`
  runs for the main axis, then for the sub axis, in the same transaction, then
  the sort order. Non-movable sub fields answer `RULE group_not_movable`; any
  failure (an archived module, a completed cycle) rolls both back.
- None rule: for `labels`, `assignees` and `module`, `value` null or `"none"` sets
  the field to `[]` (was: removed `from_value` only). Otherwise `from_value` is
  removed and `value` added when absent, other values kept. `state`, `priority`,
  `cycle` and the dates replace as before.
- Tests `tests/work-items.test.ts`: the existing case "for labels, assignees and
  modules adds the value and removes from_value" changes its none expectation
  (around line 746) from `[bug.id]` to `[]`; new "a drop into none clears a
  multi-valued field"; "a board drop across column state and swimlane labels
  changes both in one call" (state and labels both change, one activity row per
  field); "a two-axis drop is atomic" (sub value an archived module → `ARCHIVED`,
  state unchanged); "sub_group_by needs group_by and must differ" (`VALIDATION`).

### A5 Saved-filter cleanup (GAP 5, decision 32)

```ts
// saved-filters.ts (new; not exported from src/lib/tessera/index.ts)
export type SavedFilterKey = "state" | "labels" | "cycle" | "module";
export function stripIdsFromSavedFilters(ctx: TesseraContext, input: { key: SavedFilterKey; ids: ReadonlySet<string>; project_id: string }): void
```
- Runs inside the caller's transaction (`assertInTransaction`).
- Views: every non-deleted view whose `project_id` is `input.project_id` or null
  (workspace views), locked ones included, whose `filters[key]` holds one of the
  ids: drop the ids, delete the key when the list is empty, write `filters`,
  `updated_at`, `updated_by`, and log what `labels.ts` logs for a view today (verb
  `updated`, field `filters`).
- `view_settings`: every row whose `filters[key]` holds one of the ids, same
  rewrite and the activity row `labels.ts` writes for a settings row today.
- `labels.ts` replaces its own view and view_settings strip helpers with
  `stripIdsFromSavedFilters({ key: "labels", ids: <label and child ids>, project_id })`.
- Called by `deleteState` (`"state"`), `deleteLabel` (`"labels"`), `deleteCycle`
  (`"cycle"`) and `deleteModule` (`"module"`), inside their transactions.
- Tests in `tests/{states,cycles,modules}.test.ts` "delete strips the id from saved
  filters": a project view, a locked project view, a workspace view and a
  `view_settings` row filtering on the id plus another id → the id is gone, the
  other kept; a key left empty is removed. `tests/labels.test.ts` keeps its current
  cases green.

### A6 Taxonomy usage (GAP 6)

```ts
// counts.ts
export type TaxonomyUsage = { states: Record<string, number>; labels: Record<string, number> };
export function getTaxonomyUsage(ctx: TesseraContext, projectId: string): TaxonomyUsage
```
- Counts the project's non-deleted work items, archived and triage included (the
  population `deleteState` moves and `deleteLabel` strips); an id with no items is
  absent. Two grouped queries. `NOT_FOUND` for an unknown project. Read-only, no
  tool: the settings screens read it through `readTessera`.
- Test `tests/states.test.ts` "usage counts archived items": a state whose only item
  is archived has usage 1, and `deleteState` without a target answers
  `RULE state_not_empty`; with usage 0 it deletes.

### A7 Feature toggles refuse creates (GAP 10, decision 31; ui.md P3 row 23)

```ts
// projects.ts
export type ProjectFeature = "cycles" | "modules" | "views";
export function assertFeatureEnabled(project: Pick<ProjectRow, "cycles_enabled" | "modules_enabled" | "views_enabled">, feature: ProjectFeature): void
// RULE feature_disabled: "Cycles are turned off for this project" | "Modules are …" | "Views are …"
```
- Called by `createCycle`, `createModule`, `createView` and `duplicateView` when the
  view's `project_id` is not null, right after the project row is loaded.
- Tests in `tests/{cycles,modules,views}.test.ts` "create refuses while the feature
  is off": `RULE feature_disabled`; list and get still work; turning it on again
  allows the create.

### A8 View search hits (GAP 9)

- `search.ts`: `SEARCH_TYPES` gains `"view"` (last); `SearchType` follows.
- `viewHits`: the same name matching as the cycle hits; non-deleted views of
  non-deleted, non-archived projects with `views_enabled`, plus workspace views
  (`project_id` null) when the search is not scoped to a project; the hit has
  `type: "view"`, `id`, `project_id` (null for a workspace view), the view name as
  the title and the other fields cycle hits set.
- Test `tests/search.test.ts` "search_all finds views": a project view and a
  workspace view match by name; a deleted view, a view of an archived project and a
  view of a project with views off do not.

### A9 Display normalisation and empty sub-groups (GAP 12)

- `view-settings.ts` `mergeDisplay`: after the merge, `sub_group_by` becomes `null`
  when `group_by` is `null` or equals `sub_group_by`. Test
  `tests/view-settings.test.ts` "mergeDisplay drops a sub-group equal to the group
  or without a group".
- `filters.ts` `groupItems`: with `show_empty_groups: false`, empty `sub_groups` are
  left out as empty groups are. Test `tests/filters.test.ts` "show_empty_groups false
  hides empty sub-groups" (if it already holds, the test pins it).

### A10 Counts parity (decision 21; exit criterion)

- Test `tests/counts.test.ts` "listProjects counts equal getCounts": a project with
  a live item, a sub-item, an archived item, a deleted item and (intake on) a triage
  item → `listProjects(ctx, {})` count `total` equals `getCounts({ type: "project" }).total`
  and equals `listWorkItems` scope project `total`.

### A11 Docs

- `rich_filters` (GAP 10 drift): the `.describe()` text of `rich_filters` in
  `CreateViewInput` and `UpdateViewInput` becomes "Stored only; lists and counts do
  not apply it until P10. Use filters." and docs/contracts/schema.md line ~101 says
  "stored since P1, evaluated from P10".
- docs/contracts/service-api.md: append this section. docs/contracts/tools.md:
  append docs/drafts/p4-tools.md. docs/PLAN.md and OWNERS.md: the edits in
  docs/drafts/p4-plan-notes.md.
- `scripts/file-budget.json`: lower `cycles.ts` and `modules.ts` to their final
  `wc -l` counts.

### Budget check for lane A

`cycles.ts` gains about 3 lines (two imports widened, one strip call, one feature
check) inside the room lane 0 made (about 45); `modules.ts` about 3 inside about
28. `projects.ts` (513) grows by about 45; `views.ts` (366) by about 45;
`search.ts` (357) by about 30; `counts.ts` (304) by about 30; all stay under 600.
`work-items/move.ts` and `work-items/read.ts` start at about 150 and 215 lines.
