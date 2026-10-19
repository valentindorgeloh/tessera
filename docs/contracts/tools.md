# Tool registry contract

Owner: lane A (`src/lib/tessera/tools/registry/`); adapters `tools/mcp.ts` (built) and `tools/anthropic.ts` (P5) are lane G. The registry is the **single enumeration of operations**: every mutating service export is bound by exactly one tool, and every tool is reachable from the UI (Server Actions through `runTool`), from MCP (`tessera_<name>`) and from the assistant (read tools directly, mutations as `propose_<name>`).

## ToolDef (`tools/define.ts`)

```ts
type ToolDef<Name extends string = string, Input extends z.ZodObject = z.ZodObject, Output = unknown> = {
  name: Name;                   // snake_case verb_noun, e.g. "create_work_item"
  title: string;                // human label, e.g. "Create work item"
  description: string;          // one paragraph for the model and for MCP listings; mentions rules that matter (archive only when completed, ...)
  input: Input;                 // z.object(...).strict(); every field documented with .describe()
  mutates: boolean;             // false = read tool: no transaction, no activity, no refresh()
  destructive?: boolean;        // UI confirms; assistant proposals confirm; MCP requires { confirm: true } in input
  core?: boolean;               // part of the assistant's default toolset (24 tools, ★ below)
  phase: ToolPhase;             // "P1" | "P3" | "P4" | "P5" | "P6" | "P7" | "P8" | "P9" | "P10" (TOOL_PHASES); when it ships
  run(ctx: TesseraContext, input: z.output<Input>): Output | Promise<Output>;
};
defineTool(def): ToolDef                                                       // identity with inference
type Toolset = "all" | "core";

// tools/registry/index.ts
export const registry: ReadonlyMap<string, ToolDef>;                           // contract order; duplicate names throw at load
export function getTool(name: string): ToolDef;                                // NOT_FOUND for unknown names
export function listTools({ toolset?, phase? } = {}): ToolDef[];               // phase is cumulative: "P3" = P1 + P3 tools
export function runToolWithContext(ctx, name, input): Promise<{ data, cursor }>;   // validates with def.input, runs, cursor = latestSeq(ctx)
export type ToolName / ToolInput<N> / ToolOutput<N> / ToolResult<T> = { data: T; cursor: number };
export type DeleteResult = { id: string; deleted: true }; export type RemoveResult = { id: string; removed: true };
```

Rules
- Names are stable public API; renaming is a contract change. The registry holds 91 tools (P1, P3 and P4 rows below; `reorder_view` joined in P4); later rows are not implemented yet.
- Inputs use ids, never keys, except tools that explicitly take a `key` (`get_work_item_by_key`). Id fields end in `_id` and are UUIDs, with two exceptions: `get_project.project_id` is a non-empty string that also accepts the project identifier such as `WEB`, and `scope_id` on the view-settings tools is a plain string (`"workspace"` for the workspace scope).
- Read tools are exactly the `list_*`, `get_*`, `search_*` and `describe_*` tools; every `delete_*` tool is destructive; destructive tools mutate.
- Outputs are the view models from `docs/contracts/service-api.md`; list tools return `ListResult` (the registry wraps array-returning services). `delete_*` tools return `{ id, deleted: true }`, `remove_*` tools `{ id, removed: true }`; `transfer_cycle_work_items` returns `{ moved }`.
- Service functions that take positional ids or arrays get a wrapper object as tool input: `{ <entity>_id, ...patch }` for updates and reorders, `{ work_item_id, label_ids }`, `{ work_item_id, module_ids }`, `{ work_item_id, actor_ids }`, `{ work_item_id, actor_id? }` (subscribe), `{ cycle_id, work_item_ids }`, `{ cycle_id, to_cycle_id }`, `{ module_id, work_item_ids }`, `{ module_id, actor_ids }`, `{ scope_type, scope_id, filters?, display? }` (view settings), `{ project_id, filters?, display?, limit?, offset? }` (`list_archived_work_items`), `{ ids, patch }` (bulk), `{ actor_id, name?, color? }` (`update_actor`).
- `describe_filters` returns the JSON shapes and enums so an agent can build `Filters` / `Display` without reading the schema (payload in `docs/contracts/ai.md`).
- Every tool input converts to JSON Schema with `z.toJSONSchema` and through zod's Standard Schema hook; `RichFiltersSchema` is written so the recursive tree becomes a `$ref` into `$defs` (D21).
- Errors: `TrackerError` propagates; adapters map it (below).

## Tools by domain

Destructive tools are marked with †. `core` tools (assistant default set) with ★. Rows without a phase are P1.

| Domain | Tools |
|---|---|
| Projects | ★`list_projects`, ★`get_project`, ★`create_project`, `update_project`, `update_project_features`, `archive_project`, `unarchive_project`, †`delete_project`, `list_archived_projects` |
| States | ★`list_states`, `create_state`, `update_state`, `reorder_state`, `set_default_state`, †`delete_state` |
| Labels | ★`list_labels`, `create_label`, `update_label`, `reorder_label`, †`delete_label` |
| Actors | ★`list_actors`, `register_actor`, `update_actor` |
| Work items | ★`list_work_items`, ★`get_work_item`, ★`get_work_item_by_key`, ★`create_work_item`, ★`update_work_item`, ★`update_work_item_description`, ★`move_work_item`, †`bulk_update_work_items`, `copy_work_item`, †`move_work_item_to_project`, ★`set_labels`, `set_modules`, ★`set_assignees`, `subscribe_work_item`, `unsubscribe_work_item`, `archive_work_item`, `unarchive_work_item`, `list_archived_work_items`, †`delete_work_item`, `list_children`, ★`list_activity`; P10: `list_work_item_versions`, †`restore_work_item_version`, `bulk_transfer_work_items` (move needs `confirm`) |
| Links | `add_link`, `update_link`, `remove_link` (P1 with `links.ts`; one tool set for work item and module links) |
| Relations, comments (P7) | `add_relation`, `remove_relation`, `list_relations`, ★`list_comments`, ★`create_comment`, `update_comment`, †`delete_comment`, `add_reaction`, `remove_reaction` |
| Cycles (P3, built in P1) | ★`list_cycles`, ★`get_cycle`, `create_cycle`, `update_cycle`, `reorder_cycle`, `archive_cycle`, `unarchive_cycle`, †`delete_cycle`, `add_work_items_to_cycle`, `remove_work_items_from_cycle`, †`transfer_cycle_work_items`, ★`get_cycle_progress`, `list_active_cycles` |
| Modules (P3, built in P1) | ★`list_modules`, `get_module`, `create_module`, `update_module`, `reorder_module`, `archive_module`, `unarchive_module`, †`delete_module`, `add_work_items_to_module`, `remove_work_items_from_module`, `set_module_members`, `add_module_link`, `update_module_link`, `remove_module_link`, `get_module_progress` |
| Views and settings (P4, built in P1) | ★`list_views`, `get_view`, `create_view`, `update_view`, `duplicate_view`, `lock_view`, `unlock_view`, `reorder_view`, †`delete_view`, `get_view_settings`, `save_view_settings`, `reset_view_settings`; ~~`get_project_settings`, `update_project_settings`, `get_automations`, `update_automations`~~ are served by `get_project` / `update_project` (`default_assignee_id`, `archive_in_months`, `close_in_months`, `close_state_id` are fields of `UpdateProjectInput`) and are not separate tools |
| Pages (P6) | ★`list_pages`, ★`get_page`, ★`create_page`, `update_page`, ★`update_page_body`, `move_page`, `lock_page`, `unlock_page`, `archive_page`, `unarchive_page`, †`delete_page`, `duplicate_page`, `list_page_versions`, †`restore_page_version`, `list_page_embeds`, `list_backlinks` |
| Drafts, intake, estimates (P8) | `list_drafts`, `create_draft`, `update_draft`, †`delete_draft`, `move_draft_to_project`, ★`list_intake_items`, †`accept_intake_item`, †`decline_intake_item`, `snooze_intake_item`, `mark_intake_duplicate`, `get_estimate`, `create_estimate`, `update_estimate_points`, `archive_estimate`, `set_estimate_point` |
| Workspace (P9) | `list_favorites`, `add_favorite`, `remove_favorite`, `move_favorite`, `create_favorite_folder`, `rename_favorite_folder`, †`delete_favorite_folder`, `list_recents`, `list_stickies`, `create_sticky`, `update_sticky`, †`delete_sticky`, `list_quick_links`, `add_quick_link`, †`remove_quick_link`, ★`list_notifications`, `mark_notification_read`, `mark_notification_unread`, `archive_notification`, `snooze_notification`, ★`get_home_summary`, ★`get_analytics`, `get_workspace_settings`, `update_workspace_settings` |
| Operations (P10) | `export_csv`, `export_json`, `list_webhooks`, `create_webhook`, `update_webhook`, †`delete_webhook`, `run_automations` |
| Meta | ★`get_counts`, ★`search_all`, `list_changes`, ★`describe_filters` |

## Adapters

### MCP (`tools/mcp.ts`, lane G)

```ts
registerTesseraTools(server: McpServer, {
  handles: DbHandles;                                                              // { sqlite, db } the tools run against
  toolset?: "all" | "core";                                                        // default "all"
  actorResolver: (clientInfo: { name: string; version?: string }) => ActorRow;    // createMcpActorResolver(handles): registers agent `mcp:<name>` on first contact, touches last_seen_at after
  afterWrite?: (toolName: string) => void;                                         // called after every successful mutating tool; HTTP route: revalidatePath("/", "layout")
  fallbackClientName?: string;                                                     // actor name when the handshake carried none; default "unknown"
}): void
MCP_TOOL_PREFIX = "tessera_"; mcpToolName(name); mcpInputSchema(def); mcpToolDescription(def); CONFIRM_FIELD = "confirm"
```

- Tool names are prefixed `tessera_`. `inputSchema` is `def.input` (zod 4 objects are accepted by `@modelcontextprotocol/server`), extended with an optional `confirm: boolean` for destructive tools; the description gains "Destructive: requires confirm: true.". Annotations: `readOnlyHint` and `idempotentHint` = `!mutates`, `destructiveHint` = `destructive`, `openWorldHint` false.
- Destructive tools require `confirm: true`; otherwise the call returns `isError` with `VALIDATION: tessera_<name> is destructive. Call it again with confirm: true to run it.` and writes nothing. `confirm` is stripped before the registry sees the input.
- `TrackerError` → `{ isError: true, content: [{ type: "text", text: "<CODE>: <message>" }] }`. Arguments that fail the schema are rejected by the SDK before the tool runs.
- Success → the JSON result as text plus `structuredContent` (the object itself, or `{ result }` for non-objects). Honours `project.agent_intake_required`: `tessera_create_work_item` from an agent actor lands in Intake and the text is prefixed with a note saying so.
- The client name comes from the initialize handshake (`server.server.getClientVersion()`, isolated in one function); every call creates a context for that actor and runs `runToolWithContext`, so MCP writes carry the same validation, transactions and activity as the UI.
- HTTP transport: `src/app/api/mcp/route.ts` via `mcp-handler`, next to the handbook tools; imports `getDb` from `@/lib/tessera/server`, keeps one resolver per process. Stdio transport: `scripts/mcp-stdio.ts` (`npm run mcp:stdio -- [--db <path>] [--migrate] [--init] [--toolset core|all]`; `loadEnvConfig(REPO_ROOT)`; the database comes from `--db`, `TESSERA_DB_PATH` or `data/tessera.db`; refuses pending migrations without `--migrate` (exit 2); `--init` seeds the demo project; usage errors exit 1; logs the absolute DB path and toolset to stderr, stdout belongs to the transport; `fallbackClientName: "stdio"`).
- `.mcp.json` at the repo root registers the stdio server for coding agents (`npx tsx scripts/mcp-stdio.ts`, absolute `cwd` and `TESSERA_DB_PATH`).

### Server Actions (`src/app/actions/_run.ts`, lane C owns the file, every lane adds wrappers in its own `actions/<domain>.ts`)

```ts
export async function runTool(name: string, input: unknown, actorId = USER_ACTOR_ID): Promise<ActionResult>   // "use server" inside the function body
type ActionResult<T = unknown> = { ok: true; data: T; cursor: number } | { ok: false; code: TrackerErrorCode | "INTERNAL"; message: string; details?: unknown };
export function toolAction<N extends ToolName>(name: N): (input: ToolInput<N>) => Promise<ActionResult<ToolOutput<N>>>
// actions/work-items.ts ("use server" at file level):  export const moveWorkItemAction = toolAction("move_work_item");
```

- `runTool` resolves the tool (`NOT_FOUND` for unknown names), validates with `def.input` before opening the database, runs with a context for the given actor, then calls `refresh()` from `next/cache` (outside the try block) so the open page re-renders. `refresh()` is skipped for read tools.
- Actions never throw to the client; `TrackerError` comes back as `{ ok: false, code, message, details }`, anything else as `code: "INTERNAL"` (logged server-side) and the UI shows a Toast.
- `toolAction(name)` resolves the tool at module load so a typo fails at import time; client code imports only the exported wrappers from file-level `"use server"` action files, never `_run.ts` or the registry.

### Anthropic (`tools/anthropic.ts`, lane G, P5, not built)

- Read tools (`mutates: false`) are exposed as `betaZodTool` with the registry's `input` and run directly.
- Every mutating tool gets a `propose_<name>` stub with the same input schema that returns `{ proposal_id, tool, input, preview }` without writing anything. `preview` is produced by `previewTool(name, input)` (resolved names for ids, the resulting key for creates).
- `applyProposals(ctx, proposals)` runs the real tools as actor `assistant`; destructive proposals are only applied after the UI confirmed.
- `TrackerError` → `tool_result` with `is_error: true`.

## Registry test (`tests/registry.test.ts`, lane Q)

1. Every exported function in the domain modules whose name starts with `create|update|delete|archive|unarchive|move|set|add|remove|transfer|restore|accept|decline|snooze|mark|lock|unlock|duplicate|reorder|subscribe|unsubscribe|run|bulk|register|touch|save|reset|seed` is referenced by exactly one tool's `run`, except the allowlisted helpers with a stated reason (`touchActor`, `seedProjectStates`, `seedDemo`).
2. Every tool's `input` is a strict zod object and every field has a description; `*_id` fields are UUIDs except `get_project.project_id` and `scope_id`; only `get_work_item_by_key` takes a key; every input converts to JSON Schema both ways and the rich filter tree is a `$ref` with the `and` / `or` / `not` / condition branches.
3. Tool names are unique, snake_case and match `^[a-z][a-z0-9_]*$`; every tool carries a title and a one-paragraph description; registry keys equal tool names.
4. Every `delete_*` tool and every tool listed as † above is destructive, nothing else; destructive tools mutate; read tools are exactly the `list_*`, `get_*`, `search_*`, `describe_*` tools; the core toolset equals the ★ tools; phases follow the rows above (links P1, the struck settings and automations tools do not exist); every P1 tool exists.
5. `describe_filters` covers every `Filters` and `Display` key, types each filter by its schema, lists the enums and display values the schemas accept, ships three parsable examples, and is what the tool returns.
6. `listTools` and `getTool` semantics; `runToolWithContext` end to end (validation before running, `ListResult` wrapping, delete results, cursor behaviour); the Server Action runner returns `{ ok: false }` instead of throwing. `tests/mcp.test.ts` and `tests/mcp-stdio.test.ts` cover the adapters (listing, confirm, error mapping, actor registration, stdio flags and exit codes).

## P3 changes (lane A, consumed by docs/contracts/ui.md "P3: cycles, modules, archives")

- No new tools: the registry stays at 90, names, phases, ★ and † marks unchanged.
- Description text (exact):
  - `get_cycle_progress`: "Returns a cycle's progress: totals by state group, item counts per state, label and assignee (with completed counts per label and assignee), and the pending amount per day from start_date to min(end_date, today) for burndown and burnup charts. There is no ideal line and no scope-per-day series: derive the ideal line from the dates and total minus cancelled, and treat scope as today's total. mode issues counts items; mode points sums estimate point values when the project has an active estimate, and chart_mode says which unit the series uses. A cycle whose open items were transferred, or an archived one, returns its frozen snapshot."
  - `get_module_progress`: "Returns a module's progress: item totals by state group, item counts per state, label and assignee (with completed counts per label and assignee), and the same totals in estimate points when the project has an active estimate."
  - `list_cycles`: the current text plus " Each cycle carries open_count, the number of items transfer_cycle_work_items would move."
  - `get_cycle`: "Returns one cycle with its derived status, dates, open_count and progress (issues mode)."
  - `unarchive_cycle`: "Restores an archived cycle; RULE not_archived when it is not archived; CONFLICT when its dates now overlap another active cycle; the frozen snapshot stays."
- Outputs: `list_cycles` and `get_cycle` gain `open_count`; each `list_cycles` item's
  `progress` summary is `{ total, completed, cancelled }` (`cancelled` added in the P3
  fix round, so clients can show completed against total minus cancelled); `get_cycle_progress`,
  `get_cycle` and `get_module_progress` / `get_module` gain the breakdown rows,
  `chart_mode` (cycles) and the P3 points rules (docs/contracts/service-api.md "P3 additions").
- Errors: `create_work_item`, `set_modules` and `move_work_item` (grouped by module)
  answer `ARCHIVED` when a module being added or removed is archived.
- Server Action wrappers added in P3 (file-level `"use server"`, `toolAction(name)`):
  - `src/app/actions/cycles.ts` (lane E1): `createCycleAction`, `updateCycleAction`, `archiveCycleAction`, `unarchiveCycleAction`, `deleteCycleAction`, `addWorkItemsToCycleAction`, `transferCycleWorkItemsAction`.
  - `src/app/actions/modules.ts` (lane E2): `createModuleAction`, `updateModuleAction`, `archiveModuleAction`, `unarchiveModuleAction`, `deleteModuleAction`, `addWorkItemsToModuleAction`, `setModuleMembersAction`, `addModuleLinkAction`, `updateModuleLinkAction`, `removeModuleLinkAction`.
  - `src/app/actions/work-items.ts` (lane E3, additive): `unarchiveWorkItemAction`.
  - `src/app/actions/projects.ts` (lane E3, additive): `archiveProjectAction`, `unarchiveProjectAction`, `deleteProjectAction`.
  - `reorder_cycle` and `reorder_module` get no wrapper in P3 (no reorder UI; MCP only). `remove_work_items_from_cycle` and `remove_work_items_from_module` get none either: an item leaves through its Cycle or Modules property (`update_work_item`, `set_modules`); the row action arrives with the P8 bulk bar.
  - Archives › Work items deletes through the existing `deleteWorkItemAction` (`delete_work_item` works on archived items).
  The UI confirms destructive tools itself (`AlertDialog`, the transfer dialog, the
  typed project identifier); `confirm: true` stays an MCP-only field.
- Registry test: unchanged; the description changes keep every rule in "Registry test".
- Acceptance client `scripts/mcp-call.ts` (lane A, docs/contracts/ui.md "Lane A: engine additions" item 9): `npx tsx scripts/mcp-call.ts <tool> ['<json>']` calls one tool by registry name over stdio (it spawns `npx tsx scripts/mcp-stdio.ts` without `--db`, so it uses the dev server's database; client name `p3-acceptance`) and prints the structured result. As built: exit 0 on success, 1 when the result `isError` (the error text, e.g. `"NOT_FOUND: …"`, is printed as a JSON string), when the call itself is refused, or when the command line is unusable (unknown registry name, arguments that are not one JSON object; no server is started then), and 2 when the connection fails (for example the server's exit 2 on pending migrations).
- As built (lane A): the `mode` input field of `get_cycle_progress` now reads "issues counts items; points also returns estimate point totals and the series in points when the project has an active estimate (chart_mode says which unit the series uses)." The old text promised a points chart unconditionally, which the P3 points rules no longer give.

## P4 changes (lane A, consumed by docs/contracts/ui.md "P4: views, settings, counts")

Draft by the phase planner, 2026-10-17; lane A appends it to
docs/contracts/tools.md. Service details: docs/drafts/p4-service-api.md.

- One new tool; the registry goes from 90 to 91. Tool definitions now live in
  `src/lib/tessera/tools/registry/<domain>.ts` (lane 0 split), `TOOLS` in
  `registry/index.ts`.
- `reorder_view` (`registry/views.ts`):
  - title "Reorder view"; description (exact): "Moves a view directly before or
    after another view of the same scope (the same project, or the workspace);
    before_id or after_id is required. Works on locked views: the order is not
    view content."
  - input `ReorderViewInput.extend({ view_id: ViewId })` (the `reorder_state`
    pattern); `mutates: true`; `phase: "P4"`; not core, not destructive;
    `run: (ctx, { view_id, ...input }) => reorderView(ctx, view_id, input)`.
  - Row in "Tools by domain", Views and settings: insert `reorder_view` after
    `unlock_view`.
- Changed inputs (picked up from the service schemas, no tool code change):
  - `list_work_items` / `list_archived_work_items`: `display` is a patch; omitted
    keys keep the saved view's (scope view) or the defaults.
  - `move_work_item`: `sub_group_by`, `sub_value`, `sub_from_value` (a drop that
    changes column and swimlane in one call); for labels, assignees and module a
    `value` of null or `"none"` now clears the field (decision 30).
  - `search_all`: `types` accepts `"view"`; hits of type `view`.
- Description text (exact), replacing the current one:
  - `move_work_item`: "Reorders a work item (before_id / after_id) and, with
    group_by and value, changes the grouped field as a board or list drop does. For
    labels, assignees and module, from_value is the value the item leaves and the
    others are kept; value null or \"none\" clears the field. sub_group_by,
    sub_value and sub_from_value change a second axis (a board swimlane) in the same
    call; both changes or neither are written."
  - `get_work_item_by_key`: the current text plus " A key with a project's former
    identifier (before a rename), or the key the item had before it was moved to
    another project, still resolves; a former identifier loses to a project that
    uses it now."
  - `get_project`: the current text plus " A former identifier resolves the same
    way."
  - `create_cycle`, `create_module`, `create_view`, `duplicate_view`: the current
    text plus " RULE feature_disabled while the project has the feature turned off."
  - `delete_state`, `delete_label`, `delete_cycle`, `delete_module`: the current
    text plus " Its id is removed from every saved view and remembered view
    setting that filters on it."
  - `search_all`: unchanged; its text already names views, which it now returns.
- Errors: `RULE feature_disabled` (above); `move_work_item` `VALIDATION` at
  `sub_group_by` (needs group_by, must differ, needs sub_value).
- Registry test: `CONTRACT_PHASES` gains `reorder_view: "P4"`; any tool-count
  assertion becomes 91; "service coverage" binds `reorderView` to `reorder_view`.
  `stripIdsFromSavedFilters`, `resolveRetiredIdentifier`, `assertFeatureEnabled`
  and `getTaxonomyUsage` match no mutation prefix.
- Server Action wrappers added in P4 (file-level `"use server"`,
  `export const xAction = toolAction("tool_name")`):
  - `src/app/actions/views.ts` (lane F1): `createViewAction` (`create_view`),
    `updateViewAction` (`update_view`), `duplicateViewAction` (`duplicate_view`),
    `lockViewAction` (`lock_view`), `unlockViewAction` (`unlock_view`),
    `deleteViewAction` (`delete_view`), `reorderViewAction` (`reorder_view`).
  - `src/app/actions/settings.ts` (lane F2, new): `updateProjectFeaturesAction`
    (`update_project_features`), `updateActorAction` (`update_actor`).
  - `src/app/actions/states-labels.ts` (lane F2, additive): `updateStateAction`,
    `reorderStateAction`, `setDefaultStateAction`, `deleteStateAction`,
    `updateLabelAction`, `reorderLabelAction`, `deleteLabelAction`.
  - `updateProjectAction` (`projects.ts`) already exists; General uses it.
  The UI confirms destructive tools itself and never passes `confirm` (as
  `DeleteProjectDialog` calls `deleteProjectAction({ project_id })`).
- Not added: a tool for `getTaxonomyUsage` (server read only), `reorder_project`
  (P9), `list_activity` by actor (P9), an actor permission field (P8).

## P11 changes (lane A, list paging; decisions 112 and 113)

- No new tools. `list_work_items` and `list_archived_work_items` take four more
  optional inputs from `ListWorkItemsInput` (strict, no tool code change):
  `per_group_limit` (1 to 500), `group_value`, `sub_group_value` and
  `group_limits` (record of 1 to 2000, at most 100 entries). `limit` and `offset`
  keep paging the flat list (and now return `has_more`). Callers that send none
  of the new keys get today's result.
- The result's `groups[]` carry `has_more` (always present) and, for a points
  estimate, `estimate_points`; with the new keys `count` and `total` are exact
  over the whole filtered set and `item_ids` / `items` hold the loaded pages (see
  `service-api.md` "List paging").
- Description text (exact), replacing the `list_work_items` one: "Lists work items
  for a scope (project, cycle, module, saved view, workspace, profile tab, archived
  or draft) with Filters combined by AND and Display for ordering and grouping; a
  view scope merges the caller's filters over the saved ones. Returns items, total,
  the change cursor and groups when display.group_by is set. With
  display.group_by, per_group_limit pages every group (counts and has_more stay
  exact), group_value (and sub_group_value) pages inside one group with
  limit/offset. calendar_window keeps the items targeted inside a period plus the
  unscheduled ones. Use describe_filters for the vocabulary."
- `list_work_items` also takes `calendar_window` (`{ from, to }`, `YYYY-MM-DD`,
  inclusive): items whose target date is inside it plus items with no target date.
- `describe_filters` gains a `paging` object (one sentence per key: `limit`,
  `offset`, `per_group_limit`, `group_value`, `sub_group_value`, `group_limits`,
  `calendar_window`); `tests/paging.test.ts` keeps it in step with
  `ListWorkItemsInput`. Its description names the keys.
- Errors: `VALIDATION` at `group_value` without `display.group_by`, and at
  `sub_group_value` without `group_value` or `display.sub_group_by`.
