# As-built map: superagent control, chat and setup guide (decisions 150 to 153 and 155)

State described: branch `claude/unruffled-feynman-d4ed47` after the superagent chat (decision 153), 2026-11-10, migration 0014. The runner itself is a separate program (the plan's Parts A and B); this file covers Tessera's side only: idempotent agent comments, the agent settings, the control client, the `/agents/superagent` screen and "Send to superagent". The full rules are in `docs/contracts/ui.md` ("Superagent control"), `tools.md` and `service-api.md` ("Superagent ..."), and `schema.md` ("Migration 0014").

## 1. Purpose and boundaries

The superagent runner picks up work items you assign to it, plans and builds them in its own sandbox, and reports back on the item. Tessera:
- stores which projects the runner works on and in which repository (`workspace_settings.agents`, decision 151);
- lets the runner write comments safely on retry (`create_comment` with `client_ref`, decision 150);
- tells the runner when Tessera's change log was rewound (`list_changes` returns `latest_seq`);
- shows and steers the runner on `/agents/superagent` through the runner's local control API v1 (decision 152).

The control API is never a tool. No registry tool's name contains `superagent` or `runner`, so neither MCP agents nor the assistant can approve, stop or pay for the runner's work. Only the user's Server Actions call it.

## 2. File map

| Path | Responsibility |
|---|---|
| `drizzle/0014_superagent.sql` | `comment.client_ref` with the unique partial index `comment_client_ref_uq (actor_id, work_item_id, client_ref) WHERE client_ref IS NOT NULL`, and `workspace_settings.agents` (JSON, nullable). |
| `src/lib/tessera/comments.ts` | `ClientRefSchema`, `CreateCommentResult`, `DeletedCommentRef`. With a ref: the stored comment comes back with no side effects, a deleted one as `{ deleted: true }`, a different body as `CONFLICT`. |
| `src/lib/tessera/workspace/settings.ts` | `setAgentSettings` (user only, checked in the service because Apply bypasses `userOnly`), `normalizeAgentSettings`, `agentRepoFor`. Tool `set_agent_settings`; `get_workspace_settings` returns `agents`. |
| `src/lib/tessera/schemas.ts` | `AGENT_RUNNER_DEFAULT_URL` (`http://127.0.0.1:3090`), `AgentRunnerUrlSchema` (loopback, port 1 to 65535), `AgentRepoSchema` (`name` or `owner/name`, at most 140 characters, no `.`/`..` or leading `-` segment, no owner starting with `.`), `AgentProjectSchema`, `AgentSettingsSchema`. |
| `src/lib/superagent/` | The control client. `schemas.ts`: zod mirror of runner API v1. `types.ts`: the only module components may import (eslint). `client.ts`: one method per route, 5 s timeout, failures as states. `token.ts`: reads the token file per call. `server.ts` (`server-only`): `withRunner`, `loadSuperagent`. |
| `src/app/actions/superagent.ts` | Eight Server Actions (pause, request action, resize, budget, triage retry, save settings, save prompts, refresh). Each validates, calls the runner, then `refresh()`. |
| `src/app/(tessera)/agents/superagent/page.tsx`, `src/components/superagent/*` | The screen: banners, Needs you (requests table and triage), Health and spend, History of one request, Routing, Settings (Tessera mapping and runner settings) and Team sections. Polls every 15 s while visible and no dialog is open. |
| `src/components/detail/{DetailHeader,WorkItemDetail}.tsx`, `src/components/detail/use-detail-actions.ts`, `src/components/superagent/send-to-superagent.ts` | "Send to superagent" in the More menu of items in mapped projects: assigns the item to `mcp:superagent` through the detail's optimistic assignee path (`setAssigneesReporting`). |
| `scripts/superagent-stub.ts`, `tests/fixtures/superagent/*.json` | A fake runner for acceptance and tests (`node:http`, in-memory, the v1 auth rules). Not part of the app. |

### Setup guide (decision 155)

| Path | Responsibility |
|---|---|
| `src/app/(tessera)/agents/superagent/setup/page.tsx`, `src/components/superagent/setup/*`, `src/lib/superagent/setup.ts`, `src/components/superagent/{setup-guide,setup-status}.ts` | The setup guide: steps as data (`setup-guide.ts`), status rules (`setup-status.ts`), the server status read (`loadSuperagentSetup`: token file existence and mode, `GET /v1/state`, mapped live projects, the `mcp:superagent` actor), and the screen with the "Where you are" block, 12 sections and the doctor troubleshooting list. Entry points in `SuperagentScreen`, `RunnerBanners` and `ConversationList`. |

### Chat (decision 153)

| Path | Responsibility |
|---|---|
| `src/lib/tessera/agent-conversations.ts` | `listAgentConversations`: items in the given projects that an actor is assigned to or mentioned on (item or live comment), plus extra ids; newest activity first, at most 200. A service read, not a tool. |
| `src/lib/superagent/chat.ts` (`server-only`) | `loadSuperagentChat({ itemKey })`. The runner list and the Tessera read run in parallel; request-only items are merged in, and each item gets its newest request. The entries are the description first, then the comments flattened in time order. `replyToCommentId` is the open question's thread root, found by `client_ref` `question:<requestId>:*` or else by the question text. |
| `src/app/(tessera)/agents/superagent/chat/**`, `src/components/superagent/chat/*`, `chat-format.ts`, `styles/superagent-chat.css` | The screen, in the Inbox frame (list beside the thread, one pane under 1024px) with Astryx `Chat*` components. The composer posts through `createCommentAction`; New chat goes through `createWorkItemAction`. Runner data refreshes every 5 s (`use-runner-refresh.ts`); comments arrive through `ChangesPoller`. |
| `Sidebar.tsx`, `recents.ts`, `SuperagentScreen.tsx`, `send-to-superagent.ts`, `DetailHeader.tsx`, `WorkItemDetail.tsx` | The "Superagent chat" sidebar row, the Recents labels and the control screen's "Chat" button. "Send to superagent" opens the chat after assigning; on an assigned item it reads "Open superagent chat". |

## 3. Operating it

1. **Token.** The runner's `npm run setup` writes its API token to `~/.tessera-agents/api-token` (tessera-agents `src/cli/setup.ts:216`). Tessera reads that file on every call (override: `TESSERA_AGENTS_TOKEN_FILE`) and never stores or shows it. No file shows "Runner not set up", which is not an error. The whole bring-up, for any user, is the setup guide at `/agents/superagent/setup`.
2. **Runner URL and mapping.** On `/agents/superagent` → Settings → "Projects and repositories": the runner URL (blank means `http://127.0.0.1:3090`; loopback only) and one row per project with its repository. Only you can save it (`RULE user_only` for agents and the assistant).
3. **The runner's MCP client** must be named `superagent` and pin protocol revision `2026-07-28`: `/api/mcp` is stateless, and only that revision sends the client name with every request. On the default (legacy) revision its calls land as `mcp:unknown` (`tests/mcp-http-identity.test.ts`). The runner should connect once at startup so the `mcp:superagent` actor exists; until then "Send to superagent" is disabled with "The superagent has not connected to Tessera yet."
4. **Sending work.** "Send to superagent" adds `mcp:superagent` to the item's assignees. The runner treats your assignment (or a mention) as the request.
5. **Failure states.** Every runner call returns a state instead of throwing: not set up, token unreadable, not answering, timed out, token rejected, refused, not found, not accepted, changed elsewhere, unavailable, unexpected answer, runner error. The screen words each one (`failureCopy`). A Tessera database error while reading the runner URL propagates like on any other screen.
6. **Rewind.** After a database restore the runner's cursor can be past Tessera's newest change. `list_changes` then returns `latest_seq < cursor`, the runner stops intake, and the screen shows "Tessera history rewound" until the runner is reset.

Local acceptance run (scratch only, never port 3000 or `data/tessera.db`):

```bash
TESSERA_DB_PATH=data/superagent/acceptance.db npx tsx scripts/db-demo.ts
PORT=3311 TESSERA_DB_PATH=data/superagent/acceptance.db TESSERA_AGENTS_TOKEN_FILE=data/superagent/api-token npm run dev
npx tsx scripts/superagent-stub.ts --port 3391 --token-file data/superagent/api-token [--rewound] [--conflict]
```

## 4. Invariants

- The token never reaches a result, an error message, a log line, a prop or the browser bundle. Messages and codes from the runner are scrubbed of it.
- Runner calls send `Authorization: Bearer`, `x-agents-request: 1`, no `Origin`, use `redirect: "error"`, and time out after 5 s. A path id that is empty, `.` or `..` is refused before any call.
- `set_agent_settings` and `setAgentSettings` refuse every actor but the user. The registry (`runToolWithContext`) and the service check the actor before their own validation; over MCP the SDK checks the input schema first, so a malformed call from an agent gets the SDK's "Input validation error" and a well-formed one `RULE user_only`.
- A repeated `create_comment` with the same `client_ref` and body writes nothing (no activity, notification, mention, subscription or change row).
- `list_changes.cursor` never moves backwards; `latest_seq` is the real newest seq.

## 5. Tests

`tests/comments-client-ref.test.ts`, `tests/workspace/agent-settings.test.ts`, `tests/changes*.test.ts`, `tests/registry.test.ts` (superagent entries), `tests/superagent/*` (client, token, server, actions, fixtures, the stub), `tests/ui/superagent-*.test.ts`, `tests/ui/detail-superagent.test.ts`, `tests/mcp-http-identity.test.ts`. Browser acceptance (steps 1 to 9 in ui.md) ran on 2026-11-10 at 1440 and 375 in Frappé and Latte against the fake runner.

## 6. Known debt and open items

- The runner (tessera-agents) is built; the screens were checked against the fake runner, and the comment identity against the real runner client. An end-to-end run waits for an agent GitHub account.
- Readings of runner API v1 that the runner session must match (ui.md, "Mismatches and assumptions"): `revision` is a string or a number; `intake.cursor` and `intake.latestSeq` may be null (decision 155: the runner sends both as null before its first poll); empty-body POSTs send no body; `workItemId` is Tessera's id; `firstPassReviewRate` is a fraction from 0 to 1; sizes are S, M or L.
- The editor's people picker matches the start of an actor's name, and the superagent's actor is named `mcp:superagent`, so a mention is found by typing `@mcp`, not `@super`.
- `loadProjectBundle` reads the workspace settings once per project bundle (cross-project lists read it per project); cheap, but could be hoisted.
- Playwright is not a runner dependency; the guide shows a workaround for screen changes.
- There is no reset for a rewound intake: the runner stays stopped.
