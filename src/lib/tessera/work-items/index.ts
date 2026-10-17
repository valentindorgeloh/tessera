/**
 * Work items (docs/contracts/service-api.md, schema.md "Work items").
 *
 * The human key `WEB-12` is computed from the project identifier and the
 * sequence allocated inside the insert transaction (never reused). Every
 * mutation runs in withTx, validates its input with the schema exported next
 * to it, logs activity per changed field, keeps the FTS row in step and
 * returns the fresh view model. Archived items are read-only except unarchive
 * and delete. assignees.ts builds on the helpers exported here (it imports
 * this module, never the other way round).
 *
 * Intake policy (plan decision 27): when the acting actor is an agent and the
 * project has `intake_enabled` and `agent_intake_required`, every way an
 * agent can put an item into the project (`createWorkItem`, `copyWorkItem`,
 * `moveWorkItemToProject`) lands it in the hidden triage state with a pending
 * intake item, and no state change takes a pending item out of triage: only
 * Intake's accept / decline (P8) does. Cycle membership follows the cycle
 * rules: a completed cycle is read-only except transfer, an archived one
 * except unarchive and delete, so items neither join nor leave them here.
 * `deleteWorkItem` is the one exception: a member of a completed or archived
 * cycle can be deleted (live cycle progress drops, a frozen snapshot stays).
 * Archived modules are read-only too: `createWorkItem` and `syncModules`
 * refuse (ARCHIVED) to add an item to one or remove it from one, and keep the
 * memberships of archived modules that a call leaves unchanged.
 */
export {
  type WorkItemIntake,
  type WorkItem,
  type WorkItemDetail,
  type ListResult,
  type WorkItemListResult,
  getWorkItemRow,
  type LoadedWorkItem,
  loadWritableWorkItem,
} from "./model";
export { loadWorkItem, listSubscriberIds } from "./hydrate";
export {
  getWorkItem,
  getWorkItemByKey,
  listChildren,
  ListScopeSchema,
  type ListScope,
  ListWorkItemsInput,
  type ListWorkItemsInputType,
  listWorkItems,
} from "./read";
export {
  syncLabels,
  syncModules,
  syncAssignees,
  insertSubscriber,
  dropSubscriber,
  SetLabelsInput,
  SetModulesInput,
  setLabels,
  setModules,
} from "./membership";
export { CreateWorkItemInput, type CreateWorkItemInputType, createWorkItem } from "./create";
export {
  UpdateWorkItemInput,
  type UpdateWorkItemInputType,
  updateWorkItem,
  BulkUpdateWorkItemsInput,
  bulkUpdateWorkItems,
  UpdateWorkItemDescriptionInput,
  type UpdateWorkItemDescriptionInputType,
  updateWorkItemDescription,
} from "./update";
export { MoveWorkItemInput, type MoveWorkItemInputType, moveWorkItem } from "./move";
export {
  CopyWorkItemInput,
  type CopyWorkItemInputType,
  copyWorkItem,
  MoveWorkItemToProjectInput,
  type MoveWorkItemToProjectInputType,
  moveWorkItemToProject,
} from "./transfer";
export { archiveWorkItem, unarchiveWorkItem, deleteWorkItem } from "./lifecycle";
