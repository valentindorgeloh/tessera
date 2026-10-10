# AI contract

Owner: lane G (`src/lib/tessera/ai/**`, `src/app/api/ai/**`, `src/components/ai/**`). Ships in P5 and grows in P7–P10. All model access goes through `@anthropic-ai/sdk` 0.133; usage patterns must match the typings installed in `node_modules/@anthropic-ai/sdk` and the `claude-api` skill.

## Client (`ai/client.ts`)

```ts
import Anthropic from "@anthropic-ai/sdk";
export const anthropic = new Anthropic();                // zero-arg: ANTHROPIC_API_KEY or the `ant auth login` profile
export const AI_MODEL = process.env.TESSERA_AI_MODEL ?? "claude-opus-5-5";
export const AI_EFFORT = (process.env.TESSERA_AI_EFFORT ?? "high") as "low" | "medium" | "high" | "xhigh";
// every request: thinking: { type: "adaptive" }, output_config: { effort: AI_EFFORT }, tool_choice: { type: "auto" }
// max_tokens: 16000 for digests, narratives and view generation; 32000 with stream: true for chat
```

- `GET /api/ai/status` → `{ available: boolean, model: string, reason?: "no_credential" }`. The UI hides the assistant entry points when `available` is false.
- Errors: `AuthenticationError` and `RateLimitError` become a Toast with the SDK message; anything else is logged server-side and shown as "Assistant unavailable".
- `tool_choice` forcing is never used (returns 400 on Opus 5.5); steering is prompt-only.

## Assistant (`POST /api/ai/assist`, SSE)

Request
```ts
{ scope: { project_id?: string; work_item_id?: string; page_id?: string; cycle_id?: string; module_id?: string },
  messages: { role: "user" | "assistant"; content: string }[],
  toolset?: "core" | "all" }
```

Server
- Builds the tool list from the registry: read tools as `betaZodTool`, mutating tools as `propose_<name>` stubs (`docs/contracts/tools.md`), via `client.beta.messages.toolRunner({ max_iterations: 12, ... })` with `stream: true`.
- The system prompt (below) is prefixed with a scope block rendered by `ai/prompts.ts` (`describeScope(ctx, scope)`: project name, identifier, states, labels, cycles, modules, the open work item or page, today's date).
- Streams SSE events: `text_delta { text }`, `tool_use { id, name, input }`, `tool_result { id, ok, summary }`, `proposal { proposal_id, tool, input, preview, destructive }`, `done { stop_reason }`, `error { message }`.
- `stop_reason` handling: `refusal` → stream the explanation; `max_tokens` → `done` with `continue: true` so the client offers Continue; `pause_turn` → resume automatically.
- The server keeps no transcript; the client owns messages and proposals.

Apply (`applyProposalsAction` in `src/app/actions/ai.ts`)
- Input: `proposal_id[]`. Runs each proposal's real tool as actor `assistant` inside one transaction per proposal, writes activity and notifications, calls `refresh()`, returns results in order.
- Destructive proposals (`tools.md` †) are applied only when the request carries `confirmed: true`; the UI shows a confirm Dialog first.
- Undo (P11): the last applied batch can be reverted from the activity rows it produced.

## System prompt (`ai/prompts.ts`)

```
You are the Tessera assistant inside a local, single-user work tracker. You help plan, organise and
summarise work. You can read anything through the tools. You never change data directly: for any
change you call the matching propose_* tool, and the person decides whether to apply it. Propose
the smallest set of changes that fulfils the request, one proposal per change, with ids taken from
tool results (never invented). Prefer asking one short question over guessing when the request is
ambiguous. Use the person's wording for names. Dates are YYYY-MM-DD; today is {today}.
Keys look like WEB-12; use get_work_item_by_key when the person types one.
When summarising, lead with what changed and what needs a decision; cite keys. Keep answers short.
{scope}
```

## `describe_filters` payload

Built in P1 (`src/lib/tessera/tools/describe-filters.ts`, tool `describe_filters` ★ / `tessera_describe_filters`); computed from the zod schemas once per process.

```ts
{
  enums: { state_group, priority, module_status, relation_type, intake_status, layout, palette_color },   // string[] each
  filters: { <every Filters key>: { type: "ids" | "enum" | "date" | "text" | "boolean", of?: "state" | "label" | "actor" | "cycle" | "module" | "project", description } },
           // `parent` is an ids filter without `of` (work item ids)
  display: { layout: Layout[], group_by: GroupBy[], sub_group_by: SubGroupBy[], order_by: OrderBy[], type: (null | "active" | "backlog")[],
             show_empty_groups: boolean[], sub_items: boolean[], calendar: { layout: ("month" | "week")[], show_weekends: boolean[] }, properties: string[] },
  default_display: Display,            // what a list shows when nothing is saved; a DisplayPatch merges over it
  examples: [{ title: "Open high-priority items assigned to me", filters: Filters, display: DisplayPatch },
             { title: "Overdue work on a board by state", ... }, { title: "Due in the next two weeks, grouped by assignee, top-level items only", ... }]
}
```

`tests/registry.test.ts` checks that it covers every `Filters` and `Display` key, lists the enum and display values the schemas accept and that the examples parse.

## View from prompt (`ai/view-from-prompt.ts`, P5)

`client.messages.parse({ model, max_tokens: 16000, thinking: { type: "adaptive" }, output_config: { effort, format: zodOutputFormat(ViewSpecSchema) }, system, messages })` where `ViewSpecSchema = FiltersSchema.merge(DisplaySchema).extend({ name: z.string(), rationale: z.string() })`. The result is shown as a proposal; Apply creates the view through `create_view`.

## Digests and narratives

- `cycleDigest(ctx, cycleId)`, `moduleDigest(ctx, moduleId)`, `inboxDigest(ctx)` and `sinceLastHere(ctx)` summarise `listActivity` / `listNotifications` output with `client.messages.create` (`max_tokens: 16000`). Results are cached in memory keyed by `(kind, id, latestSeq)` so an unchanged database never re-bills.
- `analyticsNarrative(ctx, tab, scope)` explains `getAnalytics` numbers; it quotes numbers from the payload only.
- Intake triage help (P8): for pending intake items the assistant proposes `accept_intake_item`, `decline_intake_item` or `mark_intake_duplicate` with a reason; never applies.

## Key safety

- `next dev -H 127.0.0.1`; `src/lib/http-guard.ts` rejects AI routes unless the Host is loopback and `Sec-Fetch-Site` is `same-origin` or `none`.
- No AI module is importable from client code (import boundary). `scripts/check-conventions.ts` plus the P11 static check (`grep -r ANTHROPIC .next/static` empty) guard the bundle.
- The assistant never receives the API key; it only runs through the server.
