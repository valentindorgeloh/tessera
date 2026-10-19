# As-built map: the assistant (P5)

State described: git HEAD `07a59d1` (2026-10-18). Files in the working tree that other lanes are editing right now are not covered. Written for a reworking agent: read this first, then open only the contract section named in section 8.

## 1. Purpose and boundaries

The assistant is a side panel (and a Power K "Ask" mode) that answers questions about the tracker with the registry's read tools and turns every write into a stored proposal. Nothing changes until the person clicks Apply; Apply runs the stored input, validated again, as actor `assistant` (decision 33). The same Apply row serves "Describe a view" (view from prompt, decision 38). Digests (cycle, module, inbox, home, analytics) are generated only when the person clicks Summarise or Refresh (decision 37, 60, 81).

In scope: `src/lib/tessera/ai/**`, `src/lib/tessera/tools/anthropic.ts`, `src/app/api/ai/**`, `src/app/actions/ai.ts`, `src/lib/http-guard.ts`, `src/components/ai/**`, the tables `ai_proposal` and `ai_digest` (`db/schema/ai.ts`).

Lives elsewhere:
- Registry tools, `listTools`, `runToolWithContext`: `docs/as-built/engine.md`.
- Where digest cards and the Ask button are mounted: the screens in `pages-collab.md` (inbox), `intake-workspace.md` (home, analytics, intake triage) and `planning.md` (cycle, module).
- Undo of an applied batch: engine in `ai/undo.ts`, tools in `tools/registry/maintenance.ts` (see `operations.md` for the maintenance side).

Not built (see section 7): live acceptance with the real model, `TESSERA_AI_FAKE`, the undo toast button and History view, per-workspace model/effort.

## 2. File map

### 2.1 Engine (`src/lib/tessera/ai/`, kept out of the `index.ts` barrel by decision 34; `server.ts` re-exports `ai/index.ts`)

| Path (lines) | Responsibility | Key exports |
|---|---|---|
| `client.ts` (102) | The one Anthropic client. Key stays in the environment or the `ant auth login` profile; `new Anthropic()` with no arguments. Model `TESSERA_AI_MODEL` or `claude-opus-5-5`; effort `TESSERA_AI_EFFORT` or `high`. `getAiStatus` calls `models.retrieve` and caches 10 min (30 s when offline). | `AI_MODEL`, `AI_BETAS` (`server-side-fallback-2026-07-01`), `AI_FALLBACKS` (`"default"`), `aiEffort`, `getAnthropic`, `setAnthropicForTests`, `assistantContext`, `getAiStatus`, `toAiError` |
| `assistant.ts` (139) | One chat turn as an async generator of `AssistantEvent`. `beta.messages.toolRunner`, `stream: true`, `max_iterations: 12`, adaptive thinking, two system blocks (frozen prompt with `cache_control`, then the volatile scope block). Handles `refusal`, `max_tokens` (`continue: true`), `pause_turn` (resumed at most twice), abort, `fallback` notices. | `runAssistant` |
| `event-queue.ts` (50) | Async queue so stream events and tool events (proposals, tool results) leave in order. | `createEventQueue` |
| `prompts.ts` (180) | Frozen prompts (chat, four digests, view) and `describeScope`, which renders project, open work item (description cut at 2 000 chars), cycle, module and this conversation's proposals into text. Lists cap at 50. | `SYSTEM_PROMPT`, `DIGEST_SYSTEM`, `INBOX_DIGEST_SYSTEM`, `HOME_DIGEST_SYSTEM`, `ANALYTICS_DIGEST_SYSTEM`, `VIEW_SYSTEM`, `describeScope` |
| `proposals.ts` (222) | The proposal store: create (validates the input, builds the preview, inserts), list per conversation, get, apply, discard. A row writes no activity and does not move the cursor. | `createProposal`, `listProposals`, `getProposal`, `applyProposal`, `applyProposals`, `discardProposals`, `CreateProposalInput`, `ApplyProposalsInput`, `PROPOSAL_TTL_MS` (24 h) |
| `preview.ts` (463) | `previewTool(ctx, tool, input)`: ids become names, updates show current beside proposed, an unresolvable id is labelled Unknown. Refuses read tools (`not_mutating`). Enum words are copied from components because the engine cannot import them. | `previewTool` |
| `view-from-prompt.ts` (104) | One non-beta structured call (`messages.parse` with `zodOutputFormat(ViewSpecSchema)`), then a `create_view` proposal with source `view_from_prompt`; the rationale is written onto `preview.note`. | `viewFromPrompt`, `ViewSpecSchema` |
| `digest.ts` (50), `digest-store.ts` (198) | `generateDigest(handles, kind, id)` returns the stored row when `input_seq` is unchanged, else calls the model; `digestInputs` builds the payload per kind (cycle and module add progress; inbox covers the unread notifications and their activity; home and analytics delegate to `workspace/since.ts` and `analytics`). `getStoredDigest` marks `is_stale` when newer activity exists. | `generateDigest`, `digestInputs`, `currentDigestSeq`, `getStoredDigest`, `saveDigest` |
| `undo.ts` (180), `undo-note.ts` (2) | Reverse the latest applied batch (section 4). | `findLatestUndoableBatch`, `undoLastAssistantBatch`, `UNDO_BATCH_TTL_MS`, `ASSISTANT_UNDO_NOTE` |
| `tools/anthropic.ts` (133) | Registry tools as Anthropic tools via `betaZodTool`. A read tool keeps its name and runs as actor `assistant` (results over 50 000 chars are cut and marked `truncated`). A mutating tool is `propose_<name>`, creates a proposal and returns `{proposal_id, status, preview, note}`. Order follows `listTools`, so the cached prefix is stable. | `buildAssistantTools`, `PROPOSE_PREFIX` |

### 2.2 Routes and actions

| Path | Responsibility |
|---|---|
| `api/ai/assist/route.ts` | `POST`: validates `AssistRequestSchema` (`conversation_id`, `scope`, 1–50 text turns of at most 20 000 chars, `toolset` core or all), streams `runAssistant` as SSE; `request.signal` aborts the model call. |
| `api/ai/sse.ts` | `encodeSse`, `sseStream` (one frame per event, `event: <type>\ndata: <json>`), `SSE_HEADERS`. Pure. |
| `api/ai/status/route.ts` | `GET`: `AiStatus` (`{available: true, model}` or `{available: false, reason: no_credential \| model_unavailable \| offline}`). Never an error status. |
| `api/ai/proposals/route.ts` | `GET ?conversation_id=<uuid>`: the conversation's proposals, so a reloaded panel re-syncs statuses. |
| `api/ai/digest/route.ts`, `api/ai/view/route.ts` | `POST {kind,id}` and `POST {project_id,prompt,conversation_id}`; tracker errors map to HTTP statuses (RULE 422), model failures to 401 / 429 / 502. |
| `lib/http-guard.ts` | `guardAiRequest`: loopback `Host` only, same-origin browser request (a GET also accepts `Sec-Fetch-Site: none`), POST must be `application/json`. Every `/api/ai/*` route calls it first (403 / 415). Reuses `app/api/request-guards.ts`. |
| `actions/ai.ts` | `applyProposalsAction({ids, confirmed_ids})` and `discardProposalsAction({ids})`: Server Actions, not routes (decision 39). `refresh()` runs only when at least one proposal applied. |

### 2.3 UI (`src/components/ai/`, client)

| Path | Responsibility |
|---|---|
| `AiStatusProvider.tsx`, `ai-status.ts` | Fetches `/api/ai/status` once; a failed fetch counts as offline. Every entry point stays hidden unless `available`. |
| `AssistantProvider.tsx` (393) | State and actions: ask, stop, continue, apply, discard. Transcript in `sessionStorage`, panel width and open flag in `localStorage`. A destructive apply waits for `ConfirmApplyDialog`. Toast "Applied N changes" (no Undo button yet). |
| `AssistantPanel.tsx`, `AssistantTranscript.tsx`, `ProposalList.tsx`, `ProposalRow.tsx`, `ConfirmApplyDialog.tsx` | The panel (shell end slot, width 320–640, covers the content under 768 px), the turns, the proposals of a turn with Apply all / Discard all, one row, the confirm dialog. |
| `assistant-store.ts` (378) | Pure transcript reducer and storage (at most 50 turns); `toAssistMessages` replays text turns only (decision 35). |
| `assistant-scope.ts`, `ask-items.ts`, `CommandBarAsk.tsx` | Scope from the pathname via `projectIdFromPath`; Power K Ask items; the palette never chats, it hands the text to the panel (decision 38). |
| `sse-parse.ts`, `use-assistant-stream.ts` | Client side of the SSE stream (`streamAssist`). |
| `DigestCard.tsx`, `ViewFromPromptDialog.tsx` | Stored digest with Summarise / Refresh; the Describe-a-view dialog posts to `/api/ai/view` and applies through `applyProposalsAction`. |

## 3. Data and control flow

Chat: Power K Ask or the panel composer -> `streamAssist` POSTs `/api/ai/assist` with the text history and the scope -> guard -> `runAssistant`: `listProposals` for the conversation, `describeScope`, `buildAssistantTools`, tool runner. A read tool runs through `runToolWithContext` as `assistant`. A `propose_*` call runs `createProposal` (validate with the tool's schema, `previewTool`, insert `pending`) and emits a `proposal` event -> the panel paints the proposal -> Apply -> `applyProposalsAction` -> `applyProposals` generates one `batch_id` and calls `applyProposal` per id (continues past failures).

`applyProposal`: loads the row (`already_decided` CONFLICT unless `pending`), `proposal_expired` RULE after 24 h, `needs_confirmation` RULE for a destructive row not in `confirmed_ids`; inside one transaction it claims the row (`pending -> applying`, so a double click applies once), re-validates the stored input, runs `def.run` as `assistant`, and stores `result`, `seq_from`, `seq_to`, `apply_batch_id` and `applied`. A throw records `failed` with the error code. The tool's own writes and the status change commit together.

Digest: card button -> `POST /api/ai/digest` -> `generateDigest`; an unchanged `input_seq` returns the stored row with no model call. The page reads a stored row with `getStoredDigest` and never calls the model on load.

Errors: the SSE stream carries a failure after it started as an `error` event (`auth`, `rate_limit`, `unavailable`); `toAiError` logs everything except auth and rate limit and shows "Assistant unavailable".

## 4. Invariants and rules the code enforces

| Rule | Decision | Enforcer |
|---|---|---|
| Every assistant write is an `ai_proposal` first; status `pending -> applying -> applied \| failed`, or `pending -> discarded`; Apply claims the row | 33 | `proposals.applyProposal`; `tests/ai/proposals.test.ts` |
| Proposal and digest rows are bookkeeping: no activity, no cursor move, not registry tools, outside the barrel | 34 | `ai/index.ts` (not in `tessera/index.ts`); no `tools/registry` entry |
| The client owns the transcript (text turns); the server adds the conversation's proposals to the scope block, never replays tool calls | 35 | `assistant-store.toAssistMessages`; `assistant.ts` |
| `toolRunner` with `stream: true`, `max_iterations: 12`; mutating tools are `propose_<name>`; frozen system prompt plus volatile scope block | 36 | `assistant.ts`, `tools/anthropic.ts`; `tests/ai/anthropic-tools.test.ts`, `prompts.test.ts` |
| Digests only on click; one row per `(kind, entity_id)`; `input_seq` = highest activity seq summarised | 37 | `digest.generateDigest`, `digest-store.saveDigest`; `tests/ai/digest.test.ts`, `digest-store.test.ts` |
| One conversation surface: Ask hands off to the panel; view from prompt makes a `create_view` proposal | 38 | `CommandBarAsk`, `view-from-prompt.ts`; `tests/ai/view-from-prompt.test.ts` |
| Anything that calls the model is a route under `/api/ai/`; Apply and Discard are Server Actions | 39 | `app/api/ai/**`, `actions/ai.ts` |
| Notifications never go to the user for assistant writes (the user clicked Apply) | 50 | `notifications.ts` recipient filter (see `pages-collab.md`) |
| Inbox digest is `ai_digest` kind `inbox` keyed by the recipient actor id | 60 | `digest-store.inboxInputs` |
| Analytics narrative is kind `analytics`, entity id `<tab>:<projects>:<range>` | 81 | `digest-store.digestInputs` -> `analyticsForDigest` |
| Undo takes the latest applied batch (shared `apply_batch_id`) of any conversation, not undone, less than 24 h old; one batch at a time | 116 | `undo.findLatestUndoableBatch`; `tests/ai/assistant-undo.test.ts` |
| Undo refuses (CONFLICT `undo_blocked`) when later activity touched the same entity and field, or when the batch holds a verb it cannot invert; inverse rows carry the note "Undid assistant change" | 117 | `undo.blockedByLater`, `invertRow`, `ASSISTANT_UNDO_NOTE` |
| AI routes answer loopback hosts only, same-origin, JSON POST | 123 (security gate, p5 plan) | `guardAiRequest`; `tests/ui/http-guard.test.ts` |
| No key, `ANTHROPIC` text or `server-only` marker in the client bundle | 125 | `scripts/check-bundle.ts`, `bundle-rules.ts`; `tests/check-bundle.test.ts` |
| A mutating assistant tool call fails at Apply, not at proposal time, for `userOnly` tools and for agent-access rules | 104, 63 | `tools/registry/access.assertToolAllowed` (the proposal itself is not checked) |

## 5. Tests that guard this area

| File | Covers |
|---|---|
| `tests/ai/fake-anthropic.ts` | Scripted Anthropic client injected with `setAnthropicForTests`; no network |
| `tests/ai/anthropic-tools.test.ts`, `proposals.test.ts`, `prompts.test.ts` | Tool names and truncation; create / apply / discard / expiry / double apply / destructive confirm; frozen prompt and scope block |
| `tests/ai/assistant-events.test.ts` | Event order, refusal, `max_tokens`, `pause_turn`, abort, fallback notice |
| `tests/ai/digest.test.ts`, `digest-store.test.ts`, `view-from-prompt.test.ts` | Digest reuse and refusal, stale flag per kind, structured view output |
| `tests/ai/assistant-undo.test.ts` | Batch undo and the conflict case |
| `tests/ui/assistant-store.test.ts`, `assistant-scope.test.ts`, `ask-items.test.ts`, `sse-encode.test.ts`, `sse-parse.test.ts`, `http-guard.test.ts` | Transcript reducer, scope from path, Ask items, SSE framing both ways, the request guard |

Untested: the panel and provider components, the three digest cards, the routes themselves (only their pure helpers), and any call to the real model.

## 6. Extension points

- A new digest kind: add to `DigestKindSchema` (`schemas.ts`), a branch in `digestInputs` / `currentDigestSeq` (`digest-store.ts`), a system prompt in `prompts.ts`, and mount `DigestCard` with the new kind. Entity id formats are free text.
- A new assistant-visible tool: nothing to do, `buildAssistantTools` lists the registry; set `core: true` to put it in the default set (37 tools are core).
- A new undoable verb: add an inverse in `undo.invertRow` and extend the `UPDATE_FIELDS` list; keep the `blockedByLater` check.
- Workspace-level model and effort: `workspace_settings.ai` is stored and edited on the General settings screen, but `client.ts` reads only the environment (decision 84 says settings first).
- A different transport for chat: `runAssistant(handles, request, signal)` is transport-free; `sseStream` is the only SSE code.

## 7. Known debt and quirks

- P5 live acceptance with the real model never ran. It needs the user's approval (about $1–3 of API use per run).
- `TESSERA_AI_FAKE` (decision 124) is described in PLAN and the p11 plan, but no source file reads it; Playwright cannot run an AI scenario yet.
- Decision 118 surfaces are missing: the "Applied N changes" toast has no Undo button and the assistant panel has no History view. `undoLastAssistantBatchAction` and `getUndoableAssistantBatchAction` exist but no component calls them.
- Decision 117 asks for an `UNDO_INVERSES` entry per mutating tool; the code inverts only work-item field updates (`name`, `state_id`, `priority`, `parent_id`, `cycle_id`, `estimate_point_id`, `start_date`, `target_date`) and archives, and refuses the whole batch for anything else.
- `work-items/undo.ts` (`undoLastWorkItemChange`, covered by `tests/undo.test.ts`) is exported but has no registry tool and no UI.
- `workspace_settings.ai.model` / `.effort` are ignored by the client (decision 84). `digest_enabled` is honoured by the Home digest only.
- Proposals are not checked against `userOnly` or agent access when created, only when applied, so the assistant can propose `create_webhook` and then fail at Apply (`user_only`).
- `createProposal` takes no note, so `view-from-prompt.attachRationale` updates the stored preview after the insert (marked ASSUMPTION in the file).
- `ViewSpecSchema` has no `rich_filters`; a prompt-made view is flat filters only.
- `getAiStatus` classifies any unknown error as `offline`.
- `ai.usage` is logged with `console.info` on every turn (input, output, cache read tokens).

## 8. Where to read more

| Topic | File and heading |
|---|---|
| Decisions 33–39, 60, 81, 84, 116–118, 123–125 | `docs/PLAN.md` "Resolved design decisions" |
| Request shape, models, fallbacks, security | `docs/contracts/ai.md` |
| Plan and UI behaviour of P5 | `docs/drafts/p5-plan.md` (sections 5 routes, 6 UI) |
| Tool flags (`core`, `userOnly`, `selfScoped`) | `docs/contracts/tools.md` "ToolDef" |
| Status and live-acceptance gap | `docs/PLAN-STATUS.md` P5 row |
