## P5: AI (phase plan)

Draft by the phase planner, 2026-10-17, on `main` at `e03e664`. It assumes the P4
contract is delivered (docs/drafts/p4-ui.md, p4-service-api.md, p4-tools.md,
p4-plan-notes.md): registry and work items are folders, decisions 29–32 exist,
`ViewsScreen` and the settings tabs exist, the registry holds 91 tools.

This is a plan, one level lighter than a contract. A planner refreshes it into the
full P5 contract right before the build. Items marked **refresh before build**
depend on code P4 has not written yet, or on a count or line number that only the
P4 result can give.

Sources: docs/PLAN.md §8, §9 (P5 row), decisions 12, 26 and U2;
docs/contracts/ai.md and tools.md ("Anthropic"); the `claude-api` skill
(TypeScript README, tool-use.md, streaming.md). Every SDK name below was checked
in `node_modules/@anthropic-ai/sdk` 0.133.0 ("SDK verification" at the end).
Every Astryx prop was checked in `node_modules/@astryxdesign/core/dist/*/*.d.ts`
0.6.8 ("Astryx verification").

Exit criteria (PLAN §9 P5) and where they are proven:
- `propose_*` writes nothing until Apply: Vitest `tests/ai/anthropic-tools.test.ts`
  "propose writes only a proposal row" (no activity row, `latestSeq` unchanged, the
  entity unchanged); acceptance steps 5 and 6.
- Destructive Apply confirms: Vitest `tests/ai/proposals.test.ts` "destructive
  needs confirmed"; acceptance step 9.
- No key in the client bundle: convention rule `ai-boundary` (below); acceptance
  step 2 (`grep` over `.next/static`).

### 1. Scope and deferrals

Ships in P5:
- **Assistant panel**: a right-hand panel in the shell (TopBar button, `mod+j`),
  scoped to the route on screen (project, work item or peek, cycle, module). It
  streams the answer, shows the read tools it used, and lists its proposals with
  Apply, Apply all and Discard. Destructive proposals open a confirm AlertDialog
  first. The conversation survives navigation and a reload of the tab (it is stored
  per tab). The assistant has "New conversation" and Stop.
- **Power K Ask**: the existing Ask mode of the command bar. Typing a question and
  pressing Enter hands it to the assistant panel (decision 38). Contextual
  suggestions appear while the input is empty.
- **View from prompt**: "Describe a view" on the project views list. It produces one
  `create_view` proposal (name, rationale, filters, display) that the person applies
  like any other proposal.
- **Cycle and module digests**: a Digest card on the cycle and module detail
  screens. "Summarise" generates it on request. The stored text is shown on the next
  visit, and the card says "Out of date" after newer activity (decision 37).
- **Status and safety**: `GET /api/ai/status` hides every entry point when no
  credential resolves. `src/lib/http-guard.ts` guards the AI routes (loopback Host,
  same-origin, JSON). A new convention rule keeps the SDK out of client code.
- **Engine**: the `ai_proposal` and `ai_digest` tables (migration `0002`), the
  proposal store with Apply as actor `assistant`, `previewTool`, and `listActivity`
  for a cycle or module scope. The Anthropic adapter (`tools/anthropic.ts`) and
  `ai/**`.
- **Lane 0**: splits `db/schema.ts` (on the file budget) so the migration can add
  tables.

| Deferred | Phase | Note |
|---|---|---|
| Undo the last applied assistant batch | P11 | `ai_proposal.seq_from` / `seq_to` are recorded from P5, so undo can find the activity rows |
| Inbox digest; notifications for assistant writes | P7 | Needs `notification` rows; P5 Apply writes activity only |
| Assistant creates comments and mentions | P7 | Comment tools ship in P7; their `propose_*` stubs appear automatically |
| Intake triage proposals (accept, decline, duplicate with a reason) | P8 | Intake tools ship in P8; the prompt rule is added then |
| "Since you were last here" Home widget; analytics narrative | P9 | `ai_digest.kind` gains `home` and `analytics` values |
| Workspace AI settings page `/settings/ai` (model and effort overrides, digest switch) | P9 | Needs `get_workspace_settings` / `update_workspace_settings` (P9 tools). P5 reads `TESSERA_AI_MODEL` / `TESSERA_AI_EFFORT` only; `workspace_settings.ai` stays unused |
| Assistant scoped to a page (`scope.page_id`) | P6 | The schema accepts the field from P5; `describeScope` ignores it until pages exist |
| Proposal history screen and purge of old rows | P11 | Rows stay; pending rows expire after 24 h (decision 33) |
| Token usage and cost display | P11 | `usage` is logged server-side only |
| Playwright AI tests on recorded responses | P11 | P5 tests use a fake client; acceptance uses the real API |
| Static bundle check as a gate script | P11 | P5 proves it in acceptance step 2 |
| Fast mode, a model picker in the UI, dictation (`ChatDictationButton`) | not planned | |
| Chat inside the Power K palette | not planned | Decision 38: one conversation surface |

### 2. New decisions (lane A1 writes them into docs/PLAN.md after row 32)

- **33 Proposal store.** Every assistant write is an `ai_proposal` row first: the
  tool name, its input (validated by the tool's schema when it is proposed) and a
  preview. Apply runs that stored input, validated again, as actor `assistant`, never
  input sent by the client. A proposal moves `pending → applying → applied | failed`
  or `pending → discarded`. Apply claims the row with a conditional update, so a
  double click applies it once. The tool's writes and the status change commit in one
  immediate transaction, which records `seq_from` and `seq_to` (the activity range it
  wrote) for undo in P11. Destructive proposals apply only with `confirmed`. A
  pending proposal older than 24 hours is refused with `RULE proposal_expired`.
- **34 Assistant bookkeeping is not an operation.** Proposal and digest rows are
  derived state, not tracker data. Their functions live in `src/lib/tessera/ai/**`,
  outside the `index.ts` barrel. They are not registry tools, are not reachable over
  MCP, write no activity and do not move the change cursor. This is the one stated
  exception to decision 26. The tracker writes that Apply makes go through the
  registry (`runToolWithContext`) like every other write.
- **35 Conversation state.** The client owns the transcript: text turns only, kept
  in `sessionStorage` under `tessera.assistant.v1`, with a client-made
  `conversation_id` (`crypto.randomUUID()` in an event handler). Each request sends
  the text history. The server does not replay tool calls or thinking blocks across
  turns. Instead it adds the conversation's proposals and their statuses (pending,
  applied, failed with the reason, discarded) to the scope block, so the model knows
  what happened to them. Proposals cannot reference work items that another pending
  proposal would create: a create proposal carries all its fields (labels,
  assignees, cycle, modules) itself.
- **36 Request shape.** The assistant uses `client.beta.messages.toolRunner` with
  `stream: true` and `max_iterations: 12`. It sends the `all` toolset by default,
  read tools as themselves and mutating tools as `propose_<name>`, in registry
  order. `system` has two blocks: the frozen prompt (with
  `cache_control: { type: "ephemeral" }`) and the volatile scope block (today's date,
  scope, proposals). The tools and the frozen prompt therefore stay a cached prefix.
  Every call sends `thinking: { type: "adaptive" }`, `output_config.effort` from
  `TESSERA_AI_EFFORT` (default `high`, set explicitly because the model's own default
  is `medium`) and no `tool_choice` (auto). Calls in the beta namespace (the
  assistant and digests) send `betas: ["server-side-fallback-2026-07-01"]` and
  `fallbacks: "default"`. `eager_input_streaming` stays off: tool inputs are small
  ids and patches, and buffered input arrives already validated.
- **37 Digests on request.** A digest is generated only when the person clicks
  Summarise or Refresh, never on page load. It is stored in `ai_digest` under
  `(kind, entity_id)`. `input_seq` is the highest activity `seq` among the rows it
  summarised. A detail page compares it with the current input seq to show
  "Out of date". Regenerating overwrites the row.
- **38 One conversation surface.** Power K Ask does not chat inside the palette.
  Enter closes the palette, opens the assistant panel and sends the question there,
  with the same scope. View from prompt makes a `create_view` proposal
  (`source: "view_from_prompt"`) that the shared Apply applies.
- **39 Model calls are route handlers.** Anything that calls the model is a `POST`
  route under `/api/ai/` (`assist`, `digest`, `view`) or a `GET` route (`status`).
  They are not Server Actions, because Server Actions run one at a time per client
  and a 30-second model call would block board moves. Apply and Discard are Server
  Actions: they are fast, and they need `refresh()`. Every AI route goes through
  `guardAiRequest` (loopback Host, `Sec-Fetch-Site` `same-origin`, or also `none` on
  GET, and a JSON body on POST).

### 3. Data model changes

**Lane 0 split (no schema change).** `src/lib/tessera/db/schema.ts` (857 lines, on
the budget) becomes the folder `src/lib/tessera/db/schema/`. Importers keep
importing `./schema` and `../db/schema`. The files are cut at the section comments
(line numbers as of `e03e664`, **refresh before build**):

| File | Old lines | Content |
|---|---|---|
| `columns.ts` | 1–67 | header comment, `DELETED_AT_IS_NULL`, `auditColumns`, `createdColumns` (exported) |
| `core.ts` | 68–401 | Core (P1): actor … activity |
| `pages.ts` | 402–472 | Pages (P6) |
| `collaboration.ts` | 473–587 | Collaboration (P7) |
| `planning.ts` | 588–680 | Planning extras (P8) |
| `workspace.ts` | 681–742 | Workspace (P9) |
| `hardening.ts` | 743–812 | Hardening (P10) |
| `index.ts` | 813–857 | `export *` of each file, the `schema` object, `TesseraSchema` |

- `drizzle.config.ts`: `schema: "./src/lib/tessera/db/schema/index.ts"`.
- `scripts/check-conventions.ts`: the `drizzle-zod` rule allows
  `src/lib/tessera/db/schema/**`.
- `scripts/file-budget.json`: remove the `db/schema.ts` entry.
- Gate: `npx drizzle-kit generate` prints "No schema changes" and writes no file.
  If it writes a migration, the split is wrong: delete the file and fix the split.

**Lane A1: `src/lib/tessera/db/schema/ai.ts` (new), added to the `schema` object in
`index.ts`.** Generated with `npm run db:generate` as `drizzle/0002_ai.sql` (the
`drizzle-kit` tag name is accepted as generated):

`ai_proposal`
| Column | Type | Notes |
|---|---|---|
| `id` | text PK | UUIDv7 |
| `conversation_id` | text not null | client uuid (decision 35) |
| `source` | text not null | `ProposalSource`: `assistant`, `view_from_prompt` |
| `tool` | text not null | registry name, mutating tools only |
| `input` | text json not null | the validated tool input |
| `preview` | text json not null | `ProposalPreview` |
| `destructive` | integer bool not null | copied from the ToolDef |
| `status` | text not null default `pending` | `ProposalStatus`: `pending, applying, applied, failed, discarded` |
| `project_id` | text null → `project.id` on delete set null | scope of the conversation, for the scope block |
| `tool_use_id` | text null | the model's `tool_use` id, links the SSE events |
| `result` | text json null | tool output on success |
| `error_code`, `error_message` | text null | `TrackerErrorCode` and message on failure |
| `seq_from`, `seq_to` | integer null | activity range written by Apply (decision 33) |
| `created_at`, `decided_at` | text | ISO UTC; `decided_at` at apply, fail or discard |

Indexes: `ai_proposal_conversation_idx (conversation_id, created_at)` and
`ai_proposal_status_idx (status, created_at)`. There is no `deleted_at`: rows are
bookkeeping (decision 34), not entities.

`ai_digest`
| Column | Type | Notes |
|---|---|---|
| `kind` | text not null | `DigestKind`: `cycle`, `module` (P7/P9 add `inbox`, `home`, `analytics`) |
| `entity_id` | text not null | cycle or module id (no FK: polymorphic) |
| `input_seq` | integer not null | decision 37 |
| `body_md` | text not null | markdown |
| `model` | text not null | the model id that answered (`response.model`) |
| `created_at` | text not null | |

PK `(kind, entity_id)`.

- Enums in zod (decision 5), in `schemas.ts` (lane 0): `ProposalStatusSchema`,
  `ProposalSourceSchema`, `DigestKindSchema`.
- `docs/contracts/schema.md` gets an "AI (P5)" table section (lane A1).
- Migration safety follows the existing path: `VACUUM INTO` backup before a pending
  migration, and the stdio server refuses pending migrations unless started with
  `--migrate`.

### 4. Engine additions

Lane A owns `src/lib/tessera/**`, which for P5 includes the AI half that PLAN §10
gives lane G (`tools/anthropic.ts`, `ai/**`), so `src/lib/tessera` keeps one owner
lane. Lane A has two workers with disjoint files: **A1** (data, proposals, preview,
activity scopes) and **A2** (model calls). A1 lands its signatures first (step A0)
and A2 builds against them.

**A1: `src/lib/tessera/ai/proposals.ts`**
```ts
export const CreateProposalInput = z.object({
  conversation_id: z.uuid().describe(...), source: ProposalSourceSchema, tool: z.string().min(1),
  input: z.unknown(), project_id: IdSchema.nullable().default(null), tool_use_id: z.string().nullable().default(null),
}).strict();
export function createProposal(ctx, input): ProposalView;
  // getTool(tool) must exist and mutate (else VALIDATION not_mutating); validateInput(def.input, input);
  // preview = previewTool(ctx, tool, data); insert; no activity (decision 34)
export function listProposals(ctx, { conversation_id }): ProposalView[];       // created_at order
export function getProposal(ctx, id): ProposalView;                              // NOT_FOUND
export const ApplyProposalsInput = z.object({ ids: z.array(IdSchema).min(1).max(50), confirmed_ids: z.array(IdSchema).default([]) }).strict();
export function applyProposals(handles: DbHandles, input): ApplyOutcome[];        // in `ids` order, continues past failures
export function applyProposal(ctx /* actor assistant */, id, { confirmed }): ApplyOutcome;
  // withTx: claim (UPDATE … SET status='applying' WHERE id=? AND status='pending' RETURNING) → none: CONFLICT already_decided;
  // expired (created_at older than 24 h) → RULE proposal_expired; destructive && !confirmed → RULE needs_confirmation (row stays pending);
  // seq_from = latestSeq+1; out = def.run(ctx, validateInput(def.input, row.input)) (a Promise here throws: mutating tools are sync);
  // status applied, result, seq_to = latestSeq, decided_at. On throw: the transaction rolls back, then a second
  // small transaction sets failed + error_code/error_message (TrackerError) or INTERNAL.
export function discardProposals(ctx, { ids }): ProposalView[];                  // pending only; others unchanged
export type ApplyOutcome = { id: string; status: "applied" | "failed" | "pending"; error?: { code; message }; data?: unknown };
```
`ProposalView = { id, conversation_id, source, tool, title, input, preview, destructive, status, error, created_at, decided_at }`
(client-safe type in `types.ts`, lane 0). **Refresh before build:** confirm that every mutating tool's `run`
is synchronous (A1 adds a registry test assertion), since a better-sqlite3 transaction cannot span an await.

**A1: `src/lib/tessera/ai/preview.ts`**
```ts
export function previewTool(ctx, name: string, input: unknown): ProposalPreview;
type ProposalPreview = {
  title: string;                                   // "<def.title> · <target label>", e.g. "Update work item · WEB-12 Fix login"
  target: { type: "project" | "work_item" | "state" | "label" | "cycle" | "module" | "view" | "actor" | "link"; id: string | null; label: string } | null;
  fields: { field: string; label: string; before: string | null; after: string | null }[];
  note?: string;                                   // e.g. "Expected key WEB-13", "Moves 4 open items", "Deletes 1 work item"
};
```
- Ids become names through one resolver map: `state_id` → state name, `label_ids` →
  label names, `assignee_ids` / `actor_ids` / `actor_id` → actor names, `cycle_id`,
  `to_cycle_id`, `module_id` / `module_ids`, `project_id` → identifier and name,
  `work_item_id` / `ids` / `work_item_ids` / `parent_id` → `KEY title`, `view_id`. An
  id that does not resolve shows `Unknown (<first 8 chars>)` and adds
  `note: "Refers to something that does not exist"`. Apply then fails with
  `NOT_FOUND`.
- `before` is read from the current entity for updates (`get*` of the target: work
  item, project, state, label, cycle, module, view). For creates `before` is null. For
  `create_work_item`, `note` is `Expected key <IDENT>-<next_sequence>`.
- Enums are shown in their UI words (priority "High", state group words), using the
  same maps the UI uses. **Refresh before build:** the map file lives under
  `src/components/**`. Move the pure maps to `core/` if they are not client-safe
  already.
- The description field shows the first 200 characters of `after` and
  `"(N characters)"`.

**A1: `src/lib/tessera/ai/digest-store.ts`**
```ts
export function digestInputs(ctx, kind: DigestKind, id: string): { subject: Cycle | Module; progress; activity: ActivityLogEntry[]; input_seq: number };
  // activity = listActivity(ctx, { cycle_id | module_id, limit: 300 }); input_seq = max seq (0 when empty)
export function currentDigestSeq(ctx, kind, id): number;                          // cheap MAX(seq) query, same rows
export function getStoredDigest(ctx, kind, id): DigestView | null;               // { kind, entity_id, body_md, input_seq, model, created_at, is_stale }
export function saveDigest(ctx, row): DigestView;                               // upsert, no activity (decision 34)
```

**A1: `src/lib/tessera/changes.ts`.** `ListActivityInput` gains
`cycle_id: IdSchema.optional()` and `module_id: IdSchema.optional()`. The refine
becomes "exactly one of work_item_id, project_id, cycle_id or module_id". A cycle
feed is the cycle's own rows, plus the rows of work items that are members now,
plus membership rows naming the cycle. A module feed is the same for the module.
The `list_activity` description gains the sentence "cycle_id or module_id returns
the feed of a cycle or module and the work items in it." (`registry/meta.ts`, or
wherever `list_activity` lives after P4, **refresh before build**.)

**A1: `src/lib/tessera/server.ts`** gains explicit named exports from `./ai`
(`createProposal`, `listProposals`, `applyProposals`, `discardProposals`,
`getStoredDigest`, `currentDigestSeq`, and the A2 entry points below). `index.ts`
stays as it is (decision 34). The barrel scan in `tests/registry.test.ts` therefore
never sees them.

**A2: `src/lib/tessera/ai/client.ts`**
```ts
import Anthropic from "@anthropic-ai/sdk";
export const AI_MODEL = process.env.TESSERA_AI_MODEL ?? "claude-opus-5-5";
export function aiEffort(): "low" | "medium" | "high" | "xhigh";               // TESSERA_AI_EFFORT ?? "high", validated with AiEffortSchema
export const AI_BETAS = ["server-side-fallback-2026-07-01"] as const;           // decision 36
export const AI_FALLBACKS = "default" as const;
export function getAnthropic(): Anthropic;                                       // lazy singleton `new Anthropic()` (zero-arg)
export function setAnthropicForTests(client: Anthropic | null): void;
export function getAiStatus(): Promise<AiStatus>;                                // client.models.retrieve(AI_MODEL), cached 10 min;
  // AuthenticationError | constructor throw → { available: false, reason: "no_credential" }; NotFoundError → "model_unavailable";
  // APIConnectionError → "offline" (cached 30 s only); ok → { available: true, model }
```
Error mapping (`toAiError(err): { kind: "auth" | "rate_limit" | "unavailable"; message }`): `Anthropic.AuthenticationError`
→ auth, `Anthropic.RateLimitError` → rate_limit, anything else → unavailable, which is logged with
`console.error` and shown as "Assistant unavailable".

**A2: `src/lib/tessera/ai/prompts.ts`**
- `SYSTEM_PROMPT`: the docs/contracts/ai.md text with two changes. "today is
  {today}" moves into the scope block, so the frozen block never changes. It gains
  the decision 35 sentence: "A proposal cannot use the id of an item another
  proposal would create; put all fields into the create proposal."
- `describeScope(ctx, scope, proposals: ProposalView[]): string` renders today, the
  project (name, identifier, states, labels, open cycles, modules; at most 50 of
  each), the open work item (key, title, state, priority, assignees, the first 2,000
  characters of the description), the cycle or module, and the conversation's
  proposals as `- <title> — <status>[: <error>]`.
- `DIGEST_SYSTEM` and `VIEW_SYSTEM` are short frozen prompts. A digest leads with
  what changed and what needs a decision, cites keys and quotes numbers only from the
  input. A view prompt says to use the `describe_filters` payload (inlined) and ids
  from the scope block.

**A2: `src/lib/tessera/tools/anthropic.ts`**
```ts
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ToolError } from "@anthropic-ai/sdk/lib/tools/ToolError";
export const PROPOSE_PREFIX = "propose_";
export function buildAssistantTools(handles: DbHandles, opts: {
  toolset: Toolset; conversationId: string; projectId: string | null;
  emit: (event: AssistantEvent) => void;
}): BetaRunnableTool[];
```
- Read tools: `betaZodTool({ name: def.name, description: def.description, inputSchema: def.input, run })`.
  `run` makes an `assistant`-actor context, calls `runToolWithContext`, returns `JSON.stringify(data)`
  (cut to 50,000 characters with a `"truncated": true` marker) and emits `tool_result { id: ctx.toolUse.id, ok: true, summary }`.
  A `TrackerError` is thrown as `new ToolError("<CODE>: <message>")`, which becomes `is_error: true`.
- Mutating tools: `propose_<name>`, with the description
  `"Proposes, does not apply: " + def.description + " Nothing changes until the person applies it."`,
  plus `" Destructive: the person must confirm."` when † applies. The input is the same `def.input`. `run`
  calls `createProposal`, emits `proposal { proposal: ProposalView }` and returns
  `JSON.stringify({ proposal_id, status: "pending", preview: preview.title, note: preview.note })`.
  Invalid input (zod, or `VALIDATION` from createProposal) → `ToolError`.
- Tool names stay at most 64 characters (asserted in the test). The order follows
  `listTools({ toolset })`, so the cached prefix is stable (decision 36).

**A2: `src/lib/tessera/ai/assistant.ts`**
```ts
export async function* runAssistant(handles, request: AssistRequest, signal: AbortSignal): AsyncGenerator<AssistantEvent>;
```
- `getAnthropic().beta.messages.toolRunner({ model: AI_MODEL, max_tokens: 32000, stream: true, max_iterations: 12,
  thinking: { type: "adaptive" }, output_config: { effort: aiEffort() }, betas: [...AI_BETAS], fallbacks: AI_FALLBACKS,
  system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }, { type: "text", text: scopeBlock }],
  messages, tools }, { signal })`.
- Iterates the runner (`for await (const messageStream of runner)`) and, inside it,
  the stream events. `content_block_delta` / `text_delta` becomes `text_delta`.
  `content_block_start` with a `tool_use` block becomes `tool_use { id, name }`.
  After `await messageStream.finalMessage()`:
  - `stop_reason === "refusal"`: emit `stop_details.explanation` as text and end with
    `done { stop_reason: "refusal" }`.
  - `"max_tokens"` with a `tool_use` in the content: stop with
    `done { stop_reason, continue: true }` and never run that turn's tools.
  - `"pause_turn"`: `runner.pushMessages({ role: "assistant", content: message.content })`,
    at most twice.
  - Content blocks of type `fallback` emit `notice { text: "Answered by <to.model>" }`.
- Events the tools emit go through `ai/event-queue.ts` (a small async queue
  `createEventQueue<T>()` with `push`, `close` and an async iterator), so they
  interleave with the stream in order.
- Abort (`signal`) ends the stream with `done { stop_reason: "aborted" }`. An
  `Anthropic.APIUserAbortError` is not an error.
- Logs `usage` (input, output, cache read) with `console.info` per turn.

**A2: `src/lib/tessera/ai/view-from-prompt.ts`**
```ts
export const ViewSpecSchema = z.object({ name: z.string().min(1).max(255), description: z.string().max(500).optional(),
  filters: FiltersSchema, display: DisplayPatchSchema, rationale: z.string() });   // no rich_filters (stored-only until P10)
export async function viewFromPrompt(handles, { project_id, prompt, conversation_id }): Promise<ProposalView>;
```
It calls `getAnthropic().messages.parse({ model, max_tokens: 16000, thinking: { type: "adaptive" },
output_config: { effort, format: zodOutputFormat(ViewSpecSchema) }, system, messages })`. It reads
`parsed_output`: a null result, or a `refusal` stop, → `RULE view_not_generated` with the model's text.
It then calls `createProposal({ source: "view_from_prompt", tool: "create_view", input: { project_id, name,
description, filters, display } })`. The rationale goes in `preview.note`. This call is in the non-beta
namespace, so no fallback (decision 36).

**Refresh before build:** a Vitest proves that
`zodOutputFormat(ViewSpecSchema)` produces a JSON schema without keywords the API
rejects (check the skill's structured-output limits on the day). If `FiltersSchema`
carries unsupported constraints, `ViewSpecSchema` uses a flattened copy built in this
file.

**A2: `src/lib/tessera/ai/digest.ts`**
```ts
export async function generateDigest(handles, kind: DigestKind, id: string): Promise<DigestView>;
```
It builds `digestInputs`, calls `getAnthropic().beta.messages.create({ model, max_tokens: 16000,
thinking: { type: "adaptive" }, output_config: { effort }, betas, fallbacks, system: DIGEST_SYSTEM, messages })`,
joins the `text` blocks and calls `saveDigest`. When `input_seq` equals the stored row's, it returns the
stored row without a call (decision 37). On a refusal → `RULE digest_refused` with the explanation.

**A2: `src/lib/tessera/ai/index.ts`** exports `runAssistant`, `viewFromPrompt`,
`generateDigest`, `getAiStatus`, `toAiError`, the A1 functions and their input
schemas. `server.ts` re-exports these names.

**Tests (fake client, no network).** `setAnthropicForTests` injects an object with
`beta.messages.toolRunner`, `beta.messages.create`, `messages.parse` and
`models.retrieve`, which return scripted messages and streams.
- `tests/ai/proposals.test.ts` (A1): create validates, refuses read tools and
  unknown tools; apply as assistant writes activity with `actor_id = assistant`
  and records `seq_from`/`seq_to`; a double apply gives `CONFLICT` with no second
  activity row; destructive needs confirmed (the row stays pending); expired; a
  failed apply rolls back the tool's writes and stores `error_code`; discard
  touches only pending rows; `latestSeq` is unchanged by create and discard.
- `tests/ai/preview.test.ts` (A1): names for every id field, `before`/`after` for
  `update_work_item`, the expected key for a create, an unknown id.
- `tests/changes.test.ts` (A1): cycle and module feeds; exactly one of the four
  scope fields.
- `tests/ai/digest-store.test.ts` (A1): `input_seq`, stale flag, upsert.
- `tests/ai/anthropic-tools.test.ts` (A2): one tool per registry entry; `propose_`
  for exactly the mutating ones; names ≤ 64 characters; calling a propose tool's
  `run` writes only an `ai_proposal` row (entity, activity and `latestSeq`
  unchanged); a read tool's `TrackerError` becomes a `ToolError`.
- `tests/ai/assistant-events.test.ts` (A2): scripted streams produce the event
  sequence; refusal; max_tokens with a tool_use → `continue: true`; pause_turn
  resumes; abort ends with `aborted`.
- `tests/ai/view-from-prompt.test.ts`, `tests/ai/digest.test.ts`,
  `tests/ai/prompts.test.ts` (A2): the scope block lists proposals with their
  statuses; the frozen prompt has no date.

### 5. Routes and data loading

| Route | File (lane) | Behaviour |
|---|---|---|
| `POST /api/ai/assist` | `src/app/api/ai/assist/route.ts` (U1) | `guardAiRequest`; body `AssistRequestSchema`; `getDb()`; returns `new Response(ReadableStream)` with `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`. Each `AssistantEvent` is `encodeSse(event)` (`event: <type>\ndata: <json>\n\n`). `request.signal` is passed to `runAssistant`. 400 on schema failure. |
| `GET /api/ai/status` | `.../status/route.ts` (U1) | `guardAiRequest` (GET allows `Sec-Fetch-Site: none`); `getAiStatus()` → `AiStatus` JSON |
| `POST /api/ai/digest` | `.../digest/route.ts` (U1) | body `{ kind, id }` → `generateDigest` → `DigestView` JSON; `RULE` → 422 `{ code, message }`; `toAiError` → 502 / 429 / 401 `{ kind, message }` |
| `POST /api/ai/view` | `.../view/route.ts` (U1) | body `{ project_id, prompt (1–2000 characters), conversation_id }` → `viewFromPrompt` → `ProposalView` JSON |
| `GET /api/ai/proposals?conversation_id=` | `.../proposals/route.ts` (U1) | `listProposals` → `ProposalView[]`. The panel re-syncs statuses after a reload. A GET route, not a Server Action (field guide: client reads use GET routes). |
| Server Actions | `src/app/actions/ai.ts` (U1, `"use server"`) | `applyProposalsAction({ ids, confirmed_ids })` → `applyProposals(getDb(), …)` then `refresh()` when anything applied; `discardProposalsAction({ ids })`. Neither throws to the client; both return `ActionResult<ApplyOutcome[] / ProposalView[]>` in the `_run.ts` shape. |

- `src/lib/http-guard.ts` (U1):
  `guardAiRequest(request: Request, { method }): Response | null`. It reuses
  `isSameOriginRequest` and `isJsonContentType` from
  `src/app/api/request-guards.ts` (imported, not edited). It adds
  `isLoopbackHost(host)`, which accepts `127.0.0.1`, `localhost` and `[::1]`, each
  with an optional port. Refusals: 403 `{ code: "FORBIDDEN" }` for the host or
  origin, 415 for the content type.
- Cache Components: the AI routes are dynamic route handlers (POST, or a GET that
  reads the request), so there is no `io()` there. Reads that render in pages
  follow decision 12: the cycle and module detail pages
  (`src/app/(tessera)/projects/[projectId]/{cycles/[cycleId],modules/[moduleId]}/page.tsx`, U3) add
  `getStoredDigest` and `currentDigestSeq` inside their existing
  `<Suspense>` → `await io()` → `readTessera` child. They pass
  `digest: DigestView | null` to the screen. No new `<Suspense>` boundary is needed.
- The assistant panel reads nothing on the server. `AiStatusProvider` fetches
  `/api/ai/status` once on mount (client) and again when the panel opens after a
  failure. The shell layout stays free of network calls.
- **Recents:** P5 adds no page route. `resolveRoute` and `recents.ts` stay
  unchanged; `/api/*` paths are never recorded. The panel is shell state, not a
  path. Its open state and width are a per-viewer convenience in `localStorage`
  key `tessera.assistant-panel.v1` (`{ open: boolean, width: number }`). Icons:
  `AssistantIcon` (TopBar button, panel header, Power K Ask items), `SparkleIcon`
  (already exported) on the Digest card and "Describe a view".

### 6. Screens and components

All Astryx props below were checked in the 0.6.8 `.d.ts` files. Dialog and
AlertDialog come from `@/components/shell/dialogs` (lint-enforced). Icons come from
`src/themes/catppuccin/icons.tsx`. There is no raw div or span, and layout uses
className + tokens in `src/components/styles/ai-panel.css` (U2) or
`ai-surfaces.css` (U3).

**U2: assistant panel (`src/components/ai/`)**
- `AssistantProvider.tsx` (`"use client"`), mounted in `TesseraShell`, provides
  `useAssistant(): { status: AiStatus | null; isOpen; open(); close(); toggle(); ask(text: string): void;
  conversation; newConversation() }`. `ask` opens the panel and sends with the scope
  of the route on screen. U3 uses `ask` from Power K.
- `assistant-scope.ts` (no directive, pure):
  `scopeFromLocation(pathname, searchParams): AssistantScope`. It uses
  `projectIdFromPath` from `recents.ts` (field guide: never write a project-id
  regex) and the P4 peek param (`peek-url.ts`). It fills `work_item_id` from
  `/work-items/[id]`, `/projects/…/work-items/[id]` or `?peek=`, and also
  `cycle_id` and `module_id`.
- `assistant-store.ts` (pure): transcript reducer, `sessionStorage` read and write
  (key `tessera.assistant.v1`, at most 50 messages), each wrapped in try/catch.
- `sse-parse.ts` (pure): `createSseParser(onEvent)` for `text/event-stream` chunks
  (handles split lines and multi-line `data:`), validated with `AssistantEventSchema`.
- `use-assistant-stream.ts`: `fetch("/api/ai/assist", { method: "POST", signal })`,
  `response.body.getReader()`, `TextDecoder`, then the parser and the reducer. Stop
  aborts the AbortController.
- `AssistantPanel.tsx` is the shell `Layout` `end` slot: `LayoutPanel` with
  `hasDivider`, `width` from the stored state (default 400) and `resizable`
  (320–640, **refresh before build**: the `ResizableProps` shape, the same check
  PLAN §5 has for the peek). Inside:
  - `PanelHeader` (label "Assistant", the scope as a quiet subtitle such as
    "WEB · WEB-12", actions "New conversation" and Close; `size="sm"` buttons).
  - `ChatLayout` with `composer` and `emptyState`.
    - The composer is `ChatComposer` with `onSubmit`, `onStop`, `isStopShown`
      while streaming, `isDisabled` when unavailable, the placeholder "Ask about
      this project…" or "Ask about Tessera…", and `status`
      (`{ type: "error", message }` on an error event, or the Toast for
      auth/rate_limit per ai.md).
    - The empty state is an `EmptyState` with the title "Ask the assistant" and
      three suggestion `Button`s from the scope.
  - `ChatMessageList` (`isStreaming`, `align="bottom"`) holds:
    - one `ChatMessage` per turn: `sender` user or assistant, with
      `ChatMessageBubble` around `Markdown` (`isStreaming` on the last turn,
      `density="compact"`);
    - `ChatToolCalls` per assistant turn (`calls: ChatToolCallItem[]`, `name` = the
      tool's title, `status` pending → running → complete or error, `errorMessage`
      from the tool result; `label` "Looked at N things");
    - `ChatSystemMessage` for notices (fallback model, refusal, "Stopped").
  - `ProposalList` after the turn that made them.
  - When `max_tokens` arrives with `continue: true`, a "Continue" button sends
    "Continue."
- `ProposalList.tsx`: header "N proposals", with `Button` "Apply all" (pending
  ones) and "Discard all". Then `ProposalRow` per proposal:
  - the title, the `fields` as a `MetadataList` (label, before → after), and
    `preview.note` as secondary text;
  - status chips: Applied with `CheckIcon`, Failed with the error message,
    Discarded, Expired;
  - buttons Apply and Discard (`size="sm"`).

  Clicking Apply on a destructive proposal (or Apply all when any is
  destructive) opens `ConfirmApplyDialog`.
- `ConfirmApplyDialog.tsx`: `AlertDialog` (`isOpen`, `onOpenChange`,
  `title` "Apply N changes?", `description` listing the destructive titles,
  `actionLabel` "Apply", `actionVariant` destructive (**refresh before build**: the
  `ButtonVariant` value), `isActionLoading`, `onAction`). It calls
  `applyProposalsAction` with `confirmed_ids`. Results update the rows; a failure
  shows a Toast.
- `ai-status.ts` and `AiStatusProvider`: no entry point renders while
  `status?.available !== true`. When the panel is open and the status says
  unavailable, a `Banner` (`status` warning,
  **refresh before build**: the `BannerStatus` key) explains `ant auth login` or
  `ANTHROPIC_API_KEY` in `.env.local`.
- Shell edits (U2): `TesseraShell.tsx` wraps its children in `AssistantProvider`
  and passes `end={<AssistantPanel/>}` to the existing `Layout`. `TopBar.tsx` adds
  an icon `Button` "Assistant" (`AssistantIcon`, `mod+j` in its tooltip) before
  help. `shortcuts.ts` and `useShortcuts.ts` add `assistant.toggle` on `mod+j`
  (free today) to the shortcut list group "General".
- Narrow screens (< 768 px): the panel covers the content panel at full width
  (CSS in `ai-panel.css`). Acceptance checks it at 375.

**U3: Power K Ask, view from prompt, digests**
- `CommandBarAsk.tsx` and `ask-items.ts` (pure). In Ask mode the palette's search
  source returns the items:
  - "Ask: <query>" (when the input is not empty);
  - up to three contextual suggestions when it is empty: "Summarise this cycle" on
    a cycle, "What changed this week?" in a project, "What should I work on next?"
    elsewhere.

  Selecting an item closes the palette and calls `useAssistant().ask(text)`
  (decision 38). The Ask mode switch is hidden while the status is unavailable.
  `CommandBar.tsx` replaces `ASK_PLACEHOLDER` and the empty `ask` branches with
  these items. **Refresh before build:** CommandBar.tsx's line count after P4. If
  the change would take it over 600, lane 0 first moves `PaletteInput` and
  `PaletteFooter` into `src/components/shell/palette-parts.tsx`.
- `command-source.ts` adds a project command "Describe a view…" (`MagicIcon`)
  that opens the views list with `?describe=1`.
- `ViewFromPromptDialog.tsx`: `Dialog` with a `TextArea` (`label` "Describe the
  view", `rows` 4, `value`, `onChange`, `isRequired`) and Generate (POST
  `/api/ai/view`, with a `Spinner` while it waits). The result is the returned
  proposal in a `ProposalRow` (imported from U2), whose Apply creates the view as
  Assistant and navigates to it. Errors show in the TextArea's `status`. It opens
  from a "Describe a view" button in the `ViewsScreen` header (P4 file, one
  button and the `?describe=1` handling, then `router.replace` as for `?create=1`).
  It is hidden when views are off or the status is unavailable.
- `DigestCard.tsx`: a `Card` on `CycleDetailScreen` and `ModuleDetailScreen` (one
  prop `digest: DigestView | null` and one placement each, below the progress
  summary). It holds:
  - the title "Digest" with `SparkleIcon` and `Timestamp` / `RelativeTime` of
    `created_at`;
  - the `Markdown` body (`density="compact"`);
  - an "Out of date" `Token` when `is_stale`;
  - the button "Summarise" (empty) or "Refresh" (stale), which POSTs to
    `/api/ai/digest`. While it waits, a `Skeleton`; the new `DigestView` then
    replaces the local state, with no `refresh()`.

  The card is hidden when the status is unavailable and no digest is stored.
  `work:WEB-12` style keys in the body link through the `Markdown`
  `onLinkClick` to `/browse/<key>`.

### 7. Lane split for swarm workers

Order: **lane 0** alone, gated and committed on its own (docs/process/swarm.md
"File budget"). Then **A1, A2, U1, U2, U3** start together in the shared checkout.
A1 and A2 land their public signatures first (step A0: the exported names with
`throw new Error("P5 A0")` bodies, compiled). UI lanes do their steps marked
**[needs A]** last. U3 imports `ProposalRow`, `useAssistant` and `AiStatus` from
U2; U2 lands those signatures first (step U2.0). Any stub starts with
`// STUB(P5): replaced by lane <X>`, and `grep -rn "STUB(P5)" src` must be empty at
the gate.

| Lane | Creates | Edits (only these) | Must not touch |
|---|---|---|---|
| 0 splits and prep | `src/lib/tessera/db/schema/{columns,core,pages,collaboration,planning,workspace,hardening,index}.ts`; `src/components/styles/{ai-panel,ai-surfaces}.css` (header comment only); `src/components/shell/palette-parts.tsx` (only if needed, see U3) | deletes `src/lib/tessera/db/schema.ts`; `drizzle.config.ts`; `scripts/check-conventions.ts` (drizzle-zod path, and the new rule `ai-boundary`: `@anthropic-ai/sdk` is imported only by `src/lib/tessera/ai/**` and `src/lib/tessera/tools/anthropic.ts`; `src/components/**` and `"use client"` files never import `@/lib/tessera/ai`); `scripts/file-budget.json`; `src/lib/tessera/{schemas,types}.ts` (the client-safe AI shapes: `AssistantScopeSchema`, `AssistMessageSchema`, `AssistRequestSchema`, `AssistantEventSchema` + `AssistantEvent`, `ProposalStatusSchema`, `ProposalSourceSchema`, `ProposalPreviewSchema`, `ProposalView`, `ApplyOutcome`, `DigestKindSchema`, `DigestView`, `AiStatus`); `src/themes/catppuccin/icons.tsx` (`AssistantIcon = duotoneIcon(ChatCircleDots)`, `ProposalIcon = duotoneIcon(ListChecks)`, `StopIcon = duotoneIcon(Stop)`, `RetryIcon = duotoneIcon(ArrowClockwise)`, `MagicIcon = duotoneIcon(MagicWand)`; all five exist in `@phosphor-icons/react/dist/csr/`); `src/app/globals.css` (two imports); path mentions in `docs/contracts/*.md` | any behaviour; every test assertion |
| A1 engine data | `src/lib/tessera/db/schema/ai.ts`; `drizzle/0002_*.sql` + `drizzle/meta/*` (generated); `src/lib/tessera/ai/{proposals,preview,digest-store}.ts`; `tests/ai/{proposals,preview,digest-store}.test.ts` | `src/lib/tessera/db/schema/index.ts`; `src/lib/tessera/changes.ts`; the registry file holding `list_activity` (description); `src/lib/tessera/server.ts`; `tests/changes.test.ts`, `tests/registry.test.ts` (sync-run assertion); `docs/contracts/{schema,service-api,tools}.md`; `docs/PLAN.md` (decisions 33–39, §8 updates, §9 P5 row and deferrals, §10 note that lane A holds the AI engine in P5, §13 deviations); `docs/contracts/OWNERS.md` | `src/app/**`, `src/components/**`, `ai/{client,prompts,assistant,…}` |
| A2 engine AI | `src/lib/tessera/ai/{client,prompts,assistant,event-queue,view-from-prompt,digest,index}.ts`; `src/lib/tessera/tools/anthropic.ts`; `tests/ai/{anthropic-tools,assistant-events,view-from-prompt,digest,prompts}.test.ts`; `tests/ai/fake-anthropic.ts` | `docs/contracts/ai.md` (decisions 35–38: request shape, prompt change, Ask handoff, routes) | A1's files, `src/app/**`, `src/components/**` |
| U1 AI routes | `src/lib/http-guard.ts`; `src/app/api/ai/{assist,status,digest,view,proposals}/route.ts`; `src/app/api/ai/sse.ts`; `src/app/actions/ai.ts`; `tests/ui/{http-guard,sse-encode}.test.ts` | none | `src/app/api/request-guards.ts` (import only), `src/lib/tessera/**`, `src/components/**` |
| U2 assistant panel | `src/components/ai/{AssistantProvider,AssistantPanel,AssistantTranscript,ProposalList,ProposalRow,ConfirmApplyDialog,AiStatusProvider}.tsx`; `src/components/ai/{use-assistant-stream,sse-parse,assistant-scope,assistant-store,ai-status}.ts`; `tests/ui/{sse-parse,assistant-scope,assistant-store}.test.ts` | `src/components/shell/{TesseraShell,TopBar}.tsx`; `src/components/shell/{shortcuts,useShortcuts}.ts`; `src/components/styles/ai-panel.css`; `tests/ui/shortcuts.test.ts` | `CommandBar.tsx`, `command-source.ts`, `src/lib/tessera/**`, `src/app/**` |
| U3 Ask, views, digests | `src/components/ai/{CommandBarAsk,ViewFromPromptDialog,DigestCard}.tsx`; `src/components/ai/ask-items.ts`; `tests/ui/ask-items.test.ts` | `src/components/shell/{CommandBar.tsx,command-source.ts}`; `src/components/views/ViewsScreen.tsx` (one button and the `?describe=1` handling); `src/components/planning/{CycleDetailScreen,ModuleDetailScreen}.tsx` (one prop, one placement); `src/app/(tessera)/projects/[projectId]/{cycles/[cycleId],modules/[moduleId]}/page.tsx` (the digest reads); `src/components/styles/ai-surfaces.css`; `tests/ui/command-source.test.ts` | U2's files (import only), `src/lib/tessera/**`, `src/app/api/**` |

Who decides what: proposal rules, preview text and activity feeds belong to A1;
prompts, the request shape and the event sequence to A2; HTTP status codes, the
guard and SSE framing to U1; panel behaviour, scope inference and transcript
storage to U2; Ask items, the view-from-prompt flow and the digest card to U3.

No P5 file is on the file budget after lane 0. **Refresh before build**: re-read
`scripts/file-budget.json` after P4 (expected: only `cycles.ts` and `modules.ts`,
which P5 does not edit) and the line counts of `CommandBar.tsx`, `TesseraShell.tsx`
and `ViewsScreen.tsx`.

### 8. New dependencies

None. `@anthropic-ai/sdk` 0.133.0 (MIT) is installed and pinned, and P5 imports
only the helpers it ships (`helpers/beta/zod`, `helpers/zod`,
`lib/tools/ToolError`). SSE framing and parsing are about 40 lines each (U1, U2),
so no SSE library is added. `crypto.randomUUID` is a browser built-in. The licence
gate (`scripts/check-licenses.ts`) therefore sees no change.

### 9. Acceptance (on a fresh `data/p5-acceptance.db` after `next build`)

Setup: stop the dev server and move any old `data/p5-acceptance.db*` to the
scratchpad. Run `npm run build`, then
`TESSERA_DB_PATH=data/p5-acceptance.db TESSERA_AI_EFFORT=low node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000`
(fresh DB, migrated on first open). A credential must resolve (`ant auth status`).
Seed through MCP:
`TESSERA_DB_PATH=data/p5-acceptance.db npx tsx scripts/mcp-call.ts …`: project
`WEB`, work items WEB-1…WEB-4, label "Bug", a current cycle holding WEB-1…WEB-3, and
a module holding WEB-2 and WEB-4. Never touch `data/tessera.db`.

1. `npm run check` is green. `npx drizzle-kit generate` reports no schema
   changes. `grep -rn "STUB(P5)" src` is empty.
2. `grep -rl "ANTHROPIC\|sk-ant\|x-api-key" .next/static` prints nothing.
3. `curl -s localhost:3000/api/ai/status` and the same request on
   `127.0.0.1` → `{"available":true,"model":"claude-opus-5-5"}`. With
   `-H "Host: evil.example"` → 403. A POST to `/api/ai/assist` with
   `Sec-Fetch-Site: cross-site` → 403; with `Content-Type: text/plain` → 415.
4. Open `/projects/<WEB>/work-items` and press `mod+j`: the panel opens with the
   header "Assistant · WEB" and three suggestions. The console shows only the
   tolerated warnings.
5. Ask "Set WEB-1 to high priority and add the Bug label". The answer streams, the
   tool calls row shows the reads, and two proposals appear with before → after
   fields. Through MCP, `get_work_item` for WEB-1 shows priority unchanged, and
   `list_activity` has no Assistant row.
6. Reload the tab: the conversation and both pending proposals come back (statuses
   from `/api/ai/proposals`).
7. Click Apply on the first proposal. It shows Applied, and the list row of WEB-1
   shows High without a manual reload. `list_activity` shows the change by
   Assistant. Click Apply on the same row again (double click): no second activity
   row.
8. Click Apply all on the rest: the label is added. Ask "What did you change?": the
   answer names both changes (decision 35).
9. Ask "Delete WEB-4". The proposal is marked destructive, and Apply opens the
   confirm dialog. Cancel → WEB-4 still exists. Apply again and confirm → WEB-4 is
   deleted and gone from the list.
10. Ask for a change, then Discard it: it shows Discarded, and a follow-up "Apply it
    anyway" yields a new proposal, not a write.
11. Stale proposal: ask to rewrite WEB-2's description. Before applying, edit
    WEB-2's description by hand. Apply → Failed with the conflict message; the
    description keeps the hand edit.
12. Ask a long question and click Stop mid-stream. The stream ends with "Stopped",
    and the composer accepts the next question.
13. Open the WEB-1 peek and open the panel: the header shows "WEB · WEB-1", and
    "What is this item about?" answers about WEB-1.
14. `mod+k`, switch to Ask, type "What is in progress?" and press Enter. The
    palette closes, the panel opens and the answer cites keys. With an empty input,
    Ask mode shows the contextual suggestions.
15. On the views list, click "Describe a view" and enter "Open high-priority items
    assigned to me as a board". Generate shows one proposal with a name, rationale
    and filters. Apply creates the view (activity by Assistant) and opens it in the
    board layout with those filters. `n v` still opens the normal New view dialog.
16. On the cycle detail, click Summarise on the Digest card. A digest citing WEB
    keys appears. Reload: the same text shows, and the network panel has no
    `/api/ai/digest` request. Move WEB-3 to another state: the card shows
    "Out of date", and Refresh regenerates it. Repeat once on the module detail.
17. Restart the server with `ANTHROPIC_API_KEY=invalid` (and no profile fallback)
    and reload. Status shows `available:false, reason:"no_credential"`. The TopBar
    button, the Ask mode switch, "Describe a view" and the empty Digest card are
    hidden, and a stored digest still renders.
18. Visual: the panel in Frappé and Latte at 1440 and 375 wide (at 375 it covers
    the content). Dialogs: wait 2–3 s before screenshots. Console clean on every
    screen visited.
19. External write: with the panel open, change WEB-1's state through MCP. The open
    list refreshes within 5 s (ChangesPoller), and the panel's transcript is kept.

### 10. Risks

| Risk | Mitigation |
|---|---|
| The model acts on instructions planted in work item text (prompt injection) | Decision U2/33: nothing writes without Apply. Destructive confirm. The preview shows resolved names, so the person sees what will change. The system prompt says tool results are data. |
| Cost: the `all` toolset is about 91 schemas per request | The cached prefix (decision 36: stable tool order, frozen prompt with `cache_control`). Digests only on click and stored (decision 37). `usage` logged with cache reads. Acceptance at effort `low`. |
| The beta tool runner changes shape in an SDK bump | The SDK stays pinned at 0.133.0. Every name is in "SDK verification". `tests/ai/assistant-events.test.ts` pins the event contract against a fake. |
| The structured-output schema is rejected (filters constraints) | The A2 Vitest on `zodOutputFormat(ViewSpecSchema)`, a flattened fallback schema, and acceptance step 15 with a real call. |
| SSE is buffered by Next or compression, so nothing streams until the end | `no-transform` and `X-Accel-Buffering: no` headers, a `ReadableStream` that enqueues per event. Acceptance step 5 watches the stream build up. **Refresh before build**: check how Next 16.4 handles a streamed route `Response` in `node_modules/next/dist/docs` (route handlers, streaming). |
| Apply is not atomic with the tool's writes, or an async tool breaks the transaction | Nested `withTx` joins the open transaction (`core/tx.ts`). A1's registry assertion that mutating tools run synchronously. The claim pattern against double clicks. |
| Splitting `db/schema.ts` changes the drizzle snapshot | Lane 0's gate is `drizzle-kit generate` with "No schema changes". `0000`/`0001` stay untouched. |
| The key leaks to the browser | The `ai-boundary` convention rule, the component boundary, routes that run only on the server, and acceptance step 2. |
| Refusals or the fallback model answer differently | `fallbacks: "default"` on beta calls with a visible notice. A refusal shows the explanation. View from prompt reports `RULE view_not_generated`. |
| A long model call blocks board moves | Decision 39: model calls are route handlers, not Server Actions. |
| History editing / preserved thinking rules on Opus 5.5 | Only text turns are replayed, with no thinking blocks (decision 35), so there is nothing to invalidate. The cost is that the model re-reads data in later turns. |
| The panel state is lost when Next hides routes (`<Activity>`) | The panel lives in the shell, outside route segments. The transcript is also in `sessionStorage`. |

### 11. Open questions for the user (each with the default the plan uses)

1. **Acceptance spends real API money** (roughly 20–30 assistant turns and three
   digests at effort `low`, an estimated $1–3 on the active credential). Default:
   yes, with the `ant auth login` profile.
2. **Refusal fallback**: when a safety check declines a request, the API may rerun
   it on another model (`fallbacks: "default"`). Default: on for the assistant and
   digests, with a visible "Answered by …" notice.
3. **Toolset**: the assistant sees all ~91 tools (more capable, cached) or only the
   ~30 core tools (cheaper, cannot plan cycles or modules). Default: all.
4. **Digests are stored in the database** (shown again without paying, refreshed on
   click) rather than kept in memory per server run. Default: stored.
5. **Proposals expire after 24 hours** if neither applied nor discarded. Default:
   24 h.
6. **Shortcut `mod+j`** opens and closes the assistant panel. Default: `mod+j`.
7. **Power K Ask hands off to the panel** instead of chatting inside the palette.
   Default: hand off.
8. **Effort**: default `high` for all AI calls (`TESSERA_AI_EFFORT`); the model's
   own default would be `medium`. Default: `high`.

### SDK verification (`node_modules/@anthropic-ai/sdk` 0.133.0, 2026-10-17)

| Name | Where |
|---|---|
| `betaZodTool({ name, inputSchema, description, run })`, `run(args, context?: BetaToolRunContext)` with `context.toolUse.id`; zod via `zod/v4` | `helpers/beta/zod.d.ts`, `lib/tools/BetaRunnableTool.d.ts` |
| `client.beta.messages.toolRunner(body & { stream: true }, { signal })` → `BetaToolRunner<true>`; `max_iterations`; `pushMessages`, `setMessagesParams`, `params`, `done()`, `runUntilDone()` | `resources/beta/messages/messages.d.ts:78–84`, `lib/tools/BetaToolRunner.d.ts` |
| `ToolError(content)` → `tool_result` with `is_error: true`; other throws become `Error: <message>` | `lib/tools/ToolError.d.ts` (import path `@anthropic-ai/sdk/lib/tools/ToolError`, exported through `"./lib/*"`) |
| `zodOutputFormat(schema)` + `client.messages.parse(...)` → `parsed_output` | `helpers/zod.d.ts`, `resources/messages/messages.d.ts:52` |
| `output_config.effort: 'low' \| 'medium' \| 'high' \| 'xhigh' \| 'max'`; `thinking.display: 'summarized' \| 'omitted'` | `resources/messages/messages.d.ts:3591, 3949` |
| `fallbacks?: BetaFallbacksParam` (`Array<…> \| 'default'`), beta `server-side-fallback-2026-07-01`; `fallback` content blocks | `resources/beta/messages/messages.d.ts:3919, 6968, 3692`; `resources/beta/beta.d.ts:52` |
| Stop reasons incl. `pause_turn`, `refusal`; `stop_details` | `resources/beta/messages/messages.d.ts:5055` |
| `client.models.retrieve(id)` | `resources/models.d.ts:18` |
| `Anthropic.AuthenticationError`, `RateLimitError`, `NotFoundError`, `APIConnectionError`, `APIUserAbortError` | `core/error.d.ts` |
| `eager_input_streaming` exists on beta tool params but not as a `betaZodTool` option | `resources/beta/messages/messages.d.ts:4899` (left off, decision 36) |

### Astryx verification (0.6.8 `dist/*/*.d.ts`, 2026-10-17)

`ChatLayout { children, composer, emptyState?, scrollButton?, scrollRef?, density? }`;
`ChatMessageList { children, emptyState?, density?, gap?, align?: 'top'|'bottom', isStreaming? }`;
`ChatMessage { sender: 'user'|'assistant'|'system', children, avatar?, name?, metadata?, density? }`;
`ChatMessageBubble { children, variant?: 'filled'|'ghost', name?, metadata?, group?, width? }`;
`ChatComposer { onSubmit(value), onStop?, isStopShown?, value?, onChange?, placeholder?, isDisabled?, density?, status?: { type: 'error'|'warning', message? }, headerContext?, footerActions? }`;
`ChatToolCalls { calls: { name, status?: 'pending'|'running'|'complete'|'error', target?, errorMessage?, resultDetail? }[], label?, defaultIsExpanded? }`;
`ChatSystemMessage { children, variant?: 'default'|'divider', icon? }`;
`Markdown { children: string, density?: 'default'|'compact', isStreaming?, onLinkClick?(href, e) }`;
`Layout { content?, end?, start?, height? }`; `LayoutPanel { hasDivider?, padding?, isScrollable?, label?, width?, resizable?: ResizableProps }`;
`AlertDialog { isOpen, onOpenChange, title, description, cancelLabel?, actionLabel, actionVariant?, isActionLoading?, onAction }`;
`Dialog { isOpen, onOpenChange, width?, maxHeight?, position?, variant? }`;
`TextArea { label, value, onChange?(value, e), rows?, isRequired?, isDisabled?, placeholder?, status? }`;
`EmptyState { title, description?, icon?, actions?, isCompact? }`; `Banner { status, title, description?, isDismissable?, onDismiss? }`;
`MetadataList { children, columns?, orientation? }`; `CommandPalette { isOpen, onOpenChange, searchSource, input?, footer?, emptySearchText?, value?, onValueChange? }`.
**Refresh before build:** `ResizableProps`, `ButtonVariant` (destructive value) and
`BannerStatus` keys; `MetadataList` item component name.
