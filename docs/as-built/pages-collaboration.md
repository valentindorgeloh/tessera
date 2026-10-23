# As-built map: pages and collaboration (P6, P7)

State described: the working tree after fix round 3 (2026-10-23, HEAD 198611a plus uncommitted lane work, including migration 0012). Earlier rounds: the fix-all round (2026-10-21) and the visual alignment round (2026-10-22). Round 3 built decisions 51, 52, 53 and 59 as written (notification coalescing, snooze, mention sync on every body, `unread_notifications` in `/api/changes`) and the `[[` page-link trigger. Line counts are tree counts. Decision numbers are rows of the "Resolved design decisions" table in docs/PLAN.md. Contracts: docs/contracts/editor.md, ui.md; plans: docs/drafts/p6-plan.md, p7-plan.md.

## 1. Purpose and boundaries

Pages are Markdown documents in a tree, either in the wiki (no project) or in a project with Pages on. Collaboration is everything that connects people and items: relations, comments with one-level threads, reactions, mentions, subscriptions, notifications and the Inbox, plus the version history dialog for work item descriptions and page bodies. The retired handbook content was imported once into the wiki.

Lives elsewhere (this area only calls it):
- The shared Markdown editor, its save queue and the work item description: shell-detail.md (`components/editor/**`, `detail/DescriptionEditor.tsx`).
- Peek, modal and full detail host of a work item: shell-detail.md (`detail/PeekHost.tsx`, `WorkItemDetail.tsx`).
- Activity logging, the change cursor and the poller that refreshes open pages: engine.md.
- The inbox digest model call: ai.md.
- Favourites on pages and views: workspace.md.

## 2. File map

### Engine (`src/lib/tessera/`)

| File | Responsibility | Key exports |
|---|---|---|
| `pages/model.ts` (164) | Inputs, the `PageRecord` view, guards: `assertContentWritable` (ARCHIVED, LOCKED), `assertProjectWritable`, `assertPagesEnabled`. | `loadPage`, `assertContentWritable`, `sameSpace` |
| `pages/read.ts` (101) | Tree order is depth-first with siblings by `sort_order`; backlinks include archived pages, flagged. | `listPages`, `getPage`, `pageAncestors`, `listPageBacklinks`, `listPageVersions` |
| `pages/write.ts` (156), `pages/tree.ts` (90) | Create appends (and syncs mentions of a non-empty body; `duplicatePage` passes `notifyMentions: false`, which records the copy's mention rows silently); `movePage` changes space, parent and position in one call, moves the subtree, clears page labels when leaving a project; `parent_id` must be in the same space and not inside the page's own subtree. | `createPage`, `updatePage`, `duplicatePage`, `movePage` |
| `pages/body.ts` (87) | Body write with CAS on `description_version` (CONFLICT carries `current_version`), one `page_version` row per write, same actor within 5 minutes rewrites the newest row; runs `syncMentions` on the new body. | `updatePageBody`, `restorePageVersion`, `writePageVersion` |
| `pages/embeds.ts` (57) | Entity links in a body become `page_embed` rows; links in fenced code are ignored. | `extractEntityRefs`, `replacePageEmbeds` |
| `pages/lifecycle.ts` (84) | Lock, archive (page and descendants), unarchive, delete (archived only). | `lockPage`, `archivePage`, `unarchivePage`, `deletePage` |
| `comments.ts` (253) | Threads one level deep (a reply to a reply attaches to the root); update is author-only with CAS on `body_version`; delete by author or user soft-deletes the replies. | `createComment`, `updateComment`, `deleteComment`, `listComments` |
| `reactions.ts` (178) | Eight emoji (`REACTION_EMOJI`) on an item or comment; add and remove are idempotent; real changes log `reacted`/`unreacted`. | `addReaction`, `removeReaction`, `reactionsFor` |
| `relations.ts` (177) | One live row per unordered pair in canonical direction; adding to a pair replaces its type; the other item sees the inverse type. | `addRelation`, `removeRelation`, `listRelations` |
| `notifications.ts` (447) | `notifyFromActivity` runs inside `logActivity`'s transaction. `kindFor` maps an activity row to a kind (decision 51): `mentioned` (a `mention` row added), `commented`, `state_changed`, `assigned`, `updated` (any other change to the work item itself); verbs `created`, `copied`, `reacted`, `unreacted`, the fields `sort_order` and `subscribers`, mention removals, comment edits and deletes, intake and draft rows are silent. Recipients follow decision 50 (`deliverable`). `writeRows` merges into the recipient's newest row for the same item and causing actor when it is unread, not archived, not snoozed and `sort_at` is under `COALESCE_WINDOW_MS` (10 minutes): kind becomes the higher-ranked (`NOTIFICATION_KIND_RANK`), snippet the newest, `event_count + 1`, `sort_at = now`, `created_at` kept; page mentions never merge. `withoutUpdatedFor` keeps a description save that newly mentions an actor from also sending them `updated`. Reads and writes are on the caller's own rows; the list orders by `sort_at` desc, `seq` desc. | `notifyFromActivity`, `notifyIntakeReceived`, `getUnreadCount`, `listNotifications`, `snoozeNotifications`, `withoutUpdatedFor` |
| `mentions.ts` (148) | Decision 53. `extractActorMentions` (ignores fenced and inline code), `syncMentions` (diffs the entity's `mention` rows against the live actors the body links to; an added actor logs an `added mention` row, which notifies `mentioned` and subscribes the actor on work items; a removed one logs `removed mention`, which notifies nobody; the saving actor is never added; `silent` writes rows only), `bodySnippet`. Called by `createComment`, `updateComment`, `updateWorkItemDescription`, `createWorkItem` (not for intake-required projects), `updatePageBody`, `createPage`. | `extractActorMentions`, `syncMentions`, `bodySnippet` |
| `history.ts` (71), `work-items/versions.ts` | Newest 100 bodies for a work item or page, plus the newest 50 activity rows for a page. | `getHistory`, `writeWorkItemVersion` |
| `import-handbook.ts` (377) | One-time import of `content/*.md` into the wiki; a rerun skips slugs already imported. | `planHandbookImport`, `importHandbook` |

Registry tools: `pages.ts` (15 tools: list/get/create/update/update body/move/duplicate/lock/unlock/archive/unarchive/restore version/delete/backlinks/versions), `comments.ts` (comments and reactions), `relations.ts`, `notifications.ts`, `history.ts` (work item versions). Wrappers: `actions/{pages,relations-comments,inbox,history}.ts`. API: `api/history/[entityType]/[entityId]` (GET, same-origin only).

### Routes (`src/app/(tessera)/`)

| Path | Responsibility |
|---|---|
| `wiki/page.tsx` (43) | Wiki tree (`?tab=` public, private, archived). |
| `pages/[pageId]/page.tsx` (50), `pages/load-page.ts` (35) | Frame-less page screen for a wiki page; a project page redirects to its project route. `loadPageBundle` returns page, labels (null for wiki), actors; `pageSpaces` lists projects with Pages on. |
| `projects/[projectId]/pages/page.tsx`, `pages/[pageId]/page.tsx` | Project Pages tab and a project page inside the frame. |
| `inbox/page.tsx` (89) | `listNotifications` (limit 200) and the stored inbox digest; `?item=` streams the selected work item's detail under its own Suspense. |

### Components

| Path | Responsibility | Key exports |
|---|---|---|
| `pages/PagesScreen.tsx` (228) | Tree with search, Public/Private/Archived tabs, New page ("Untitled", opens at once). Order is optimistic (`useOptimistic`) for a drag and for the row menu's Move up/Move down (decision 13); a failure toasts and reverts. A moved page keeps the open or closed state it was drawn with before the move (`drawnOpen` in `page-tree.ts`, a `pinnedOpen` map), so a pending, refused or failed move never collapses the parent that was open. `PanelPage width="full"`, header with `tabsBelow`. Tree rows are 44 px under touch. | `PagesScreen` |
| `pages/use-page-drag.ts` (146), `page-move.ts` (101, pure) | Pointer drag on the Astryx `TreeList` rows by delegation (`li[data-tree-id]`); drop between siblings, or into another expanded parent's child group; own subtree refused; landing line. A mouse or pen drags from anywhere on the row; a finger drags only from the row grip (`.tessera-row-grip`, 44 px under touch, `touch-action: none` on the grip only), and the row menu's Move up/Move down is the keyboard and touch path. | `usePageDrag`, `pageMoveFromDrop`, `applyPageMove`, `dropLineFor` |
| `pages/page-tree.ts` (166, pure), `page-menu-items.ts` (106, pure) | Tree grouping, search keeping ancestors, href helpers, recent paths; the shared menu rows of the list and the page header. | `toTreeItems`, `pageHref`, `pageMenuEntries` |
| `pages/PageScreen.tsx` (229) | Breadcrumbs, title, meta row, body. shift+l lock, shift+a access, shift+r archive/restore, mod+. copy link, registered on the screen with `useHotkeys`. `PageTitle`, `PageMeta` and `PageBodyEditor` carry distinct keys (title-, meta-, body- plus id). | `PageScreen` |
| `pages/PageBodyEditor.tsx` (384) | Markdown editor with its own 400 ms CAS queue over `updatePageBodyAction`, conflict and lossy-parse banners. | `PageBodyEditor` |
| `pages/PageOutline.tsx` (36), `editor/heading-ids.ts` (89) | Outline from the editor DOM; heading ids are assigned at editor creation (`headingIdTransaction`, no save, no undo step) and after each change. Outline sits beside the 960px column from a 1136px frame (columns `minmax(0, 1fr) 960px minmax(160px, 240px) minmax(var(--spacing-4), 1fr)`, sticky at `--spacing-5`), a stacked card above it otherwise. | `PageOutline`, `headingIdTransaction` |
| `pages/{PageTitle,PageMeta,PageRowMenu,MovePageDialog,DeletePageDialog}.tsx` | Rename on blur/Enter; access, lock and labels (project pages only); row menu; move across spaces; delete confirm for archived pages. | same names |
| `history/VersionHistoryDialog.tsx` (221), `diff-lines.ts`, `page-activity.ts` | Versions with a line diff and Restore behind an AlertDialog; a page also gets an Activity tab (actor, wording, time) from the same response. The list column is `clamp(160px, 30%, 240px)`, the panes stack below 600 px (list capped at 4 rows), and "Restore this version" sits in the pinned footer, disabled with a reason on the current version. | `VersionHistoryDialog`, `diffLines`, `describePageActivity` |
| `shared/LockControl.tsx`, `lock-state.ts`, `use-optimistic-lock.ts` | Lock toggle; "Unlocked" feedback is derived from the confirmed (server) value, so a failed unlock flashes nothing. | `LockControl`, `nextLockFeedback` |
| `editor/mentions.tsx` (419) | Suggestion triggers `@` (actors), `#` (work items), `/` and `[[` (pages). `[[` debounces 150 ms, needs one character, and shows "No pages match" when empty. In a project it runs two requests (that project's pages, limit 8, and wiki pages, limit 20 filtered to no project), project hits first, deduped, at most 8; a wiki page runs one unscoped request; a failed half is dropped. A pick inserts the page name with a `page:<id>` link mark, serialised as `[Name](page:<id>)`, which `replacePageEmbeds` records as a back-link on a page-body save. | `buildEditorSuggestions` |
| `detail/Timeline.tsx` (221), `timeline.ts` (91, pure) | Comments and updates merged oldest first, newest 20 until "Show older", All/Comments/Updates filter, composer unless read-only. | `Timeline`, `mergeTimeline` |
| `detail/{CommentComposer,CommentItem,MentionedIn}.tsx` | Compact editor with mod+enter and the `@` and `[[` pickers; subscribing toasts "Subscribed. Changes to this work item now reach your inbox." (a read-only compact editor has no 120 px minimum and no toolbar row); edit sends `expected_body_version`; menu reply/edit/copy link/delete; a `ReactionBar` under each comment body; "Mentioned in" lists pages that embed the item (archived ones marked). | same names |
| `detail/{RelationsList,ReactionBar}.tsx`, `relation-model.ts`, `reaction-model.ts` | Relations section on the work item (after Sub-items): rows grouped by display type from this item's side (decision 55), state dot, key button, name, remove; "Add relation" Dialog with a type Selector and a cross-project search (the item itself left out); optimistic add and remove, read-only on archived items. Reaction chips (`aria-pressed`, name "<emoji name> reaction, N") under the description and each comment, an Add reaction popover with the eight emoji (`REACTION_CHOICES`, equal to the engine's `REACTION_EMOJI` by a test); optimistic toggle (decision 57). Details in shell-detail.md. | `RelationsList`, `ReactionBar`, `groupRelations`, `toggleReaction` |
| `inbox/{InboxScreen,NotificationRow,SnoozeDialog}.tsx`, `inbox-format.ts` (pure) | List beside the selected item from 1024 px, one pane at a time below it ("Back to notifications"); header `PanelBar tabsBelow` (title and strip in start, toggle and menu in end); the first tab is "All"; the unread dot keeps its slot on every row; the row label is a `Text` (it wraps instead of clipping a long agent name) reading "<actor> <phrase>", where `commented` with `event_count` above 1 reads "commented N times" and every other kind shows "+N"; a page mention opens `/pages/<id>` (`notificationHref`); tabs and unread toggle are links; presets and custom snooze with the workspace week start (its date and time fields are 44 px targets under touch). | `InboxScreen`, `parseInboxQuery`, `snoozePresets` |

## 3. Data and control flow

### Read path
1. Page and inbox routes follow the standard shape: sync default export, `<Suspense>`, `await io()`, id validation, one `readTessera`, `notFound()` for NOT_FOUND/VALIDATION.
2. A work item detail load (`work-items/load-detail.ts`) adds `comments` (threads nested under roots), `backlinks` (`listPageBacklinks`), `relations` (`listRelations` with the related item resolved) and `reactions` (`reactionsFor(ctx, "work_item", [id])`) next to the activity feed; comment reactions arrive nested in `comments`.
3. The history dialog fetches `GET /api/history/<type>/<id>` when opened and `listActorsAction` for names.

### Write path
1. Page body: `PageBodyEditor` queues one request at a time; CONFLICT shows "Changed elsewhere". There is no `pagehide` beacon for page bodies (the work item description has one).
2. Every markdown body save calls `syncMentions` (`mentions.ts`): comments (create, edit), work item descriptions (`work-items/update.ts`, after its `description_md` row, inside `withoutUpdatedFor`), work item creation, page bodies and page creation. Each added actor gets a `mention` row, a subscription (work items) and one `mentioned` notification; removals are logged and silent; re-saving a body adds nothing.
3. Any mutation reaches `logActivity`, which calls `notifyFromActivity` in the same transaction; `writeRows` coalesces (section 4). The sidebar badge is the unread count of the layout render, and `GET /api/changes` returns `unread_notifications` as well: `nextPollState` (`poll-loop.ts`) asks `ChangesPoller` to call `refreshAction()` when there are changes or when the count differs from the last one, so a snooze wake-up moves the badge with no new activity.
4. Inbox actions mark read/unread, archive, snooze; opening a row marks it read and sets `?item=` (a page mention goes to its page). Snoozing sets `snoozed_till`, `sort_at = snoozed_till` and clears `read_at`; unsnoozing sets `sort_at = now`; archive keeps `read_at`; archiving a still-snoozed row resets `sort_at` to now; "mark all read" skips rows that are still snoozed (decision 52).

## 4. Invariants and rules the code enforces

| Rule | Decision | Enforced in | Test |
|---|---|---|---|
| Parent in the same space; no move under itself; Pages off refuses create/duplicate/move into the project | 40, 48 | `pages/write.ts`, `tree.ts`, `model.ts` | `tests/pages/tree.test.ts` |
| Locked page refuses content writes (LOCKED); archived page read-only except unarchive/delete; delete needs archive first | 41 | `pages/model.ts`, `lifecycle.ts` | none at engine level |
| Wiki pages carry no labels (`wiki_page_labels`) | 48 | `pages/write.ts` | none |
| Body write: CAS, version row, 5-minute same-actor collapse | 10, 43 | `pages/body.ts` | `tests/registry.test.ts` (shape only) |
| Entity links become `page_embed` rows; backlinks include archived pages | 44 | `pages/embeds.ts`, `read.ts` | `tests/detail-loader.test.ts`, `tests/ui/mentioned-in.test.ts` |
| Handbook import is idempotent per slug | 46 | `import-handbook.ts` | `tests/import-handbook.test.ts` |
| Notifications derive from activity inside the writer's transaction; never to the actor, system, assistant or deleted actors, nor to the user when the assistant caused it | 49, 50 | `notifications.ts` `deliverable` | `tests/notifications.test.ts` |
| Coalescing: same recipient, item and causing actor, unread, not archived, not snoozed, `sort_at` under 10 minutes (9:59 merges, 10:00 does not); higher-ranked kind wins; page mentions never merge | 51 | `writeRows`, `coalesceTarget`; migration 0012 | `tests/notifications.test.ts` |
| Snooze, unsnooze, archive and the unread count follow decision 52 | 52 | `snoozeNotifications` and its siblings, `getUnreadCount` | `tests/notifications.test.ts` |
| Notification tools act only on the caller's own rows | 58 | `notifications.ts` `resolveIds` | `tests/notifications.test.ts` |
| Comments one level deep, author-only update with CAS, author or user delete | 56 | `comments.ts` | `tests/comments.test.ts` |
| Reactions: eight emoji, idempotent, never notify, hidden from the timeline | 57 | `reactions.ts`, `timeline.ts`, `ReactionBar` | `tests/reactions.test.ts`, `tests/ui/timeline.test.ts`, `tests/ui/reaction-bar.test.ts` |
| Relations: inverse display, one row per pair, self invalid, archived refuse | 55 | `relations.ts`, `RelationsList` (grouped from this item's side, read-only when archived) | `tests/relations.test.ts`, `tests/ui/relations-list.test.ts` |
| Mentions are `[@Name](actor:<id>)` links; every body save syncs them (diff, no delete-all); a page mention notifies and opens the page | 53 | `mentions.ts`, `editor/links.ts`, `inbox-format.notificationHref` | `tests/mentions.test.ts`, `tests/editor/links.test.ts`, `tests/ui/inbox-format.test.ts` |
| `/api/changes` returns `unread_notifications`; the poller refreshes when it differs | 59 | `api/changes/route.ts`, `poll-loop.nextPollState`, `ChangesPoller` | `tests/changes-route.test.ts`, `tests/ui/poll-loop.test.ts` |
| Page drag reorders among siblings; keyboard path is the row menu, and its Move up/Move down is optimistic | 13, 14, 105 | `page-move.ts`, `PageRowMenu`, `PagesScreen.move` | `tests/pages/move.test.ts`, `tests/ui/pages-drag.test.ts`, `tests/ui/pages-menu-move.test.ts` |
| Outline never narrows the reading column | p10 plan | `PageOutline`, `pages.css` | `tests/ui/pages-outline-css.test.ts` |

## 5. Tests that guard this area

- Engine: `tests/{comments,reactions,relations,notifications,mentions,changes-route,import-handbook,detail-loader}.test.ts`, `tests/pages/{tree,move}.test.ts`.
- Editor: `tests/editor/{heading-ids,heading-ids-initial,links,suggestions,markdown-roundtrip}.test.ts`.
- UI: `tests/ui/{page-screen,pages-drag,pages-menu-move,pages-outline-css,pages-visual-css,editor-phone-inset-css,version-history,timeline,mentioned-in,inbox-format,inbox-narrow,relations-list,reaction-bar,relations-reactions-css}.test.ts` (the `-css` files read the stylesheets); `tests/editor/slash-rows.test.ts` (one height for every `/` row); `tests/ui/{inbox-row-label,pages-move-expansion,poll-loop}.test.ts`; `tests/editor/suggestions.test.ts` covers the `[[` search with `fetch` mocked.
- Playwright: `relations-reactions.spec.ts` (add and remove a relation, toggle a reaction on the description and a comment), `pages.spec.ts` (embed with `#` survives a reload; lock, refuse, unlock, restore; "Mentioned in" on the embedded item), `collaboration.spec.ts` (comment saved; comments in the peek timeline; MCP comment raises the inbox badge). `round-features.spec.ts` (round 3): two agent comments make one "commented 2 times" row; an agent description mention gives a "mentioned you" row; `unread_notifications` is numeric and moves by one on an agent comment; typing `[[` offers a page and inserts a `page:` link that survives a reload. Result of the 2026-10-22 run, not repeated in round 3: the "Mentioned in" and "comments in the peek timeline" specs failed.
- No Vitest: `lifecycle.ts`, `body.ts`, `embeds.ts` and `duplicatePage` at engine level; `getHistory`; `PageBodyEditor`; `InboxScreen`.

## 6. Extension points

- New entity link scheme: add it to `ENTITY_LINK_SCHEMES` (`editor/links.ts`), resolve it in `embeds.ts` and `entityRoute`.
- New notification kind: add it to `NotificationKindSchema` and `NOTIFICATION_KIND_RANK` (`schemas.ts`; the rank decides which kind a merged row keeps), `kindFor`/`recipientsFor` in `notifications.ts`, the phrase table in `inbox-format.ts` and the Mentions tab filter.
- New activity wording for the page Activity tab: `history/page-activity.ts` (rows carry only verb and field, no old/new values).
- New relation type: add it to `RELATION_DISPLAY_TYPES` in the engine schemas; `relation-model.ts` (`RELATION_LABELS`) and the Add relation picker follow it.

## 7. Known debt and quirks

- Notification wording: `event_count` counts every merged event, so a state change or edit merged into a `commented` row still reads "commented N times" (marked ASSUMPTION in `inbox-format.ts`).
- A re-saved description that mentions an already-subscribed actor merges into their `mentioned` row through the `updated` kind (event_count 2, kind `mentioned`); the mention itself is never re-added. `createWorkItem` with a description that mentions the actor it also assigns gives one merged row (`mentioned`, +1).
- A mention row for the saving actor that another writer created earlier is kept; only mentions of other actors are removed when the body stops linking them.
- The page you are editing shows up in its own `[[` list; a self-link is skipped by `replacePageEmbeds` rather than filtered out of the picker.
- Page body has no `pagehide` beacon; a reload inside the 400 ms debounce can drop the last keystrokes.
- A `work:` link in a page opens `/browse/<key>` (no peek host on a page screen).
- Touch drag in the page tree starts from the grip only (the rest of the row scrolls), and a drop into a collapsed or leaf parent is not possible (use the Move dialog).
- Rows drawn at top level whose real parent is hidden on the tab (a public page under a private one) are not draggable.
- Failed unlock and the reparenting drag are covered in jsdom only. The wiki tabs at 375 px (both schemes) were measured in a browser in round 3: no overflow and every control hits its 44x44 box.
- The two Playwright failures of 2026-10-22 ("Mentioned in", comments in the peek timeline) were not diagnosed and not re-run in round 3.

## 8. Where to read more

| Topic | Read |
|---|---|
| Pages, editor | docs/contracts/editor.md, docs/drafts/p6-plan.md, docs/PLAN.md 40–48 |
| Notifications, inbox | docs/drafts/p7-plan.md, docs/PLAN.md 49–60 |
| History | docs/drafts/p10-plan.md "Version history", decisions 98–99 |
