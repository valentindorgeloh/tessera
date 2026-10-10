# Service API contract

Owner: lane A. Implementation: `src/lib/tessera/`. Every operation Tessera can perform is a function in this layer; the UI, the MCP server and the assistant call the same functions through the tool registry (`docs/contracts/tools.md`).

## Context, errors, transactions

```ts
type TesseraContext = {
  db: TesseraDb;              // Drizzle instance over better-sqlite3
  actor: ActorRow;            // who performs the call; fills created_by / updated_by / activity.actor_id
  now(): string;              // ISO-8601 UTC
  today(): string;            // YYYY-MM-DD, server local date
};

class TrackerError extends Error {
  code: TrackerErrorCode;     // NOT_FOUND | VALIDATION | CONFLICT | RULE | ARCHIVED | LOCKED | BUSY
  details?: unknown;          // zod issues for VALIDATION, ids for CONFLICT, rule name for RULE
}
```

- `createContext({ db, actorId })` loads the actor row and returns a context. Server code uses `getDb()` from `@/lib/tessera/server`; tests and scripts use `openDatabase(path | ":memory:")` from `@/lib/tessera/db/client`.
- Every mutation runs inside `withTx(ctx, fn).immediate()` (a `BEGIN IMMEDIATE` transaction); reads run outside transactions. Nested calls reuse the open transaction.
- `SQLITE_BUSY` after `busy_timeout` becomes `TrackerError("BUSY")`.
- Validation: each function validates its input with the zod schema exported next to it (`CreateWorkItemInput`, ...). Invalid input throws `VALIDATION` before any write.

## Module map

```
src/lib/tessera/
  types.ts  schemas.ts  core/{keys,time,group}.ts     client-safe
  core/{errors,ids,order,context,tx}.ts              engine helpers
  db/{schema,client,fts,migrate}.ts
  activity.ts  notifications.ts  versions.ts
  actors.ts  projects.ts  states.ts  labels.ts  work-items.ts  assignees.ts
  relations.ts  comments.ts  links.ts
  cycles.ts  modules.ts  views.ts  view-settings.ts  pages.ts  drafts.ts  intake.ts  estimates.ts
  favorites.ts  recents.ts  stickies.ts  home.ts  analytics.ts  automations.ts  exports.ts  webhooks.ts
  filters.ts  counts.ts  search.ts  changes.ts  seed.ts  import-handbook.ts
  index.ts            barrel of everything except db/client (no "server-only")
  server.ts           import "server-only"; export * from "./index"; export { getDb, readTessera, writeTessera }
  tools/{registry,mcp,anthropic}.ts
  ai/{client,assistant,view-from-prompt,digest,narrative,prompts}.ts
```

### Import boundary (enforced by eslint and `scripts/check-conventions.ts`)

| Importer | May import |
|---|---|
| `'use client'` files | `@/lib/tessera/types`, `@/lib/tessera/schemas`, `@/lib/tessera/core/{keys,time,group}` |
| Server Components, Server Actions, route handlers | `@/lib/tessera/server` |
| Vitest, `scripts/*.ts` | `@/lib/tessera`, `@/lib/tessera/db/client` |
| `src/components/**` | never `@/lib/tessera/server`, `@/lib/tessera/db`, `better-sqlite3`, `drizzle-orm` |

## Common shapes

- Rows are Drizzle select types (`WorkItemRow`, `ProjectRow`, ...). Read functions return **view models** that add derived fields: `WorkItem = WorkItemRow & { key: string, label_ids: string[], module_ids: string[], assignee_ids: string[], sub_items_count: number, links_count: number }`.
- `ListResult<T> = { items: T[], total: number, cursor: number }` where `cursor` is `latestSeq()` at read time, so a page can start the change poller without a second query.
- Ids are UUIDv7 strings; keys are `WEB-12` strings; `getWorkItemByKey` accepts either.
- Every mutation returns the fresh view model of the entity it changed.

## Signatures

### P1 set

```ts
// actors.ts
listActors(ctx): Actor[]
registerActor(ctx, { kind: "agent", name, client_name? }): Actor      // idempotent on name_key
touchActor(ctx, actorId): void                                          // last_seen_at

// projects.ts
listProjects(ctx, { archived?: boolean }): Project[]                    // includes counts via getCounts
getProject(ctx, idOrIdentifier): Project
createProject(ctx, { name, identifier, description_md?, logo?, features? }): Project
updateProject(ctx, id, patch): Project                                  // field-scoped; identifier rename allowed
archiveProject(ctx, id) / unarchiveProject(ctx, id) / deleteProject(ctx, id)
updateProjectFeatures(ctx, id, { cycles_enabled?, ..., agent_intake_required? }): Project

// states.ts
listStates(ctx, projectId): State[]
createState(ctx, { project_id, name, state_group, color?, description? }): State
updateState(ctx, id, patch): State
reorderState(ctx, id, { before_id?, after_id? }): State
setDefaultState(ctx, id): State
deleteState(ctx, id, { move_to_state_id? }): void

// labels.ts
listLabels(ctx, projectId): Label[]
createLabel(ctx, { project_id, name, color?, parent_id? }): Label
updateLabel(ctx, id, patch) / reorderLabel(ctx, id, { before_id?, after_id? }) / deleteLabel(ctx, id)

// work-items.ts
listWorkItems(ctx, {
  scope: { type: "project", project_id } | { type: "cycle", cycle_id } | { type: "module", module_id }
       | { type: "view", view_id } | { type: "workspace" } | { type: "profile", actor_id, tab: "assigned" | "created" | "subscribed" }
       | { type: "archived", project_id } | { type: "draft" },
  filters?: Filters, display?: Display, limit?: number, offset?: number
}): ListResult<WorkItem> & { groups?: Group[] }                        // groups when display.group_by is set
getWorkItem(ctx, id): WorkItemDetail                                    // + description, relations, links, subscribers
getWorkItemByKey(ctx, key): WorkItemDetail
listChildren(ctx, id): WorkItem[]
createWorkItem(ctx, {
  project_id, name, description_md?, state_id?, priority?, parent_id?, cycle_id?, label_ids?, module_ids?,
  assignee_ids?, estimate_point_id?, start_date?, target_date?, source?: IntakeSource
}): WorkItem                                                             // honours agent_intake_required for agent actors
updateWorkItem(ctx, id, patch: Partial<{ name, state_id, priority, parent_id, cycle_id, estimate_point_id, start_date, target_date }>): WorkItem
updateWorkItemDescription(ctx, id, { description_md, expected_description_version }): WorkItem   // CAS → CONFLICT
moveWorkItem(ctx, id, { group_by?: GroupBy, value?: string | null, before_id?: string, after_id?: string }): WorkItem
bulkUpdateWorkItems(ctx, ids, patch): WorkItem[]
copyWorkItem(ctx, id, { project_id? }): WorkItem
moveWorkItemToProject(ctx, id, { project_id }): WorkItem
archiveWorkItem / unarchiveWorkItem / deleteWorkItem (ctx, id)
setLabels(ctx, id, label_ids) / setModules(ctx, id, module_ids) / setAssignees(ctx, id, actor_ids)
subscribe(ctx, id, actor_id?) / unsubscribe(ctx, id, actor_id?)

// cycles.ts
listCycles(ctx, projectId, { status?: CycleStatus, archived? }): Cycle[]     // Cycle carries derived status and progress summary
getCycle(ctx, id): CycleDetail
createCycle / updateCycle / reorderCycle / archiveCycle / unarchiveCycle / deleteCycle
addWorkItemsToCycle(ctx, cycleId, ids) / removeWorkItemsFromCycle(ctx, cycleId, ids)
transferCycleWorkItems(ctx, fromCycleId, { to_cycle_id: string | null }): { moved: number }
getCycleProgress(ctx, id, { mode: "issues" | "points" }): CycleProgress
getActiveCycles(ctx): CycleDetail[]

// modules.ts
listModules / getModule / createModule / updateModule / reorderModule / archiveModule / unarchiveModule / deleteModule
addWorkItemsToModule / removeWorkItemsFromModule
setModuleMembers(ctx, id, actor_ids) / addModuleLink / updateModuleLink / removeModuleLink
getModuleProgress(ctx, id): ModuleProgress

// views.ts
listViews(ctx, { project_id: string | null }): View[]
getView / createView / updateView / duplicateView / lockView / unlockView / deleteView

// view-settings.ts
getViewSettings(ctx, scope_type, scope_id): { filters, display }        // defaults when missing
saveViewSettings(ctx, scope_type, scope_id, { filters?, display? }): void

// counts.ts
getCounts(ctx, scope): Counts                                           // one function for sidebar, headers, progress, analytics

// search.ts
searchAll(ctx, q, { scope?: { project_id? }, types?: ("work_item" | "page" | "cycle" | "module" | "project")[], limit? }): SearchHit[]

// activity.ts / changes.ts
listActivity(ctx, { work_item_id? | project_id?, since_seq?, limit? }): ActivityEntry[]   // read-time collapse of consecutive description edits
listChanges(ctx, sinceSeq, { excludeActors?: string[] }): { changes: Change[], cursor: number }
latestSeq(ctx): number

// seed.ts
seedDemo(ctx): void                                                      // demo project WEB with states, labels, 40 items, a cycle, a module
```

### Later phases (same conventions)

- **P6 pages.ts**: `listPages(ctx, { project_id: string | null, parent_id?, archived? })`, `getPage`, `createPage`, `updatePage` (name, access, logo, labels), `updatePageBody(ctx, id, { description_md, expected_description_version })`, `movePage(ctx, id, { parent_id?, project_id? })`, `lockPage`/`unlockPage`, `archivePage`/`unarchivePage`, `deletePage`, `duplicatePage`, `listPageVersions`, `restorePageVersion`, `listPageEmbeds`, `listBacklinks(ctx, entity_type, entity_id)`.
- **P7**: `relations.ts` (`addRelation(ctx, id, { related_id, relation_type })`, `removeRelation`, `listRelations` returning both directions with display type), `comments.ts` (`listComments`, `createComment`, `updateComment`, `deleteComment`, `addReaction`, `removeReaction`), `links.ts`, `notifications.ts` (`listNotifications(ctx, { tab: "all" | "mentions" | "unread" | "archived" | "snoozed" })`, `markRead`, `markUnread`, `archiveNotification`, `snoozeNotification`, `getUnreadCount`).
- **P8**: `drafts.ts` (`listDrafts`, `createDraft`, `updateDraft`, `deleteDraft`, `moveDraftToProject`), `intake.ts` (`listIntakeItems(ctx, projectId, { status })`, `acceptIntakeItem(ctx, id, { state_id? })`, `declineIntakeItem`, `snoozeIntakeItem(ctx, id, { till })`, `markIntakeDuplicate(ctx, id, { duplicate_to_id })`), `estimates.ts` (`getEstimate`, `createEstimate(ctx, { project_id, name, type, points })`, `updateEstimatePoints`, `archiveEstimate`, `setEstimatePoint`).
- **P9**: `favorites.ts`, `recents.ts` (`recordVisit`, `listRecents`), `stickies.ts`, `home.ts` (`getHomeSummary(ctx)`), `analytics.ts` (`getAnalytics(ctx, { tab, scope })` built on `getCounts`).
- **P10**: `versions.ts` (`listWorkItemVersions`, `restoreWorkItemVersion`), `automations.ts` (`runAutomations(ctx)` idempotent, lease-guarded), `exports.ts` (`createExport(ctx, { scope, format })` writing under `data/exports/`), `webhooks.ts`, rich filters in `filters.ts`.

## Activity, notifications, versions

- Every mutation writes one `activity` row per changed field (`verb = "updated"`, `field`, `old_value`, `new_value`, plus `old_identifier` / `new_identifier` for human-readable ids). Creates, deletes, archives, restores and comments write one row each. Relations and cycle or module membership log on both sides.
- `activity.seq` is the global change cursor. `listChanges(sinceSeq)` returns rows with `seq > sinceSeq`, optionally excluding actors (the UI excludes `user` so it only refreshes on external writes).
- Notifications are produced by `notifications.ts` helpers called inside the mutation transaction: assignment, mention, comment on a subscribed item, state change on a subscribed item by another actor, intake arrival, automation action. Never for the causing actor.
- Description and page body writes store a version row; versions by the same actor within 5 minutes collapse into one.

## Counts

`getCounts(ctx, scope)` with `scope ∈ { workspace, project, cycle, module, view, profile }` returns `{ total, by_state_group, by_state, by_priority, by_assignee, by_label, overdue, due_this_week, completed_points?, total_points? }`. Sidebar badges, headers, progress bars, analytics, MCP `get_counts` and the assistant all read this one function so numbers never disagree.

## Filters and display

`filters.ts` turns `Filters` (+ `RichFilters`) into Drizzle `where` fragments and `Display` into `order by` and grouping. Grouping by multi-valued fields (labels, assignees, modules) duplicates the item into every group; `moveWorkItem` with such a `group_by` adds or removes the value instead of replacing it. URL filter state is one base64url-encoded JSON `q=` param; `view_settings` supplies the defaults; URL wins.
