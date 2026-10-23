## P7: Collaboration (phase plan)

Draft by the phase planner, 2026-10-17, on `main` at `e03e664`. It assumes the P4
contract (docs/drafts/p4-ui.md, p4-service-api.md, p4-tools.md, p4-plan-notes.md),
the P5 plan (docs/drafts/p5-plan.md) and the P6 plan (docs/drafts/p6-plan.md) are
delivered:
- the registry and work items are folders (`tools/registry/<domain>.ts` with
  `TOOLS` in `registry/index.ts`; `work-items/{index,model,hydrate,read,membership,create,update,move,transfer,lifecycle}.ts`);
- `db/schema.ts` is the folder `db/schema/` and `collaboration.ts` holds the P7
  tables that `0000_init` already created; migrations `0002_ai` and `0003_pages`
  exist;
- decisions 29–48 are in docs/PLAN.md;
- P5's `ai_digest` store, `generateDigest`, `POST /api/ai/digest` and `DigestCard`
  exist, and `describeScope` reads work items;
- P6's `pages/body.ts` saves page bodies with CAS and extracts `page_embed` rows.

This is a plan, one level lighter than a contract. A planner refreshes it into the
full P7 contract right before the build. Items marked **refresh before build**
depend on code that P4–P6 have not written yet, or on a line count only their
results can give.

Sources: docs/PLAN.md decision 8 (actors are members), decisions 10, 12, 24 and 26,
§1 rows "Relations", "Comments", "Subscriptions, mentions, notifications inbox",
§2 "Collaboration (P7)" and the invariants (relations; "Notifications are generated
inside the same transaction as the triggering mutation, never for the actor who
caused it"), §4 "Relations, comments, links" and "Workspace" (notifications), §8
digests, §9 P7 row, §12 browser step 8; docs/contracts/{schema,service-api,tools,editor}.md
P7 notes. Astryx props were checked in `node_modules/@astryxdesign/core/dist/*/*.d.ts`
0.6.8 ("Astryx verification" in §6).

What already exists (verified on `e03e664`):
- Tables `work_item_relation`, `comment`, `comment_reaction`, `work_item_reaction`,
  `mention`, `notification` (`db/schema.ts` lines 472–587, created by `0000_init`);
  row types in `types.ts` (`WorkItemRelationRow`, `CommentRow`, `MentionRow`,
  `NotificationRow`, …); `RelationTypeSchema` in `schemas.ts`.
- Subscriptions: `work_item_subscriber`, `subscribe` / `unsubscribe` (`assignees.ts`),
  tools `subscribe_work_item` / `unsubscribe_work_item`; creator and added assignees
  are auto-subscribed (`addSubscribers`, `insertSubscriber` in work-items).
- Links: `links.ts`, tools `add_link` / `update_link` / `remove_link`, the detail's
  `LinksList.tsx`. **P7 adds nothing to links**; the §9 P7 row lists them, but they
  shipped with P1/P2b.
- The `mentions` filter (`filters.ts` `mentionsAny`) reads `mention` rows of
  `entity_type = "work_item"`, but nothing writes them yet.
- The editor's `@` trigger inserts a Mention node that serialises as plain
  `@Name` (`editor/extensions.ts` line 232; editor.md "P7 may upgrade it to
  `[@Name](actor:<id>)`").
- The detail shows `shift+s` with the toast "Subscribed. Notifications arrive in
  P7" (`WorkItemDetail.tsx`), and `nav.inbox` (`g k`) is marked `arrives: "P7"`
  (`shortcuts.ts` line 126).

Exit criteria (PLAN §9 P7) and where they are proven:
- "Notification generated for an MCP state change on a subscribed item": Vitest
  `tests/notifications.test.ts` "MCP state change notifies subscribers" and
  `tests/mcp-notifications.test.ts` (InMemoryTransport); acceptance steps 9–11.
- "Relation shown on both items": Vitest `tests/relations.test.ts` "list from both
  sides"; acceptance steps 4–5.

### 1. Scope and deferrals

In scope:
- **Relations** with inverse display (blocked by / blocking, relates to, duplicate
  of, starts before / after, finishes before / after, implemented by / implements),
  cross-project, one per unordered pair, logged on both items; a Relations section
  in the detail; `WorkItemDetail.relations` for MCP and the assistant.
- **Comments**, threaded one level deep, markdown through the shared
  `MarkdownEditor`; edit (author only, CAS) and delete; agents comment through MCP;
  the detail's activity becomes a timeline that merges comments and activity with
  an All / Comments / Updates filter.
- **Reactions** on work items and on comments (fixed set of eight emoji).
- **Mentions**: `@` in descriptions, comments and page bodies writes
  `[@Name](actor:<id>)` links, extracted into `mention` on save; the `mentions`
  filter then works, and also matches comments.
- **Subscriptions**: auto-subscribe on comment and on mention (in addition to
  create and assign); a visible Subscribe toggle in the detail header.
- **Notifications** derived from activity inside the same transaction, coalesced
  per (recipient, item, actor) burst; inbox at `/inbox` with tabs Inbox, Mentions,
  Snoozed and Archived, an Unread-only toggle, read / unread, archive, snooze; a
  sidebar Inbox item with the unread count; `g k`; notification tools for MCP
  agents, who read their own inbox.
- **Inbox digest**: P5's digest machinery with a new kind `inbox`.
- The assistant sees comments and relations of the scoped item; P7's mutating
  tools get `propose_*` stubs automatically (P5 deferral rows "Assistant creates
  comments and mentions" and "notifications for assistant writes").

Deferrals:

| Item | Phase | Why |
|---|---|---|
| `intake_received` notifications | P8 | Emitted by P8's intake code through `notify` (§4); the kind exists from P7 |
| `automation` notifications (actor `system`) | P10 | Automations arrive in P10 |
| Gantt dependency connectors from relations; date-conflict colouring | P10 | Gantt arrives in P10 |
| Relation filters and a relations display property | P10 | Rich filter tree (decision 20) arrives in P10 |
| Your work "Subscribed" tab, static view "subscribed", agent profiles with their notifications | P9 | Those surfaces arrive in P9 |
| Notifications for cycle and module changes (module lead and members) | P9 | Module members become meaningful on agent profiles; P7 notifies only on work items |
| Home "Since you were last here" widget | P9 | P5 deferral, unchanged |
| Comment search in Power K and FTS over comment bodies | P11 | Not needed for the exit criteria; FTS rebuild cost belongs with the performance pass |
| Comment version history | not planned | Comments show "edited"; descriptions and pages keep versions (P10) |
| Notification preferences (mute by kind) | not planned | Single user; ask if wanted (open question 8) |
| Browser or OS push notifications, email | excluded | Local app (U8) |
| Undo of an assistant comment | P11 | "Undo last assistant action" is P11 |
| Clicking an `@` mention opens the actor's profile | P9 | `/agents/[actorId]` arrives in P9; until then the chip is not a link target |

### 2. New decisions (lane A writes them into docs/PLAN.md after row 48)

| # | Decision |
|---|---|
| 49 | **Notifications derive from activity.** `logActivity` (activity.ts) calls `notifyFromActivity(ctx, row)` (notifications.ts) after the insert, so every mutation from every adapter (Server Actions, MCP, assistant Apply, automations later) notifies inside its own transaction. Only rows with a `work_item_id` notify in P7. Recipients: the item's subscribers, plus the explicit target of `assignees` added rows (the new assignee) and `mention` added rows (the mentioned actor). |
| 50 | **Who never receives**: the causing actor (`ctx.actor`); actors of kind `system` and `assistant`; deleted actors; and, when the causing actor is `assistant`, the user too (the user clicked Apply). MCP agents (kind `agent`) do receive and read their own inbox through the notification tools. |
| 51 | **Kinds and coalescing.** `NotificationKind` = `mentioned`, `assigned`, `commented`, `state_changed`, `updated`, `intake_received` (P8), `automation` (P10); rank in that order. A new event merges into the recipient's newest notification with the same `work_item_id` and causing `actor_id` when it is unread, not archived, not snoozed and its `sort_at` is under 10 minutes old (`COALESCE_WINDOW_MS`): `kind` becomes the higher-ranked one, `snippet` the newest event's, `event_count + 1`, `sort_at = now`. `kind_count` (events of the row's current kind) follows the merge: a higher-ranked new kind sets `kind` to it and `kind_count` to 1, the same kind adds 1, a lower-ranked kind leaves it; `event_count` stays the total. The row reads the kind's phrase, with "N times" when `kind_count` > 1 and " · +M more" (M = `event_count` − `kind_count`) for the other events; a single event reads the plain phrase (migration 0013 adds `kind_count` with default 1 and no backfill, so an older merged row reads "+M more", which is always true). Otherwise a new row. Rows not notifying: verbs `created`, `copied`, `reacted`, `unreacted`; field `sort_order`; `mention` removed rows. |
| 52 | **Read, archive, snooze.** Inbox = not archived and (`snoozed_till` null or ≤ now), ordered by `sort_at` desc. Snoozing sets `snoozed_till`, sets `sort_at = snoozed_till` and clears `read_at`, so the row comes back unread at the top when it wakes; unsnooze clears `snoozed_till` and sets `sort_at = now`. Archive keeps the read state; archived and snoozed rows are never coalescing targets. Unread count (badge) = unread, not archived, not snoozed. |
| 53 | **Mentions are links** `[@Name](actor:<id>)` in every markdown body (work item description, comment, page). `actor` joins `ENTITY_LINK_SCHEMES`; the `@` pick inserts text with a Link mark, exactly as `#` does, so no custom node parses it. On every body save the engine replaces the entity's `mention` rows with the ids found (`extractActorMentions`); each added id logs an activity row (`verb: "added"`, `field: "mention"`) which notifies (`mentioned`) and auto-subscribes the actor for work items and comments. Plain `@Name` text stays text. Existing plain `@Name` bodies are not migrated. |
| 54 | **Subscriptions** are added on create (creator), assign, comment (author) and mention; there is no sticky opt-out: a later comment, assignment or mention subscribes again. Unsubscribe removes the row as today. |
| 55 | **Relations.** Display types `blocked_by ↔ blocking`, `relates_to ↔ relates_to`, `duplicate ↔ duplicate`, `start_before ↔ start_after`, `finish_before ↔ finish_after`, `implemented_by ↔ implements`. Stored rows use the canonical type (`RelationTypeSchema`); an inverse input swaps ids; symmetric types store the smaller id first. One live row per unordered pair, enforced by a unique expression index on `(min(a,b), max(a,b))`; adding a relation to a pair that has one replaces its type (logged as removed + added). Self → VALIDATION; either item archived → ARCHIVED; cross-project allowed; removal matches either direction and soft-deletes. Both items log `added`/`removed` with `field` = the display type from that item's side and the other item's id and key as value and identifier. Deleting a work item soft-deletes its relations and comments in the same transaction. |
| 56 | **Comments.** Threads are one level deep: a reply to a reply attaches to its root. Bodies are markdown (1–50,000 chars), composed and submitted (no autosave). `update_comment` is author-only (RULE otherwise) with CAS on `body_version` and sets `edited_at`; `delete_comment` is allowed to the author and to `user`, is destructive and soft-deletes the comment with its replies. Archived items are read-only (ARCHIVED). Activity rows: `entity_type: "comment"`, `entity_id` = comment id, `work_item_id`, verbs `commented` / `updated` / `deleted`, and `activity.comment` = the first 140 characters of the plain-text body. |
| 57 | **Reactions** are one of eight emoji (`👍 👎 😄 🎉 😕 ❤️ 🚀 👀`, `ReactionSchema`) on a work item or a comment; add is idempotent, remove hard-deletes the row. They log `reacted` / `unreacted` (so open tabs refresh through the changes poller) and never notify. The timeline hides those rows. |
| 58 | **Notification tools act on the caller's own notifications** (`recipient_actor_id = ctx.actor.id`; another actor's id is NOT_FOUND). They move from the P9 "Workspace" row of docs/contracts/tools.md to P7 and take id lists: `list_notifications`, `mark_notifications_read`, `mark_notifications_unread`, `archive_notifications`, `unarchive_notifications`, `snooze_notifications`, `unsnooze_notifications`. |
| 59 | **Inbox route and badge.** `/inbox?tab=inbox|mentions|snoozed|archived&unread=1&item=<workItemId>`; two panes (list, detail of the selected item with its project bundle). Clicking a row marks it read and opens the item; opening an item elsewhere does not mark it read. `GET /api/changes` also returns `unread_notifications` for the user; `ChangesPoller` calls `refreshAction()` when it differs from the last value, so snooze wake-ups update the badge without new activity. |
| 60 | **Inbox digest** is `ai_digest` kind `inbox` keyed by the recipient actor id, built on demand (Summarise / Refresh, as P5) from the unread inbox notifications and the activity rows they cover; never generated on page load. |

### 3. Data model changes

All in `src/lib/tessera/db/schema/collaboration.ts` (after the P5 split), one
generated migration `drizzle/0004_collaboration.sql` (+ `drizzle/meta/*`). It is
`0004` because P5 owns `0002_ai` and P6 owns `0003_pages` (**refresh before build**:
take the next free number).

| Table | Change | Why |
|---|---|---|
| `notification` | add `sort_at text NOT NULL DEFAULT ''` (the service always writes it; SQLite's `ADD COLUMN … NOT NULL` needs a constant default) | inbox order, snooze wake-up (decision 52) |
| `notification` | add `event_count integer NOT NULL DEFAULT 1` | coalescing (decision 51) |
| `notification` | add `kind_count integer NOT NULL DEFAULT 1` (migration 0013, fix round 4) | wording of a merged row (decision 51) |
| `notification` | add index `notification_inbox_idx` on (`recipient_actor_id`, `archived_at`, `sort_at`) | inbox list |
| `notification` | add index `notification_coalesce_idx` on (`recipient_actor_id`, `work_item_id`, `actor_id`, `seq`) | coalescing lookup |
| `work_item_relation` | replace `work_item_relation_pair_uq` with `work_item_relation_unordered_uq` = `uniqueIndex().on(sql\`min(work_item_id, related_work_item_id)\`, sql\`max(work_item_id, related_work_item_id)\`).where(DELETED_AT_IS_NULL)`; keep `work_item_relation_related_idx` and add `work_item_relation_item_idx` on (`work_item_id`) | one live row per unordered pair even under two writers (decision 55) |
| `comment` | add index `comment_parent_idx` on (`parent_comment_id`) | reply lookup, cascade delete |
| `mention` | none | extraction replaces rows (decision 53) |
| `comment_reaction`, `work_item_reaction` | none | |

The expression index: if `drizzle-kit generate` (0.31.11) does not emit expression
columns for SQLite, lane A hand-writes the `CREATE UNIQUE INDEX` in the migration and
keeps the Drizzle schema entry as the plain index on (`work_item_id`) plus a comment
(**refresh before build**: run generate once and read the SQL). The notification
table is empty in every existing database, so a table rebuild generated by
drizzle-kit is acceptable; no FTS table is involved, so `db:fts-rebuild` is not
needed.

Client-safe additions (lane 0, `schemas.ts` / `types.ts`):
- `RelationDisplayTypeSchema` (the 10 display types) and `RELATION_INVERSE`,
  `RELATION_CANONICAL` maps in `schemas.ts`.
- `ReactionSchema` = `z.enum(["👍","👎","😄","🎉","😕","❤️","🚀","👀"])`,
  `ReactionTargetSchema` = `z.enum(["work_item","comment"])`.
- `NotificationKindSchema` (decision 51), `NotificationTabSchema` =
  `z.enum(["inbox","mentions","snoozed","archived"])`.
- Types: `RelationView = { id, relation_type: RelationDisplayType, work_item: { id, key, name, project_id, state_group, state_name, state_color, archived_at } }`;
  `ReactionSummary = { reaction, count, actor_ids: string[] }`;
  `CommentView = CommentRow & { actor_name, actor_kind, reactions: ReactionSummary[], replies: CommentView[] }`
  (roots carry replies; replies carry `[]`);
  `NotificationView = NotificationRow & { kind: NotificationKind, actor_name: string | null, actor_kind: ActorKind | null, work_item_key: string | null, is_snoozed: boolean }`;
  `WorkItemDetail` gains `relations: RelationView[]` and `reactions: ReactionSummary[]`.

### 4. Engine additions (lane A)

New files (each under 600 lines):

`src/lib/tessera/relations.ts`
```ts
export const AddRelationInput = z.object({
  related_work_item_id: IdSchema.describe("The other work item (any project)."),
  relation_type: RelationDisplayTypeSchema.describe("Relation from this item's side, e.g. blocked_by or blocking."),
}).strict();
export function addRelation(ctx, workItemId: string, input): RelationView;       // replace-on-pair, both sides logged
export function removeRelation(ctx, workItemId: string, relatedId: string): void; // either direction; NOT_FOUND when none
export function listRelations(ctx, workItemId: string): RelationView[];          // display type from this side, live items only, ordered by display type then key
export function relationsFor(ctx, ids: readonly string[]): Map<string, RelationView[]>; // batch, for getWorkItem
export function toCanonical(a: string, b: string, t: RelationDisplayType): { work_item_id; related_work_item_id; relation_type: RelationType };
```

`src/lib/tessera/comments.ts`
```ts
export const CreateCommentInput = z.object({ body_md: z.string().trim().min(1).max(50_000), parent_comment_id: IdSchema.optional() }).strict();
export const UpdateCommentInput = z.object({ body_md: …same…, expected_body_version: z.number().int().min(0) }).strict();
export function listComments(ctx, workItemId: string): CommentView[];   // roots by created_at asc, replies nested, live only
export function getComment(ctx, id: string): CommentView;
export function createComment(ctx, workItemId: string, input): CommentView; // subscribes author, syncMentions, logs commented
export function updateComment(ctx, id: string, input): CommentView;     // author only, CAS, edited_at, syncMentions
export function deleteComment(ctx, id: string): void;                   // author or user; replies too; mentions removed
export function commentSnippet(md: string): string;                     // 140-char plain text (strips links, marks, code fences)
```

`src/lib/tessera/reactions.ts`
```ts
export const ReactionInput = z.object({ target: ReactionTargetSchema, target_id: IdSchema, reaction: ReactionSchema }).strict();
export function addReaction(ctx, input): ReactionSummary[];    // idempotent; logs reacted
export function removeReaction(ctx, input): ReactionSummary[]; // no-op when absent; logs unreacted only when a row went
export function reactionsFor(ctx, target, ids: readonly string[]): Map<string, ReactionSummary[]>;
```

`src/lib/tessera/mentions.ts`
```ts
export function extractActorMentions(md: string): string[];  // unique ids from ](actor:<uuid>) links, outside code
export function syncMentions(ctx, target: { entity_type: "work_item" | "comment" | "page"; entity_id: string; work_item_id: string | null; project_id: string | null }, md: string): { added: string[]; removed: string[] };
// live actors only; added → activity (added, field "mention", new_value actor id, new_identifier name) + subscribe when work_item_id
export function clearMentions(ctx, entity_type, entity_ids: readonly string[]): void;
```

`src/lib/tessera/notifications.ts`
```ts
export const COALESCE_WINDOW_MS = 10 * 60_000;
export const NOTIFICATION_KIND_RANK: Record<NotificationKind, number>;
export function notifyFromActivity(ctx, row: ActivityRow): void;   // decision 49–51
export function notify(ctx, input: { recipient_ids: string[]; kind: NotificationKind; work_item_id: string | null; project_id: string | null; entity_type; entity_id; snippet: string }): void; // P8/P10 entry
export function notificationText(row: ActivityRow): { kind: NotificationKind | null; snippet: string }; // pure: "State → Done", "Assigned to you", comment snippet, "blocked by WEB-3"
export const ListNotificationsInput = z.object({ tab: NotificationTabSchema.default("inbox"), unread_only: z.boolean().default(false), limit: z.number().int().min(1).max(500).default(200), before_sort_at: z.string().optional() }).strict();
export function listNotifications(ctx, input): { notifications: NotificationView[]; unread_count: number };
export function getUnreadCount(ctx, actorId?: string): number;
export const NotificationIdsInput = z.object({ notification_ids: z.array(IdSchema).min(1).max(200) }).strict();
export function markNotificationsRead(ctx, input: { notification_ids?: string[]; all?: true }): number;
export function markNotificationsUnread(ctx, ids): number;
export function archiveNotifications(ctx, ids): number;
export function unarchiveNotifications(ctx, ids): number;
export function snoozeNotifications(ctx, input: { notification_ids; until: string /* ISO UTC, > now, ≤ now + 90 days */ }): number;
export function unsnoozeNotifications(ctx, ids): number;
```
Notification ids are the `uid` (TEXT); `seq` stays the internal cursor. Mark,
archive and snooze write no activity (they are the recipient's own state, like
recents).

Edits (owner lane A):
- `activity.ts`: call `notifyFromActivity(ctx, row)` at the end of `logActivity`;
  add `"unreacted"` to `ACTIVITY_VERBS`.
- `work-items/update.ts` `updateWorkItemDescription`: `syncMentions` after the CAS
  write; `work-items/create.ts` `createWorkItem`: `syncMentions` on a non-empty
  description (**refresh before build**: file names after the P4 split).
- `work-items/read.ts` `getWorkItem`: add `relations` and `reactions`.
- `work-items/lifecycle.ts` delete: soft-delete relations and comments of the
  deleted tree, `clearMentions` for the items and their comments.
- `pages/body.ts` (P6): `syncMentions` with `entity_type: "page"`, `work_item_id: null`
  (mentioned actors are notified with `entity_type: "page"`, not subscribed).
- `filters.ts` `mentionsAny`: also match `mention.entity_type = "comment"` joined to
  live comments of the item.
- `tools/describe-filters.ts`: the `mentions` filter text ("description or a comment
  mentions the actor").
- `ai/digest-store.ts` `digestInputs(ctx, "inbox", actorId)` and `ai/prompts.ts`
  (inbox digest prompt; `describeScope` adds the last 20 comments and the relations
  of a scoped work item); `DigestKindSchema` gains `inbox` (**refresh before
  build**: P5 names).
- `index.ts` exports; `docs/contracts/{schema,service-api,tools,editor,ai}.md`;
  `docs/PLAN.md` (decisions 49–60, §4 rows, §9 P7 row, §13 deviations: links shipped
  earlier, notification tools moved to P7).

Tools (`tools/registry/{relations,comments,notifications}.ts`, phase `P7`;
★ = core, † = destructive, which takes `confirm: true` like the others):

| Tool | Input (strict) | Notes |
|---|---|---|
| `list_relations` | `{ work_item_id }` | |
| `add_relation` | `{ work_item_id, related_work_item_id, relation_type }` | replaces an existing pair's type |
| `remove_relation` | `{ work_item_id, related_work_item_id }` | |
| ★`list_comments` | `{ work_item_id }` | |
| ★`create_comment` | `{ work_item_id, body_md, parent_comment_id? }` | description says how to mention: `[@Name](actor:<id>)`, ids from `list_actors` |
| `update_comment` | `{ comment_id, body_md, expected_body_version }` | author only |
| †`delete_comment` | `{ comment_id, confirm }` | |
| `add_reaction` | `{ target, target_id, reaction }` | |
| `remove_reaction` | `{ target, target_id, reaction }` | |
| ★`list_notifications` | `ListNotificationsInput` | the caller's own |
| `mark_notifications_read` | `{ notification_ids?, all? }` (exactly one) | |
| `mark_notifications_unread` | `{ notification_ids }` | |
| `archive_notifications` | `{ notification_ids }` | |
| `unarchive_notifications` | `{ notification_ids }` | |
| `snooze_notifications` | `{ notification_ids, until }` | |
| `unsnooze_notifications` | `{ notification_ids }` | |

`create_work_item` / `update_work_item_description` descriptions gain the mention
sentence. The registry test's one-to-one coverage and the `propose_*` stub generation
(P5) pick the new tools up without other changes.

Tests (lane A, in-memory SQLite with all migrations):
- `tests/relations.test.ts`: inverse input swaps; symmetric smaller-id-first; list
  from both sides with the inverse display; pair replace; self VALIDATION; archived
  ARCHIVED; cross-project; removal either direction; activity on both items; delete
  item soft-deletes relations; unique index rejects a raw duplicate insert.
- `tests/comments.test.ts`: reply-to-reply attaches to the root; author-only update
  (RULE for another actor); CAS CONFLICT; `edited_at`; delete by user of an agent's
  comment; replies cascade; archived item ARCHIVED; author subscribed; snippet.
- `tests/reactions.test.ts`: idempotent add; remove no-op; invalid emoji VALIDATION;
  summaries; no notification.
- `tests/mentions.test.ts`: extraction ignores code spans and fences; replace set;
  added mention notifies once and subscribes; removed mention does not notify; page
  mention notifies without subscription; `mentions` filter matches description and
  comment.
- `tests/notifications.test.ts`: never to the causing actor; never to system or
  assistant; assistant writes do not notify the user but do notify a subscribed MCP
  agent; "MCP state change notifies subscribers" (actor `mcp:test` changes state,
  user subscribed → one `state_changed` row with snippet "State → Done"); assignment
  → `assigned` to the assignee; comment with a mention → one row of kind
  `mentioned`; coalescing within 10 minutes and a new row after; read rows are not
  coalescing targets; snooze hides, wakes unread at `sort_at`; unread count; tabs;
  another actor's id NOT_FOUND; `sort_order`-only moves do not notify.
- `tests/mcp-notifications.test.ts`: through `InMemoryTransport`, an MCP client
  comments on a user-subscribed item → `getUnreadCount(user) === 1`; the agent's
  `list_notifications` returns only its own rows.
- `tests/registry.test.ts`, `tests/filters.test.ts`, `tests/activity.test.ts`
  updated; `tests/ai/digest-store.test.ts` gains the inbox kind.

### 5. Routes and data loading

Every read: sync page shell → `<Suspense fallback={<Skeleton/>}>` → async child
awaits `params` / `searchParams`, `await io()`, then `readTessera(fn)`.

| Route / file | Owner | Loading |
|---|---|---|
| `src/app/(tessera)/inbox/page.tsx` (new) | U3 | Two Suspense boundaries. `InboxListData`: `searchParams` → `tab`, `unread`, `item` (parsed with `NotificationTabSchema.catch("inbox")`), `io()`, `readTessera(ctx => listNotifications(ctx, { tab, unread_only, limit: 200 }))` plus the stored inbox digest (P5 read helper, **refresh before build**). `InboxDetailData` (keyed by `item`): `loadWorkItemDetail` + `loadProjectBundle` from `work-items/load-detail.ts`, wrapped in `ProjectProvider`; NOT_FOUND / VALIDATION → `EmptyState` "This work item was deleted". |
| `src/app/(tessera)/work-items/load-detail.ts` | U1 | `loadWorkItemDetail` adds `comments: listComments(ctx, id)` (relations and reactions come with `getWorkItem`). |
| `src/app/(tessera)/layout.tsx` | U3 | the sidebar read adds `getUnreadCount(ctx)`; `ChangesPoller` gets `initialUnread`. |
| `src/app/api/changes/route.ts` | U3 | response gains `unread_notifications: getUnreadCount(ctx, USER_ACTOR_ID)`. |
| `src/app/actions/relations-comments.ts` (new) | U1 | `toolAction` wrappers: `addRelationAction`, `removeRelationAction`, `createCommentAction`, `updateCommentAction`, `deleteCommentAction`, `addReactionAction`, `removeReactionAction`. |
| `src/app/actions/inbox.ts` (new) | U3 | `markNotificationsReadAction`, `markNotificationsUnreadAction`, `archiveNotificationsAction`, `unarchiveNotificationsAction`, `snoozeNotificationsAction`, `unsnoozeNotificationsAction`. |

Recents (`src/components/shell/recents.ts`, U3): `/inbox` (any query) → label
"Inbox", icon `InboxIcon`; the `item` param does not create a separate recent (the
item's own route is recorded when opened full screen). Shortcuts (`shortcuts.ts`,
U3): `nav.inbox` (`g k`) loses `arrives: "P7"` and routes to `/inbox`;
`item.subscribe` toast becomes "Subscribed" / "Unsubscribed" (U1 in
`WorkItemDetail.tsx`). Power K: "Inbox" in Navigate comes from the shortcut
definition; item actions "Add relation…" and "Comment" are registered through
`registerCommandContext` by U1 only if `shortcuts.ts` accepts key-less item
actions (**refresh before build**; otherwise they are left out of P7).

### 6. Screens and components

Import `Dialog` and `AlertDialog` only from `@/components/shell/dialogs`. Icons only
from `src/themes/catppuccin/icons.tsx`. Layout through `className` + tokens in the
area CSS files; no `<div>`/`<span>`, hex or xstyle.

**Detail: relations and reactions (U1)**
- `components/detail/RelationsList.tsx`: section heading "Relations" with an "Add
  relation" `Button` (ghost, size sm, `RelationIcon`) that opens a `DropdownMenu` of
  the 10 display types; a pick opens `RelationPicker`. Rows grouped by display type
  (heading text "Blocked by", "Blocking", …), each a `ListItem` with `StatusDot`
  (state group), key `Token`, name, project identifier when it differs, and a remove
  `IconButton` (`XIcon`, label "Remove relation"); click opens the item through
  `onOpenItem`. Hidden when empty and read-only.
- `components/detail/RelationPicker.tsx`: `ComplexSelector` searching
  `/api/search?types=work_item` across all projects (no `scope`), reusing
  `search-hits.ts` `toCandidates`; excludes the item itself and items already
  related.
- `components/detail/ReactionBar.tsx`: one `ToggleButton` per present reaction
  (`label` = emoji + count, `isPressed` when `actor_ids` includes the current actor,
  `tooltip` = actor names) and an add `IconButton` (`ReactionIcon`) opening a
  `Popover` with the eight emoji as `ToggleButton`s. Used under the description
  and under each comment.
- `DetailHeader.tsx`: a `ToggleButton` "Subscribe" / "Subscribed" (`icon`
  `BellIcon`, `pressedIcon` `BellSlashIcon` … **check** icon pairing at build),
  `isPressed = isSubscribed`, size sm.
- `WorkItemDetail.tsx` main column order: description, `ReactionBar`, sub-items,
  `RelationsList`, links, `Timeline` (U2) in place of `ActivityFeed`.

**Detail: comments and timeline (U2)**
- `components/detail/Timeline.tsx` props `{ workItemId: string; comments: CommentView[]; activity: ActivityLogEntry[]; readOnly: boolean; currentActorId: string; mentionActors: readonly { id: string; name: string }[]; onOpenItem: (id: string) => void }`:
  heading "Activity", a `SegmentedControl` (`SegmentedControlItem` All / Comments /
  Updates, size sm), then entries merged by time (oldest first, the newest 20 shown
  with "Show older"), then `CommentComposer` unless read-only. Updates hide rows of
  `entity_type` comment, verbs `reacted` / `unreacted`, and field `mention`.
- `components/detail/CommentItem.tsx`: `Avatar` (`name`, size sm) + actor name +
  `RelativeTime` + "edited"; body through `MarkdownEditor` `readOnly compact`;
  `ReactionBar`; a `MoreMenu` (Reply, Edit (author is the user), Copy link
  (`#comment-<id>`), Delete); replies indented under the root; Delete opens an
  `AlertDialog` naming the reply count. Anchor id `comment-<id>`; the detail scrolls
  to `location.hash` once on mount.
- `components/detail/CommentComposer.tsx`: `MarkdownEditor compact` with
  `mentionActors`, placeholder "Leave a comment…", a primary `Button` "Comment"
  (`mod+enter` submits), clears on success; editing reuses it with
  `expected_body_version`, CONFLICT → `Banner` "This comment changed" with "Load
  theirs".
- `ActivityFeed.tsx` stays as the Updates row renderer (`ActivityRow` exported);
  `activity-text.ts` gains the relation fields ("marked this as blocked by WEB-3")
  and `commented`.
- Editor: `editor/links.ts` adds `actor` to `ENTITY_LINK_SCHEMES`;
  `editor/mentions.tsx` / `extensions.ts` turn the `@` trigger into a plain
  Suggestion that inserts `@Name` with a Link mark `actor:<id>` (as `#` does); the
  Mention node keeps only the `[[` page trigger (**refresh before build**: P6 state
  of the `[[` trigger); `.tessera-editor-mention` styles `a[href^="actor:"]`; the
  round-trip corpus gains `[@Ada](actor:<id>)`.

**Inbox (U3)**
- `components/inbox/InboxScreen.tsx`: `Layout` with `start` = a `LayoutPanel`
  (`width` 400, `resizable` via `useResizable` from `@astryxdesign/core/Resizable`
  320–560 with a `ResizeHandle`, as `PeekHost.tsx` does, `label` "Notifications",
  `isScrollable`) and the content = the selected item's detail (`WorkItemDetail`
  host `page`) or an `EmptyState` "Select a notification". The panel header
  (`PanelHeader`) holds title "Inbox", a `TabList` (`Tab href` for Inbox, Mentions,
  Snoozed, Archived), a `ToggleButton` "Unread" (`?unread=1`) and a `MoreMenu`
  ("Mark all as read").
- `components/inbox/NotificationRow.tsx`: `ListItem` with `startContent`
  `Avatar` (actor name), `label` "<actor> <phrase>" (`inbox-format.ts`),
  `description` "<key> <title> · <snippet>", `endContent` `RelativeTime`
  (`hasTooltip={false}` when inside a tooltip trigger) and an unread `StatusDot
  variant="accent" label="Unread"`; `isSelected` for the open item; a coalesced
  row says so in the label phrase ("commented 2 times · +1 more"), no separate "+N" text. Row `MoreMenu`: Mark read / unread, Archive / Unarchive,
  Snooze ▸ (1 hour, Tomorrow 09:00, Next Monday 09:00, Custom…), Unsnooze.
- `components/inbox/SnoozeDialog.tsx`: `Dialog` with `DateTimeInput` (`min` now,
  `max` now + 90 days, `hasClear={false}`); presets computed in event handlers in
  `inbox-format.ts` `snoozePresets(now: Date)`.
- `components/inbox/InboxDigest.tsx`: P5's `DigestCard` with `kind="inbox"` above
  the list when the AI status is available (**refresh before build**: DigestCard
  props).
- `components/inbox/inbox-format.ts` (no directive, pure): `notificationPhrase(kind,
  kind_count, event_count)`, `snoozePresets(now)`, `inboxHref(tab, unread, item)`.
- Shell: `Sidebar.tsx` adds `SideNavItem` "Inbox" (`icon` `InboxIcon`, `href`
  "/inbox", `endContent` `<Badge label={String(n)} />` when n > 0) after Home;
  `ChangesPoller.tsx` takes `initialUnread` and refreshes when the polled
  `unread_notifications` changes.

**Astryx verification** (0.6.8 `dist/*/*.d.ts`): `Avatar` `name`, `size`, `tooltip`,
`status`; `ToggleButton` `label`, `isPressed`, `onPressedChange`, `icon`,
`pressedIcon`, `isIconOnly`, `tooltip`, `size`; `Popover` `content`, `isOpen`,
`onOpenChange`, `placement`, `label`; `ListItem`/`Item` `startContent`, `label`,
`description`, `endContent`, `onClick`, `href`, `isSelected`, `density`;
`SideNavItem` `label`, `icon`, `href`, `isSelected`, `endContent`; `Badge` `label`,
`variant`; `StatusDot` `variant`, `label`, `tooltip`; `SegmentedControl` `value`,
`onChange`, `label`, `size` with `SegmentedControlItem`; `Layout` `start`, `content`,
`end`, `header`; `LayoutPanel` `width`, `resizable`, `isScrollable`, `label`,
`role`, `hasDivider`, `padding`; `DateTimeInput` `label`, `value`, `onChange`, `min`,
`max`, `hasClear`; `ComplexSelector`, `DropdownMenu`, `MoreMenu`, `EmptyState` as
already used in the repo. `Chat*` is not used (its sender roles are user/assistant).

New icons (lane 0, `icons.tsx`, all present in `@phosphor-icons/react/dist/csr/`):
`InboxIcon = duotoneIcon(Tray)`, `CommentIcon = duotoneIcon(ChatCircleText)`,
`ReactionIcon = duotoneIcon(Smiley)`, `RelationIcon = duotoneIcon(ArrowsLeftRight)`,
`ReplyIcon = duotoneIcon(ArrowBendUpLeft)`, `MarkReadIcon = duotoneIcon(EnvelopeOpen)`,
`MarkUnreadIcon = duotoneIcon(EnvelopeSimple)`, `SnoozeIcon = duotoneIcon(ClockCountdown)`,
`MentionIcon = duotoneIcon(At)`.

### 7. Lane split for swarm workers

No file in `scripts/file-budget.json` must grow: after P4–P6 the over-budget files
are split folders, and P7 adds new files (**refresh before build**: re-read the
budget file; if `CommandBar.tsx` is still listed, P7 does not touch it).

| Lane | Creates | Edits | Never touches |
|---|---|---|---|
| 0 prep | `src/components/styles/{collaboration,inbox}.css` (header comment only) | `src/lib/tessera/{schemas,types}.ts` (§3 client-safe shapes), `src/themes/catppuccin/icons.tsx` (9 icons), `src/app/globals.css` (two imports) | behaviour, tests |
| A engine | `src/lib/tessera/{relations,comments,reactions,mentions,notifications}.ts`; `src/lib/tessera/tools/registry/{relations,comments,notifications}.ts`; `drizzle/0004_*.sql` + `drizzle/meta/*`; `tests/{relations,comments,reactions,mentions,notifications,mcp-notifications}.test.ts` | `db/schema/collaboration.ts`, `activity.ts`, `work-items/{create,update,read,lifecycle}.ts`, `pages/body.ts`, `filters.ts`, `tools/describe-filters.ts`, `tools/registry/{index,work-items}.ts` (descriptions), `ai/{digest-store,prompts}.ts`, `index.ts`, `tests/{registry,filters,activity}.test.ts`, `tests/ai/digest-store.test.ts`, `docs/contracts/{schema,service-api,tools,editor,ai,OWNERS}.md`, `docs/PLAN.md` | `src/app/**`, `src/components/**` |
| U1 detail: relations, reactions, subscribe | `components/detail/{RelationsList,RelationPicker,ReactionBar}.tsx`, `src/app/actions/relations-comments.ts`, `tests/ui/relations-format.test.ts` | `components/detail/{WorkItemDetail,DetailHeader}.tsx`, `components/detail/types.ts` (`comments: CommentView[]`), `src/app/(tessera)/work-items/load-detail.ts`, `components/styles/collaboration.css` (relations and reactions blocks) | editor, inbox, shell |
| U2 comments and timeline | `components/detail/{Timeline,CommentItem,CommentComposer}.tsx`, `components/detail/timeline.ts` (pure merge and filter), `tests/ui/timeline.test.ts` | `components/detail/{ActivityFeed.tsx,activity-text.ts}`, `components/editor/{links.ts,mentions.tsx,extensions.ts}`, `tests/editor/markdown-roundtrip.test.ts` (corpus), `components/styles/collaboration.css` (comment and timeline blocks, after U1's) , `components/styles/editor.css` (mention chip) | `WorkItemDetail.tsx` (U1 places `Timeline`), `src/lib/tessera/**` |
| U3 inbox and shell | `src/app/(tessera)/inbox/page.tsx`, `src/app/actions/inbox.ts`, `components/inbox/{InboxScreen,NotificationRow,SnoozeDialog,InboxDigest}.tsx`, `components/inbox/inbox-format.ts`, `tests/ui/inbox-format.test.ts` | `src/app/(tessera)/layout.tsx`, `src/app/api/changes/route.ts`, `components/shell/{Sidebar,ChangesPoller}.tsx`, `components/shell/{recents,shortcuts,useShortcuts}.ts`, `components/styles/inbox.css`, `tests/ui/{recents,shortcuts}.test.ts` | `components/detail/**`, `src/lib/tessera/**` |

`collaboration.css` has two owners in sequence: U1 writes its block first, U2
appends below a `/* comments */` marker (or the contract gives U2 its own
`comments.css`; **refresh before build** decides). Order: lane 0 → A and U1–U3 in
parallel against the §3 types (U lanes stub actions until A lands) → merge A first,
then U1, U2, U3 → acceptance.

### 8. New dependencies

None. Emoji are text; every component is Astryx or already installed (Tiptap
Suggestion, Phosphor icons). The licence gate is unaffected.

### 9. Acceptance (on a fresh `data/p7-acceptance.db` after `next build`)

Stop the dev server, `rm -rf .next/dev`, move any old `data/p7-acceptance.db*` to the
scratchpad, `TESSERA_DB_PATH=data/p7-acceptance.db npm run build && next start -H
127.0.0.1`. Read the console on every screen.

1. `npm run check` is green; `drizzle-kit generate` reports no schema changes after
   `0004`.
2. Create project `WEB` and items `WEB-1` "Login page", `WEB-2` "Session store"; create
   project `API` with `API-1` "Auth endpoint".
3. Open `WEB-1`: the header shows "Subscribed" (creator); toggle it off and on with
   `shift+s`; the toast says "Unsubscribed" then "Subscribed".
4. In `WEB-1` add relation "Blocked by" → `WEB-2`: Relations shows "Blocked by WEB-2";
   open `WEB-2`: it shows "Blocking WEB-1"; both timelines (Updates) show the change.
5. In `WEB-1` add "Relates to" → `WEB-2`: the pair now shows only "Relates to" on both
   items; add "Implements" → `API-1` (cross-project) and remove it from `API-1`'s side.
6. React 👍 on `WEB-1`'s description, then 🎉; toggle 👍 off; reload keeps 🎉 only.
7. Comment on `WEB-1` "Needs review by @<agent>" picking the agent from `@` (register
   `mcp:acceptance` first with `scripts/mcp-call.ts register_actor`); the comment
   renders the chip; reply to it; reply to the reply lands under the root; edit the
   first comment (shows "edited"); react 🚀 on the reply.
8. The All / Comments / Updates control switches the timeline. Delete the root
   comment: the AlertDialog names its 2 replies; after a reload the root and both
   replies are gone.
9. With `TESSERA_DB_PATH=data/p7-acceptance.db npx tsx scripts/mcp-call.ts` as
   `mcp:acceptance`: `update_work_item` `WEB-1` state → In Progress. Within 5 s the
   sidebar Inbox badge shows 1 without a reload.
10. As the agent, `create_comment` on `WEB-1` with `[@User](actor:<user id>)`: the badge
    stays 1 (coalesced), the row shows kind "mentioned you" and "+1".
11. Open `/inbox` (`g k`): the row is unread; click it → the detail opens on the right,
    the row is read and the badge is gone; Mentions tab lists it.
12. Snooze it "1 hour": it leaves Inbox and appears in Snoozed; Unsnooze returns it
    unread at the top; Archive moves it to Archived; Unarchive restores it.
13. As the agent, `list_notifications` returns only the agent's rows (the user's
    comment from step 7 mentioned the agent: one `mentioned` row); `mark_notifications_read`
    with `all: true` clears them.
14. Apply an assistant proposal that comments on `WEB-1` (P5 panel, if a credential
    resolves; else `tests/notifications.test.ts` covers it): no new user notification.
15. `list_work_items` with `filters.mentions = [<agent id>]` returns `WEB-1`.
16. Inbox digest: Summarise on `/inbox` (credential required) returns a digest; without
    one, the card is hidden.
17. Delete `WEB-2`: `WEB-1`'s Relations no longer lists it; the inbox row for `WEB-2`
    (if any) opens the "This work item was deleted" EmptyState.
18. Recents show "Inbox" with the Tray icon; Power K "Inbox" navigates; no console
    errors beyond the tolerated Astryx Table warnings.
19. `grep -r ANTHROPIC .next/static` is empty; switch the dev server back to the P7 dev
    DB, never `data/tessera.db`.

### 10. Risks

| Risk | Mitigation |
|---|---|
| Notification fan-out inside `logActivity` slows bulk writes (`bulk_update_work_items` on 100 items × fields) | Subscriber lookup per row is one indexed query; coalescing collapses per-item bursts; `tests/notifications.test.ts` times a 200-item bulk update (< 250 ms in memory) |
| `logActivity` calling `notifications.ts` creates an import cycle | `notifications.ts` imports only `db/schema`, `core/*` and `types`; never `activity.ts` |
| A notification for the wrong recipient (the causing actor, or the user after Apply) | Decision 50 tests; the invariant stays a named Vitest |
| `ADD COLUMN NOT NULL` or the expression index is not generated as expected | Run `db:generate` once at the start of lane A; hand-write the index if needed; migration test on a copy of a P6 database |
| The `@` change breaks the markdown round-trip or old `@Name` bodies | Corpus gains actor links; plain `@Name` stays text (no rewrite on open); the Banner rule for parse-serialise differences still applies |
| Many read-only `MarkdownEditor` instances in a long thread | Timeline shows the newest 20 entries; "Show older" pages by 20 |
| MCP agents accumulate unread notifications nobody reads | Indexed; the agent's own tools archive; retention is a P11 item |
| Two lanes in `collaboration.css` | Sequential ownership or a split file (refresh before build) |
| P5/P6 names differ from this plan (`DigestCard`, `digest-store`, `pages/body.ts`, registry file names) | Marked refresh before build; the contract planner re-reads them |
| Coalescing hides an event the user cares about | Kind rank keeps the most important kind; `kind_count` and `event_count` put "N times" and "· +M more" in the label; the item timeline lists every event |

### 11. Open questions for the user (each with the default the plan uses)

1. Should assistant writes you applied also notify you? **Default: no** (decision 50).
2. Should plain `@Name` written by agents become a mention when the name matches an
   actor? **Default: no**, only `[@Name](actor:<id>)` links; tool descriptions teach
   agents the form.
3. Reactions: a fixed set of eight emoji, or any emoji? **Default: the fixed eight.**
4. May you delete an agent's comment, and edit it? **Default: delete yes, edit no.**
5. Coalescing window for bursts from one actor on one item: **default 10 minutes.**
6. Notify subscribers about description edits by agents? **Default: yes**, coalesced as
   `updated`.
7. Should opening a work item anywhere mark its notifications read? **Default: no**, only
   clicking the row in the inbox.
8. Do you want per-kind notification muting? **Default: not planned.**
9. Adding a relation to a pair that already has one: replace or refuse? **Default:
   replace** (decision 55).

### Refresh before build (checklist for the contract planner)

- Migration number and `db/schema/collaboration.ts` path after P5/P6; run
  `db:generate` once and read the SQL.
- `work-items/*` file names for create, update, read, lifecycle after the P4 split;
  registry file names.
- P5: `DigestKindSchema`, `digestInputs`, the stored-digest read helper, `DigestCard`
  props, `describeScope` signature.
- P6: `pages/body.ts` save path and the `[[` trigger implementation in the editor.
- `shortcuts.ts` support for key-less item actions in Power K.
- `scripts/file-budget.json` entries at build time.
- Whether `collaboration.css` is split for U2.
