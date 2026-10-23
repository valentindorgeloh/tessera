# As-built map: planning extras (P8): intake, drafts, estimates, bulk

State described: the working tree after fix round 4, 2026-10-23 (HEAD `8575fcd` plus uncommitted lane work; round 4 changed only the dialog focus test line). Line counts are tree counts. Decision numbers are rows of the "Resolved design decisions" table in docs/PLAN.md. Plan: docs/drafts/p8-plan.md; the cycles, modules and archives screens are in planning.md. Round 3 changed little here: the Intake bar (the assistant button is an icon button and the search shrinks first), the nested-dialog focus return, and e2e coverage.

## 1. Purpose and boundaries

Four features that sit beside the work items list:
- **Intake**: a project inbox for work items that agents or other people submit. Items wait in the hidden `triage` state until accepted, declined, snoozed or marked duplicate.
- **Drafts**: workspace-level unfinished work items that never appear in lists, search, counts or the board.
- **Estimates**: one active estimate system per project (points, categories or time) and the `estimate_point_id` on work items.
- **Bulk**: select rows in the List and Table layouts and edit, archive, delete, copy or move them in one transaction; single-item copy and move to another project.

Lives elsewhere (this area only calls it):
- The list screen, layouts and the selection column hosts: work-items.md (`WorkItemsScreen`, `ListLayout`, `TableLayout`).
- Project settings frame and the Features switches for intake and estimates: views-settings.md.
- Notifications (`intake_received`) and the inbox: pages-collaboration.md.
- The assistant's intake triage (`propose_*` tools): ai.md.

## 2. File map

### Engine (`src/lib/tessera/`)

| File | Responsibility | Key exports |
|---|---|---|
| `intake.ts` (418) | One live `intake_item` per work item. Status moves pending, snoozed, accepted, declined, duplicate; accepted is final. A snoozed item whose time has passed counts as Open at read time (no job writes it back). | `listIntakeItems`, `getIntakeItem`, `getIntakeItemForWorkItem`, `countOpenIntake`, `createIntakeItem`, `acceptIntakeItem`, `declineIntakeItem`, `snoozeIntakeItem`, `unsnoozeIntakeItem`, `markIntakeDuplicate`, `deleteIntakeItem` |
| `intake-policy.ts` (104) | Decides where an actor's create lands: agents go to triage when the project requires it, and an agent with `intake` access always does. Notifies the user of a new item from anyone but the user or the assistant. | `intakeRequired`, `intakeSourceFor`, `recordIntakeItem`, `ensureDefaultIntake` |
| `drafts.ts` (302) | Drafts; project-scoped fields need a project and are checked with the create rules; changing `project_id` clears them. `moveDraftToProject` creates the work item and soft-deletes the draft in one transaction. | `listDrafts`, `getDraft`, `countDrafts`, `createDraft`, `updateDraft`, `deleteDraft`, `moveDraftToProject` |
| `estimates.ts` (291), `estimate-points.ts` (29) | Estimate systems; two to six values (`ESTIMATE_POINTS_MIN/MAX`); replacing a system keeps item points whose value matches (same type only) and clears the rest; removing a used point needs a remap. `activeEstimateId` returns an id only for type `points`. | `createEstimate`, `updateEstimate`, `deleteEstimate`, `getActiveEstimate`, `validateEstimateValues`, `activeEstimateId` |
| `work-items/bulk.ts` (125) | `bulk_update`, archive, unarchive, delete; one transaction, one failure rolls the set back; at most 500 ids. | `bulkUpdateWorkItems`, `bulkArchiveWorkItems`, `bulkUnarchiveWorkItems`, `bulkDeleteWorkItems` |
| `work-items/transfer.ts` (243), `bulk-transfer.ts` (40) | Single copy and move to another project (the move gives a new key, the old key still resolves); the bulk call applies the same rules to up to 100 items, all or nothing, and a move needs `confirm: true`. | `copyWorkItem`, `moveWorkItemToProject`, `bulkTransferWorkItems`, `MAX_BULK_TRANSFER` |

Registry tools: `intake.ts` (9 tools), `drafts.ts` (6), `estimates.ts` (5), and in `work-items.ts` the `bulk_*` family plus `copy_work_item`, `move_work_item_to_project`. Wrappers: `actions/{intake,drafts,estimates,work-items}.ts`.

### Routes (`src/app/(tessera)/`)

| Path | Responsibility |
|---|---|
| `projects/[projectId]/intake/page.tsx` (106) | `listIntakeItems` for `?tab=` (open, snoozed, closed) and `?q=`, `getIntakeItemForWorkItem` for `?item=`. Intake off gives the feature-off state. |
| `drafts/page.tsx` (58) | `listDrafts`; `?draft=` opens one in the dialog. |
| `projects/[projectId]/settings/estimates/page.tsx` (44) | Active and archived systems with usage counts. |

### Components

| Path | Responsibility | Key exports |
|---|---|---|
| `intake/IntakeScreen.tsx` (146) | Open, Snoozed, Closed tabs beside the selected work item; search waits 300 ms then writes `q`; "Triage with assistant" (an `IconButton` with a tooltip, only when the assistant is available) asks the panel with the project scope. The filters bar stays one 44 px row from 1440 down to 360 px: the search shrinks first (`min-width: 0`) and the start group has a 96 px flex basis (`intake.css`). | `IntakeScreen` |
| `intake/IntakeDetail.tsx` (158), `DuplicateDialog.tsx` (97) | Action bar: Accept, Decline, Snooze, Duplicate (search through `/api/search`, current item left out), Delete. An accepted item only links into the project. | `IntakeDetail`, `DuplicateDialog` |
| `intake/intake-format.ts` (61, pure) | Tabs, query codec, source label, status token, next open item after an action. | `parseIntakeQuery`, `nextOpenItem` |
| `drafts/DraftsScreen.tsx` (120), `DraftDialog.tsx` (221) | Workspace list; the dialog shows project fields once a project is chosen. The first save creates the row; creating the work item moves the draft. | `DraftsScreen`, `DraftDialog` |
| `drafts/SaveDraftDialog.tsx` (77) | "Save this draft?" when the create dialog closes with text. `CreateWorkItemDialog` in `mode="intake"` does not offer it. After Save draft both dialogs close and focus returns to the control that opened the create dialog (`restoreFocus` in `shell/dialogs.tsx` falls back to the last element focused outside a dialog when the nested dialog's remembered opener, a field of the create dialog, has unmounted). | `SaveDraftDialog` |
| `estimates/EstimatesSettings.tsx` (132), `EstimateDialog.tsx` (212) | Active system or an empty state; create, replace (type and template, then values), edit with a remap target for removed points. | `EstimatesSettings`, `EstimateDialog` |
| `estimates/estimate-rules.ts` (45), `estimate-format.ts` (22) | Client copy of the engine's value rules; display (`1h 30m`, category text, number). | `estimateValuesError`, `formatEstimateValue` |
| `work-items/properties/EstimateControl.tsx` | Estimate selector used by the property rail, the create and draft dialogs and the bulk bar. | `EstimateControl` |
| `work-items/BulkBar.tsx` (185), `selection.ts` (54, pure), `use-selection.ts` (64) | Selection of at most 500 ids: shift-click range, Escape clears, a refresh prunes rows that left, navigation clears. Bar: state, priority, cycle, estimate, dates, add or remove labels, assignees and modules, archive, delete (asks first), copy, move. | `BulkBar`, `useSelection`, `MAX_SELECTION` |
| `work-items/BulkTransferDialog.tsx` (117) | Copy or move the selection to another live project; takes `sourceProjectIds`. Copy may target a source project; Move excludes every source project of the selection; a move asks for confirmation in the dialog. | `BulkTransferDialog`, `transferChoices`, `BULK_TRANSFER_LIMIT` |
| `detail/ProjectTransferDialog.tsx` (101) | Single-item copy or move from the detail's More menu. | `ProjectTransferDialog` |
| `work-items/GroupFooter.tsx` (58) | "Show more" footer and the "N pts" beside a group count (the engine sums the whole group). | `GroupFooter`, `GroupPoints` |

## 3. Data and control flow

### Read path
1. Routes follow the standard shape (sync default export, `<Suspense>`, `await io()`, id validation, one `readTessera`, `notFound()` for NOT_FOUND/VALIDATION).
2. Estimates reach the list through the project bundle (`bundle.estimate`, the active system or null); points progress in cycles, modules and analytics comes from `activeEstimateId`.
3. The sidebar shows the draft count and the unread inbox count from the layout read; the Intake tab count is `countOpenIntake`.

### Write path
1. Intake actions run as the user. `acceptIntakeItem` moves the work item to the chosen or default state, sets `accepted` and logs `intake_accepted`; every intake activity row carries `work_item_id` so open tabs refresh.
2. An agent's `create_work_item` or a copy/move follows `intakeRequired`; `create_intake_item` puts any actor's item straight into Intake (refused with `feature_disabled` while Intake is off).
3. Bulk bar edits apply at once. A refusal (mixed archive) stays in a toast and the selection stays; the transfer dialog keeps itself open on refusal.
4. Moving a draft calls `move_draft_to_project`; a stale label is reported, an empty name refused.

## 4. Invariants and rules the code enforces

| Rule | Decision | Enforced in | Test |
|---|---|---|---|
| Intake status machine; accepted is final (`intake_closed`); snooze must be in the future; duplicate target must not be pending | 61 | `intake.ts` | `tests/intake.test.ts` |
| Intake off refuses `create_intake_item` (`feature_disabled`); agent creates land in triage when required | 27, 62, 64 | `intake.ts`, `intake-policy.ts` | `tests/intake.test.ts`, `tests/intake-policy.test.ts` |
| A new intake item from anyone but user or assistant notifies the user | 62 | `intake-policy.ts` | `tests/intake.test.ts` |
| Per-agent write permission (`access` read, intake, write) is checked once before a tool runs | 63 | `tools/registry/access.ts` | `tests/actor-access.test.ts` |
| Copy and move refuse an item with an open intake item (`intake_pending`); move to the same project refused | 69 | `work-items/transfer.ts` | `tests/work-items.test.ts` (update and bulk update refuse `intake_pending`), `tests/bulk-transfer.test.ts` |
| One active estimate; 2 to 6 values; ascending numbers, unique categories, whole minutes 1 to 10080; an archived system cannot be edited | 65 | `estimates.ts` | `tests/estimates.test.ts`, `tests/ui/estimate-rules.test.ts` |
| Points progress counts only a `points` system | 66 | `estimate-points.ts`, `counts.ts` | `tests/estimates.test.ts` |
| Drafts stay out of search, lists, counts, notifications and the board | 67 | `drafts.ts` | `tests/drafts.test.ts` |
| A draft needs a project before project fields and a name before it becomes a work item | 67 | `drafts.ts` | `tests/drafts.test.ts` |
| Bulk edit is one transaction, at most 500 ids; archive only when every item is completed or cancelled; an id cannot be both added and removed | 68 | `work-items/bulk.ts` | `tests/bulk.test.ts` |
| Bulk transfer: at most 100 ids, all or nothing, move needs `confirm: true`; copy to the source project is allowed | 107 | `bulk-transfer.ts`, `BulkTransferDialog.tsx` | `tests/bulk-transfer.test.ts`, `tests/ui/bulk-transfer-dialog.test.ts` |
| Selection is client state, at most 500, cleared by Escape, navigation and a successful write | 68 | `selection.ts`, `use-selection.ts` | `tests/ui/selection.test.ts` |

## 5. Tests that guard this area

- Engine: `tests/{intake,intake-policy,drafts,estimates,bulk,bulk-transfer,actor-access}.test.ts`.
- UI: `tests/ui/{intake-format,estimate-format,estimate-rules,selection,bulk-transfer-dialog}.test.ts`.
- Playwright: `tests/e2e/intake-drafts-bulk.spec.ts` (an MCP-created item lands in Intake and Accept moves it to Backlog; a closed create dialog saves a draft that becomes a work item; bulk priority on two rows; an estimate system and a point on an item). The 2026-10-22 run passed the intake spec.
- Round 3 Playwright: `coverage-dialogs.spec.ts` (Mark duplicate at 375 and 768: the dialog fits the viewport, the item itself is not offered, confirm stays disabled until a row is picked, every control has a 44x44 hit box at 375, and `get_intake_item` shows status `duplicate`; "Save this draft?" at 375 saves a draft that shows in `/drafts` and `list_drafts`; Tab stays inside the New work item and Add link dialogs and Escape returns focus to the opener), `coverage-touch.spec.ts` (`/drafts` at 375 has no sideways scroll and every control's 44x44 box hits). These passed on the final tree.
- Dialog focus has Vitest in `tests/ui/dialog-focus*.test.ts`; the nested-dialog `restoreFocus` fallback (the "Save draft" dialog as a child, a sibling and a child mounted only while open) has `tests/ui/dialog-focus-fallback.test.ts` as well as the Playwright spec above.
- No Vitest: `IntakeScreen`, `IntakeDetail`, `DuplicateDialog`, `DraftsScreen`, `DraftDialog`, `SaveDraftDialog`, `EstimateDialog`, `EstimatesSettings`, `BulkBar`.

## 6. Extension points

- New bulk action: a field in `BulkUpdateWorkItemsInput` (`bulk.ts`), a control in `BulkBar` and a case in `tests/bulk.test.ts`.
- New estimate type: `EstimateType` in `schemas.ts`, a branch in `validateEstimateValues` and `estimate-rules.ts`, a display case in `estimate-format.ts`, and a decision on `activeEstimateId` (only `points` feeds progress).
- New intake status or source: `IntakeStatus` and `intakeSourceFor`; the tabs are in `intake-format.ts`.
- Selection in other layouts: `LayoutProps` carries the selection; Board and Calendar do not host it.

## 7. Known debt and quirks

- Decision 106 says the "N pts" total is a client sum over loaded items; as built the engine sums the whole group (`estimate_points`, decision 113) and `GroupPoints` only draws it.
- Selection works in List, Table and the archives; the board, calendar and gantt have none.
- Bulk Move excludes every source project of the selection; a workspace view mixes projects, so some selections leave few targets.
- Bulk Copy to the same project is allowed on purpose (the single-item dialog allows it too).
- Time estimates and categories show no group total and feed no progress.
- Intake item `source` input is ignored outside tests; the source comes from the actor kind.
- No browser walk of the estimate replace flow beyond the Playwright spec above. The Intake bar was measured at 1440, 768, 375 and 360 px with and without the assistant (one 44 px row; every control hits its 44x44 box at 375 and 360).

## 8. Where to read more

| Topic | Read |
|---|---|
| Intake, drafts, estimates, bulk | docs/drafts/p8-plan.md, docs/PLAN.md 27, 61–70, 106–107 |
| Tool shapes | docs/contracts/tools.md, `src/lib/tessera/tools/registry/{intake,drafts,estimates,work-items}.ts` |
| Screens | docs/contracts/ui.md |
