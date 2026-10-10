# Tool registry contract

Owner: lane A (`src/lib/tessera/tools/registry.ts`); adapters `tools/mcp.ts` and `tools/anthropic.ts` are lane G. The registry is the **single enumeration of operations**: every mutating service export is bound by exactly one tool, and every tool is reachable from the UI (generated Server Actions), from MCP (`tessera_<name>`) and from the assistant (read tools directly, mutations as `propose_<name>`).

## ToolDef

```ts
type ToolDef<I extends z.ZodObject, O> = {
  name: string;                 // snake_case verb_noun, e.g. "create_work_item"
  title: string;                // human label, e.g. "Create work item"
  description: string;          // one paragraph for the model and for MCP listings; mentions rules that matter (archive only when completed, ...)
  input: I;                     // z.object(...).strict(); every field documented with .describe()
  mutates: boolean;             // false = read tool
  destructive?: boolean;        // UI confirms; assistant proposals confirm; MCP requires { confirm: true } in input
  core?: boolean;               // part of the assistant's default toolset (~30 tools)
  phase: "P1" | "P3" | ...;     // when it ships; registry test skips unimplemented phases
  run(ctx: TesseraContext, input: z.infer<I>): O | Promise<O>;
};
export const registry: ReadonlyMap<string, ToolDef>;
export function getTool(name): ToolDef;
export function runToolWithContext(ctx, name, input): Promise<{ data, cursor }>;   // validates, runs, returns latestSeq()
```

Rules
- Names are stable public API; renaming is a contract change.
- Inputs use ids, never keys, except tools that explicitly take a `key` (`get_work_item_by_key`). Id fields end in `_id`.
- Outputs are the view models from `docs/contracts/service-api.md`; list tools return `ListResult`.
- `describe_filters` returns the JSON shapes and enums so an agent can build `Filters` / `Display` without reading the schema.
- Errors: `TrackerError` propagates; adapters map it (below).

## Tools by domain

Destructive tools are marked with †. `core` tools (assistant default set) with ★.

| Domain | Tools |
|---|---|
| Projects | ★`list_projects`, ★`get_project`, ★`create_project`, `update_project`, `update_project_features`, `archive_project`, `unarchive_project`, †`delete_project`, `list_archived_projects` |
| States | ★`list_states`, `create_state`, `update_state`, `reorder_state`, `set_default_state`, †`delete_state` |
| Labels | ★`list_labels`, `create_label`, `update_label`, `reorder_label`, †`delete_label` |
| Actors | ★`list_actors`, `register_actor` |
| Work items | ★`list_work_items`, ★`get_work_item`, ★`get_work_item_by_key`, ★`create_work_item`, ★`update_work_item`, ★`update_work_item_description`, ★`move_work_item`, †`bulk_update_work_items`, `copy_work_item`, †`move_work_item_to_project`, ★`set_labels`, `set_modules`, ★`set_assignees`, `subscribe_work_item`, `unsubscribe_work_item`, `archive_work_item`, `unarchive_work_item`, `list_archived_work_items`, †`delete_work_item`, `list_children`, ★`list_activity`, `list_work_item_versions`, †`restore_work_item_version` |
| Relations, comments, links (P7) | `add_relation`, `remove_relation`, `list_relations`, ★`list_comments`, ★`create_comment`, `update_comment`, †`delete_comment`, `add_reaction`, `remove_reaction`, `add_link`, `update_link`, `remove_link` |
| Cycles (P3) | ★`list_cycles`, ★`get_cycle`, `create_cycle`, `update_cycle`, `reorder_cycle`, `archive_cycle`, `unarchive_cycle`, †`delete_cycle`, `add_work_items_to_cycle`, `remove_work_items_from_cycle`, †`transfer_cycle_work_items`, ★`get_cycle_progress`, `list_active_cycles` |
| Modules (P3) | ★`list_modules`, `get_module`, `create_module`, `update_module`, `reorder_module`, `archive_module`, `unarchive_module`, †`delete_module`, `add_work_items_to_module`, `remove_work_items_from_module`, `set_module_members`, `add_module_link`, `update_module_link`, `remove_module_link`, `get_module_progress` |
| Views and settings (P4) | ★`list_views`, `get_view`, `create_view`, `update_view`, `duplicate_view`, `lock_view`, `unlock_view`, †`delete_view`, `get_view_settings`, `save_view_settings`, `get_project_settings`, `update_project_settings`, `get_automations`, `update_automations` |
| Pages (P6) | ★`list_pages`, ★`get_page`, ★`create_page`, `update_page`, ★`update_page_body`, `move_page`, `lock_page`, `unlock_page`, `archive_page`, `unarchive_page`, †`delete_page`, `duplicate_page`, `list_page_versions`, †`restore_page_version`, `list_page_embeds`, `list_backlinks` |
| Drafts, intake, estimates (P8) | `list_drafts`, `create_draft`, `update_draft`, †`delete_draft`, `move_draft_to_project`, ★`list_intake_items`, †`accept_intake_item`, †`decline_intake_item`, `snooze_intake_item`, `mark_intake_duplicate`, `get_estimate`, `create_estimate`, `update_estimate_points`, `archive_estimate`, `set_estimate_point` |
| Workspace (P9) | `list_favorites`, `add_favorite`, `remove_favorite`, `move_favorite`, `create_favorite_folder`, `rename_favorite_folder`, †`delete_favorite_folder`, `list_recents`, `list_stickies`, `create_sticky`, `update_sticky`, †`delete_sticky`, `list_quick_links`, `add_quick_link`, †`remove_quick_link`, ★`list_notifications`, `mark_notification_read`, `mark_notification_unread`, `archive_notification`, `snooze_notification`, ★`get_home_summary`, ★`get_analytics`, `get_workspace_settings`, `update_workspace_settings` |
| Operations (P10) | `export_csv`, `export_json`, `list_webhooks`, `create_webhook`, `update_webhook`, †`delete_webhook`, `run_automations` |
| Meta | ★`get_counts`, ★`search_all`, `list_changes`, ★`describe_filters` |

## Adapters

### MCP (`tools/mcp.ts`, lane G)

```ts
registerTesseraTools(server: McpServer, opts: {
  toolset?: "all" | "core";
  actorResolver: (clientInfo: { name: string; version?: string }) => ActorRow;   // registers agent `mcp:<name>` on first contact
  afterWrite?: (toolName: string) => void;                                        // HTTP route: revalidatePath("/", "layout")
}): void
```

- Tool names are prefixed `tessera_`. `inputSchema` is `def.input` (zod 4 objects are accepted by `@modelcontextprotocol/server` 2.3).
- Destructive tools require `confirm: true` in the input; otherwise the call fails with a message explaining the flag.
- `TrackerError` → `{ isError: true, content: [{ type: "text", text: "<CODE>: <message>" }] }`.
- Honours `project.agent_intake_required`: `tessera_create_work_item` from an agent actor lands in Intake and the result says so.
- HTTP transport: `src/app/api/mcp/route.ts` via `mcp-handler`. Stdio transport: `scripts/mcp-stdio.ts` (`loadEnvConfig(REPO_ROOT)`, flags `--db <path>`, `--migrate`, `--init` (seed demo data), logs the absolute DB path to stderr, refuses pending migrations without `--migrate`).
- `.mcp.json` at the repo root registers the stdio server for coding agents with an absolute `TESSERA_DB_PATH`.

### Server Actions (`src/app/actions/_run.ts`, lane C owns the file, every lane adds wrappers in its own `actions/<domain>.ts`)

```ts
"use server";
export async function runTool(name: string, input: unknown, actorId = "user"): Promise<ActionResult>
type ActionResult<T = unknown> = { ok: true; data: T; cursor: number } | { ok: false; code: TrackerErrorCode; message: string; details?: unknown };
export const moveWorkItemAction = toolAction("move_work_item");    // typed wrapper generated per tool
```

- `runTool` validates with `def.input`, runs with `ctx` for the given actor, then calls `refresh()` (Server-Action-only API) so the open page re-renders. `refresh()` is skipped for read tools.
- Actions never throw to the client; errors come back as `{ ok: false }` and the UI shows a Toast.

### Anthropic (`tools/anthropic.ts`, lane G)

- Read tools (`mutates: false`) are exposed as `betaZodTool` with the registry's `input` and run directly.
- Every mutating tool gets a `propose_<name>` stub with the same input schema that returns `{ proposal_id, tool, input, preview }` without writing anything. `preview` is produced by `previewTool(name, input)` (resolved names for ids, the resulting key for creates).
- `applyProposals(ctx, proposals)` runs the real tools as actor `assistant`; destructive proposals are only applied after the UI confirmed.
- `TrackerError` → `tool_result` with `is_error: true`.

## Registry test (`tests/registry.test.ts`, lane Q)

1. Every exported function in the domain modules whose name starts with `create|update|delete|archive|unarchive|move|set|add|remove|transfer|restore|accept|decline|snooze|mark|lock|unlock|duplicate|reorder|subscribe|unsubscribe|run|bulk` is referenced by exactly one tool's `run`.
2. Every tool's `input` is a strict zod object and every field has a description.
3. Tool names are unique, snake_case and match `^[a-z][a-z0-9_]*$`.
4. Every `destructive` tool is in the list above; every `delete_*` tool is destructive.
5. `describe_filters` output validates against `FiltersSchema` and `DisplaySchema` metadata.
