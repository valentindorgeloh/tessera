# As-built map: pages and collaboration (P6, P7)

State described: the working tree after the fix-all round (2026-10-21) and the visual alignment round (2026-10-22, on HEAD 5f0cc7c: relations and reactions UI on the work item detail, page tree touch grip and optimistic Move up/Move down, inbox below 1024 px, the history dialog layout). Line counts are tree counts. Decision numbers are rows of the "Resolved design decisions" table in docs/PLAN.md. Contracts: docs/contracts/editor.md, ui.md; plans: docs/drafts/p6-plan.md, p7-plan.md.

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
| `pages/write.ts` (145), `pages/tree.ts` (90) | Create appends; `movePage` changes space, parent and position in one call, moves the subtree, clears page labels when leaving a project; `parent_id` must be in the same space and not inside the page's own subtree. | `createPage`, `updatePage`, `duplicatePage`, `movePage` |
| `pages/body.ts` (84) | Body write with CAS on `description_version` (CONFLICT carries `current_version`), one `page_version` row per write, same actor within 5 minutes rewrites the newest row. | `updatePageBody`, `restorePageVersion`, `writePageVersion` |
| `pages/embeds.ts` (57) | Entity links in a body become `page_embed` rows; links in fenced code are ignored. | `extractEntityRefs`, `replacePageEmbeds` |
| `pages/lifecycle.ts` (84) | Lock, archive (page and descendants), unarchive, delete (archived only). | `lockPage`, `archivePage`, `unarchivePage`, `deletePage` |
| `comments.ts` (321) | Threads one level deep (a reply to a reply attaches to the root); update is author-only with CAS on `body_version`; delete by author or user soft-deletes the replies. | `createComment`, `updateComment`, `deleteComment`, `listComments` |
| `reactions.ts` (178) | Eight emoji (`REACTION_EMOJI`) on an item or comment; add and remove are idempotent; real changes log `reacted`/`unreacted`. | `addReaction`, `removeReaction`, `reactionsFor` |
| `relations.ts` (154) | One live row per unordered pair in canonical direction; adding to a pair replaces its type; the other item sees the inverse type. | `addRelation`, `removeRelation`, `listRelations` |
| `notifications.ts` (376) | `notifyFromActivity` runs inside `logActivity`'s transaction. Recipients are subscribers (never the actor), the new assignee, mentioned actors. Reads and writes are on the caller's own rows. | `notifyFromActivity`, `notifyMentions`, `notifyIntakeReceived`, `getUnreadCount`, `listNotifications`, `snoozeNotifications` |
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
| `pages/PagesScreen.tsx` (217) | Tree with search, Public/Private/Archived tabs, New page ("Untitled", opens at once). Order is optimistic (`useOptimistic`) for a drag and for the row menu's Move up/Move down (decision 13); a failure toasts and reverts. `PanelPage width="full"`, header with `tabsBelow`. Tree rows are 44 px under touch. | `PagesScreen` |
| `pages/use-page-drag.ts` (146), `page-move.ts` (101, pure) | Pointer drag on the Astryx `TreeList` rows by delegation (`li[data-tree-id]`); drop between siblings, or into another expanded parent's child group; own subtree refused; landing line. A mouse or pen drags from anywhere on the row; a finger drags only from the row grip (`.tessera-row-grip`, 44 px under touch, `touch-action: none` on the grip only), and the row menu's Move up/Move down is the keyboard and touch path. | `usePageDrag`, `pageMoveFromDrop`, `applyPageMove`, `dropLineFor` |
| `pages/page-tree.ts` (149, pure), `page-menu-items.ts` (106, pure) | Tree grouping, search keeping ancestors, href helpers, recent paths; the shared menu rows of the list and the page header. | `toTreeItems`, `pageHref`, `pageMenuEntries` |
| `pages/PageScreen.tsx` (229) | Breadcrumbs, title, meta row, body. shift+l lock, shift+a access, shift+r archive/restore, mod+. copy link, registered on the screen with `useHotkeys`. `PageTitle`, `PageMeta` and `PageBodyEditor` carry distinct keys (title-, meta-, body- plus id). | `PageScreen` |
| `pages/PageBodyEditor.tsx` (384) | Markdown editor with its own 400 ms CAS queue over `updatePageBodyAction`, conflict and lossy-parse banners. | `PageBodyEditor` |
| `pages/PageOutline.tsx` (36), `editor/heading-ids.ts` (89) | Outline from the editor DOM; heading ids are assigned at editor creation (`headingIdTransaction`, no save, no undo step) and after each change. Outline sits beside the 960px column from a 1136px frame (columns `minmax(0, 1fr) 960px minmax(160px, 240px) minmax(var(--spacing-4), 1fr)`, sticky at `--spacing-5`), a stacked card above it otherwise. | `PageOutline`, `headingIdTransaction` |
| `pages/{PageTitle,PageMeta,PageRowMenu,MovePageDialog,DeletePageDialog}.tsx` | Rename on blur/Enter; access, lock and labels (project pages only); row menu; move across spaces; delete confirm for archived pages. | same names |
| `history/VersionHistoryDialog.tsx` (221), `diff-lines.ts`, `page-activity.ts` | Versions with a line diff and Restore behind an AlertDialog; a page also gets an Activity tab (actor, wording, time) from the same response. The list column is `clamp(160px, 30%, 240px)`, the panes stack below 600 px (list capped at 4 rows), and "Restore this version" sits in the pinned footer, disabled with a reason on the current version. | `VersionHistoryDialog`, `diffLines`, `describePageActivity` |
| `shared/LockControl.tsx`, `lock-state.ts`, `use-optimistic-lock.ts` | Lock toggle; "Unlocked" feedback is derived from the confirmed (server) value, so a failed unlock flashes nothing. | `LockControl`, `nextLockFeedback` |
| `detail/Timeline.tsx` (221), `timeline.ts` (91, pure) | Comments and updates merged oldest first, newest 20 until "Show older", All/Comments/Updates filter, composer unless read-only. | `Timeline`, `mergeTimeline` |
| `detail/{CommentComposer,CommentItem,MentionedIn}.tsx` | Compact editor with mod+enter (a read-only compact editor has no 120 px minimum and no toolbar row); edit sends `expected_body_version`; menu reply/edit/copy link/delete; a `ReactionBar` under each comment body; "Mentioned in" lists pages that embed the item (archived ones marked). | same names |
| `detail/{RelationsList,ReactionBar}.tsx`, `relation-model.ts`, `reaction-model.ts` | Relations section on the work item (after Sub-items): rows grouped by display type from this item's side (decision 55), state dot, key button, name, remove; "Add relation" Dialog with a type Selector and a cross-project search (the item itself left out); optimistic add and remove, read-only on archived items. Reaction chips (`aria-pressed`, name "<emoji name> reaction, N") under the description and each comment, an Add reaction popover with the eight emoji (`REACTION_CHOICES`, equal to the engine's `REACTION_EMOJI` by a test); optimistic toggle (decision 57). Details in shell-detail.md. | `RelationsList`, `ReactionBar`, `groupRelations`, `toggleReaction` |
| `inbox/{InboxScreen,NotificationRow,SnoozeDialog}.tsx`, `inbox-format.ts` (pure) | List beside the selected item from 1024 px, one pane at a time below it ("Back to notifications"); the first tab is "All"; the unread dot keeps its slot on every row; tabs and unread toggle are links; presets and custom snooze with the workspace week start (its date and time fields are 44 px targets under touch). | `InboxScreen`, `parseInboxQuery`, `snoozePresets` |

## 3. Data and control flow

### Read path
1. Page and inbox routes follow the standard shape: sync default export, `<Suspense>`, `await io()`, id validation, one `readTessera`, `notFound()` for NOT_FOUND/VALIDATION.
2. A work item detail load (`work-items/load-detail.ts`) adds `comments` (threads nested under roots), `backlinks` (`listPageBacklinks`), `relations` (`listRelations` with the related item resolved) and `reactions` (`reactionsFor(ctx, "work_item", [id])`) next to the activity feed; comment reactions arrive nested in `comments`.
3. The history dialog fetches `GET /api/history/<type>/<id>` when opened and `listActorsAction` for names.

### Write path
1. Page body: `PageBodyEditor` queues one request at a time; CONFLICT shows "Changed elsewhere". There is no `pagehide` beacon for page bodies (the work item description has one).
2. A comment write re-extracts its `actor:` mentions (`syncMentions`, `comments.ts`), replaces the `mention` rows and calls `notifyMentions`; description and page bodies do not (see section 7).
3. Any mutation reaches `logActivity`, which calls `notifyFromActivity` in the same transaction. The sidebar badge is the unread count of the last layout render; `GET /api/changes` carries activity only, so a snooze wake-up shows after the next refresh.
4. Inbox actions mark read/unread, archive, snooze; opening a row marks it read and sets `?item=`.

## 4. Invariants and rules the code enforces

| Rule | Decision | Enforced in | Test |
|---|---|---|---|
| Parent in the same space; no move under itself; Pages off refuses create/duplicate/move into the project | 40, 48 | `pages/write.ts`, `tree.ts`, `model.ts` | `tests/pages/tree.test.ts` |
| Locked page refuses content writes (LOCKED); archived page read-only except unarchive/delete; delete needs archive first | 41 | `pages/model.ts`, `lifecycle.ts` | none at engine level |
| Wiki pages carry no labels (`wiki_page_labels`) | 48 | `pages/write.ts` | none |
| Body write: CAS, version row, 5-minute same-actor collapse | 10, 43 | `pages/body.ts` | `tests/registry.test.ts` (shape only) |
| Entity links become `page_embed` rows; backlinks include archived pages | 44 | `pages/embeds.ts`, `read.ts` | `tests/detail-loader.test.ts`, `tests/ui/mentioned-in.test.ts` |
| Handbook import is idempotent per slug | 46 | `import-handbook.ts` | `tests/import-handbook.test.ts` |
| Notifications derive from activity inside the writer's transaction; never to the actor | 49, 50 | `notifications.ts` | `tests/notifications.test.ts` |
| Notification tools act only on the caller's own rows | 58 | `notifications.ts` `resolveIds` | `tests/notifications.test.ts` |
| Comments one level deep, author-only update with CAS, author or user delete | 56 | `comments.ts` | `tests/comments.test.ts` |
| Reactions: eight emoji, idempotent, never notify, hidden from the timeline | 57 | `reactions.ts`, `timeline.ts`, `ReactionBar` | `tests/reactions.test.ts`, `tests/ui/timeline.test.ts`, `tests/ui/reaction-bar.test.ts` |
| Relations: inverse display, one row per pair, self invalid, archived refuse | 55 | `relations.ts`, `RelationsList` (grouped from this item's side, read-only when archived) | `tests/relations.test.ts`, `tests/ui/relations-list.test.ts` |
| Mentions are `[@Name](actor:<id>)` links; comment mentions notify | 53 | `editor/links.ts`, `comments.ts` | `tests/editor/links.test.ts`, `tests/notifications.test.ts` |
| Page drag reorders among siblings; keyboard path is the row menu, and its Move up/Move down is optimistic | 13, 14, 105 | `page-move.ts`, `PageRowMenu`, `PagesScreen.move` | `tests/pages/move.test.ts`, `tests/ui/pages-drag.test.ts`, `tests/ui/pages-menu-move.test.ts` |
| Outline never narrows the reading column | p10 plan | `PageOutline`, `pages.css` | `tests/ui/pages-outline-css.test.ts` |

## 5. Tests that guard this area

- Engine: `tests/{comments,reactions,relations,notifications,import-handbook,detail-loader}.test.ts`, `tests/pages/{tree,move}.test.ts`.
- Editor: `tests/editor/{heading-ids,heading-ids-initial,links,suggestions,markdown-roundtrip}.test.ts`.
- UI: `tests/ui/{page-screen,pages-drag,pages-menu-move,pages-outline-css,pages-visual-css,editor-phone-inset-css,version-history,timeline,mentioned-in,inbox-format,inbox-narrow,relations-list,reaction-bar,relations-reactions-css}.test.ts` (the `-css` files read the stylesheets); `tests/editor/slash-rows.test.ts` (one height for every `/` row).
- Playwright: `relations-reactions.spec.ts` (add and remove a relation, toggle a reaction on the description and a comment), `pages.spec.ts` (embed with `#` survives a reload; lock, refuse, unlock, restore; "Mentioned in" on the embedded item), `collaboration.spec.ts` (comment saved; comments in the peek timeline; MCP comment raises the inbox badge). Result of the 2026-10-22 run: the "Mentioned in" and "comments in the peek timeline" specs fail.
- No Vitest: `lifecycle.ts`, `body.ts`, `embeds.ts` and `duplicatePage` at engine level; `getHistory`; `PageBodyEditor`; `InboxScreen`.

## 6. Extension points

- New entity link scheme: add it to `ENTITY_LINK_SCHEMES` (`editor/links.ts`), resolve it in `embeds.ts` and `entityRoute`.
- New notification kind: extend `kindFor`/`recipientsFor` in `notifications.ts`, the phrase table in `inbox-format.ts` and the Mentions tab filter.
- New activity wording for the page Activity tab: `history/page-activity.ts` (rows carry only verb and field, no old/new values).
- New relation type: add it to `RELATION_DISPLAY_TYPES` in the engine schemas; `relation-model.ts` (`RELATION_LABELS`) and the Add relation picker follow it.

## 7. Known debt and quirks

- The code diverges from the text of decisions 51 and 52: `writeRows` updates an unread row of the same recipient, kind and item in place (no 10-minute window, no actor match), `event_count` is always 1, `sort_at` is `created_at`, there is no `updated` kind, and snoozing sets only `snoozed_till` (the row keeps its read state). The `+N` and "commented N times" wording in `inbox-format.ts` is dead until a count is stored.
- Decision 53 says every markdown body syncs its mentions; only comments do. A mention typed into a description or page body stays a link and notifies nobody.
- Decision 59 says `GET /api/changes` returns `unread_notifications` so `ChangesPoller` refreshes the badge on snooze wake-up; the route returns only `{ changes, cursor }`.
- Page body has no `pagehide` beacon; a reload inside the 400 ms debounce can drop the last keystrokes.
- A `work:` link in a page opens `/browse/<key>` (no peek host on a page screen).
- Touch drag in the page tree starts from the grip only (the rest of the row scrolls), and a drop into a collapsed or leaf parent is not possible (use the Move dialog).
- Rows drawn at top level whose real parent is hidden on the tab (a public page under a private one) are not draggable.
- Failed unlock, reparenting drag, 375 px and Latte are covered in jsdom only, not in a browser.
- The two Playwright failures above: the cause was not diagnosed in this round.

## 8. Where to read more

| Topic | Read |
|---|---|
| Pages, editor | docs/contracts/editor.md, docs/drafts/p6-plan.md, docs/PLAN.md 40–48 |
| Notifications, inbox | docs/drafts/p7-plan.md, docs/PLAN.md 49–60 |
| History | docs/drafts/p10-plan.md "Version history", decisions 98–99 |
