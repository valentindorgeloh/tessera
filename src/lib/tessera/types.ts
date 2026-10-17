/**
 * Tessera shared types. Client-safe: types and enum unions only (every import
 * is `import type`, so no database code reaches a client bundle).
 * Row types are inferred from the Drizzle tables in db/schema.ts.
 */
import type { z } from "zod";
import type {
  ActorKindSchema,
  AiEffortSchema,
  AiStatusSchema,
  AssistantScopeSchema,
  AssistMessageSchema,
  AssistRequestSchema,
  CalendarDisplaySchema,
  CycleProgressSchema,
  CycleStatusSchema,
  DateFilterSchema,
  DigestKindSchema,
  DigestViewSchema,
  DisplayPropertiesSchema,
  DisplaySchema,
  EstimateTypeSchema,
  ExportFormatSchema,
  ExportScopeSchema,
  ExportStatusSchema,
  FavoriteEntityTypeSchema,
  FiltersSchema,
  GroupBySchema,
  HomeWidgetsSchema,
  IntakeSourceSchema,
  IntakeStatusSchema,
  LayoutSchema,
  LinkMetadataSchema,
  LogoSchema,
  ModuleStatusSchema,
  OrderBySchema,
  PageAccessSchema,
  PaletteColorSchema,
  PointsCountsSchema,
  PrioritySchema,
  ProposalErrorSchema,
  ProposalPreviewSchema,
  ProposalSourceSchema,
  ProposalStatusSchema,
  ProposalViewSchema,
  ProgressBreakdownRowSchema,
  ProgressCountsSchema,
  ProgressModeSchema,
  RelationTypeSchema,
  StateGroupSchema,
  SubGroupBySchema,
  ViewSettingsScopeSchema,
  WebhookEventsSchema,
  WorkItemTypeFilterSchema,
  WorkspaceAiSettingsSchema,
} from "./schemas";
import type * as tables from "./db/schema";

export type ActorKind = z.infer<typeof ActorKindSchema>;
export type StateGroup = z.infer<typeof StateGroupSchema>;
export type Priority = z.infer<typeof PrioritySchema>;
export type ModuleStatus = z.infer<typeof ModuleStatusSchema>;
export type CycleStatus = z.infer<typeof CycleStatusSchema>;
export type RelationType = z.infer<typeof RelationTypeSchema>;
export type IntakeStatus = z.infer<typeof IntakeStatusSchema>;
export type IntakeSource = z.infer<typeof IntakeSourceSchema>;
export type EstimateType = z.infer<typeof EstimateTypeSchema>;
export type PaletteColor = z.infer<typeof PaletteColorSchema>;
export type Layout = z.infer<typeof LayoutSchema>;
export type PageAccess = z.infer<typeof PageAccessSchema>;
export type ViewSettingsScope = z.infer<typeof ViewSettingsScopeSchema>;
export type FavoriteEntityType = z.infer<typeof FavoriteEntityTypeSchema>;

/** Error codes thrown by the service layer as TrackerError (docs/contracts/service-api.md). */
export type TrackerErrorCode = "NOT_FOUND" | "VALIDATION" | "CONFLICT" | "RULE" | "ARCHIVED" | "LOCKED" | "BUSY";

/** Human key of a work item, e.g. "WEB-12". */
export type WorkItemKey = `${string}-${number}`;

// ---------------------------------------------------------------------------
// JSON column shapes
// ---------------------------------------------------------------------------
export type Logo = z.infer<typeof LogoSchema>;
export type DateFilter = z.infer<typeof DateFilterSchema>;
export type WorkItemTypeFilter = z.infer<typeof WorkItemTypeFilterSchema>;
export type Filters = z.infer<typeof FiltersSchema>;
export type { RichFilterCondition, RichFilters } from "./schemas";
export type GroupBy = z.infer<typeof GroupBySchema>;
export type SubGroupBy = z.infer<typeof SubGroupBySchema>;
export type OrderBy = z.infer<typeof OrderBySchema>;
export type DisplayProperties = z.infer<typeof DisplayPropertiesSchema>;
export type CalendarDisplay = z.infer<typeof CalendarDisplaySchema>;
export type Display = z.infer<typeof DisplaySchema>;
export type ProgressCounts = z.infer<typeof ProgressCountsSchema>;
/** ProgressCounts summed in estimate points (fractional values allowed). */
export type PointsCounts = z.infer<typeof PointsCountsSchema>;
/** One assignee or label row of a progress breakdown; `id: null` = no assignee / no labels. */
export type ProgressBreakdownRow = z.infer<typeof ProgressBreakdownRowSchema>;
/** "issues" counts items, "points" sums estimate point values. */
export type ProgressMode = z.infer<typeof ProgressModeSchema>;
export type CycleProgress = z.infer<typeof CycleProgressSchema>;
export type LinkMetadata = z.infer<typeof LinkMetadataSchema>;
export type HomeWidgets = z.infer<typeof HomeWidgetsSchema>;
export type AiEffort = z.infer<typeof AiEffortSchema>;
export type WorkspaceAiSettings = z.infer<typeof WorkspaceAiSettingsSchema>;
export type ExportScope = z.infer<typeof ExportScopeSchema>;
export type ExportFormat = z.infer<typeof ExportFormatSchema>;
export type ExportStatus = z.infer<typeof ExportStatusSchema>;
export type WebhookEvents = z.infer<typeof WebhookEventsSchema>;

// ---------------------------------------------------------------------------
// AI (P5): client-safe wire shapes. The zod schemas live in schemas.ts.
// ---------------------------------------------------------------------------
export type { AssistantEvent } from "./schemas";
export type AssistantScope = z.infer<typeof AssistantScopeSchema>;
export type AssistMessage = z.infer<typeof AssistMessageSchema>;
export type AssistRequest = z.infer<typeof AssistRequestSchema>;
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;
export type ProposalSource = z.infer<typeof ProposalSourceSchema>;
export type ProposalPreview = z.infer<typeof ProposalPreviewSchema>;
/** A stored assistant proposal; `input` is the validated tool input Apply runs. */
export type ProposalView = z.infer<typeof ProposalViewSchema>;
/** Result of applying one proposal; `pending` means it was left alone (e.g. a destructive one without confirmation). */
export type ApplyOutcome = {
  id: string;
  status: "applied" | "failed" | "pending";
  error?: z.infer<typeof ProposalErrorSchema>;
  data?: unknown;
};
export type DigestKind = z.infer<typeof DigestKindSchema>;
/** A stored cycle or module digest; `is_stale` once newer activity exists. */
export type DigestView = z.infer<typeof DigestViewSchema>;
/** `GET /api/ai/status`; every AI entry point stays hidden unless `available` is true. */
export type AiStatus = z.infer<typeof AiStatusSchema>;

// ---------------------------------------------------------------------------
// Row types (Drizzle select and insert models), one pair per table
// ---------------------------------------------------------------------------
export type ActorRow = typeof tables.actor.$inferSelect;
export type ActorInsert = typeof tables.actor.$inferInsert;
export type ProjectRow = typeof tables.project.$inferSelect;
export type ProjectInsert = typeof tables.project.$inferInsert;
export type StateRow = typeof tables.state.$inferSelect;
export type StateInsert = typeof tables.state.$inferInsert;
export type LabelRow = typeof tables.label.$inferSelect;
export type LabelInsert = typeof tables.label.$inferInsert;
export type WorkItemRow = typeof tables.work_item.$inferSelect;
export type WorkItemInsert = typeof tables.work_item.$inferInsert;
export type WorkItemLabelRow = typeof tables.work_item_label.$inferSelect;
export type WorkItemLabelInsert = typeof tables.work_item_label.$inferInsert;
export type WorkItemModuleRow = typeof tables.work_item_module.$inferSelect;
export type WorkItemModuleInsert = typeof tables.work_item_module.$inferInsert;
export type WorkItemAssigneeRow = typeof tables.work_item_assignee.$inferSelect;
export type WorkItemAssigneeInsert = typeof tables.work_item_assignee.$inferInsert;
export type WorkItemSubscriberRow = typeof tables.work_item_subscriber.$inferSelect;
export type WorkItemSubscriberInsert = typeof tables.work_item_subscriber.$inferInsert;
export type CycleRow = typeof tables.cycle.$inferSelect;
export type CycleInsert = typeof tables.cycle.$inferInsert;
export type ModuleRow = typeof tables.moduleTable.$inferSelect;
export type ModuleInsert = typeof tables.moduleTable.$inferInsert;
export type ModuleMemberRow = typeof tables.module_member.$inferSelect;
export type ModuleMemberInsert = typeof tables.module_member.$inferInsert;
export type ModuleLinkRow = typeof tables.module_link.$inferSelect;
export type ModuleLinkInsert = typeof tables.module_link.$inferInsert;
export type WorkItemLinkRow = typeof tables.work_item_link.$inferSelect;
export type WorkItemLinkInsert = typeof tables.work_item_link.$inferInsert;
export type ViewRow = typeof tables.view.$inferSelect;
export type ViewInsert = typeof tables.view.$inferInsert;
export type ViewSettingsRow = typeof tables.view_settings.$inferSelect;
export type ViewSettingsInsert = typeof tables.view_settings.$inferInsert;
export type ActivityRow = typeof tables.activity.$inferSelect;
export type ActivityInsert = typeof tables.activity.$inferInsert;
export type PageRow = typeof tables.page.$inferSelect;
export type PageInsert = typeof tables.page.$inferInsert;
export type PageLabelRow = typeof tables.page_label.$inferSelect;
export type PageLabelInsert = typeof tables.page_label.$inferInsert;
export type PageVersionRow = typeof tables.page_version.$inferSelect;
export type PageVersionInsert = typeof tables.page_version.$inferInsert;
export type PageEmbedRow = typeof tables.page_embed.$inferSelect;
export type PageEmbedInsert = typeof tables.page_embed.$inferInsert;
export type WorkItemRelationRow = typeof tables.work_item_relation.$inferSelect;
export type WorkItemRelationInsert = typeof tables.work_item_relation.$inferInsert;
export type CommentRow = typeof tables.comment.$inferSelect;
export type CommentInsert = typeof tables.comment.$inferInsert;
export type CommentReactionRow = typeof tables.comment_reaction.$inferSelect;
export type CommentReactionInsert = typeof tables.comment_reaction.$inferInsert;
export type WorkItemReactionRow = typeof tables.work_item_reaction.$inferSelect;
export type WorkItemReactionInsert = typeof tables.work_item_reaction.$inferInsert;
export type MentionRow = typeof tables.mention.$inferSelect;
export type MentionInsert = typeof tables.mention.$inferInsert;
export type NotificationRow = typeof tables.notification.$inferSelect;
export type NotificationInsert = typeof tables.notification.$inferInsert;
export type DraftWorkItemRow = typeof tables.draft_work_item.$inferSelect;
export type DraftWorkItemInsert = typeof tables.draft_work_item.$inferInsert;
export type IntakeRow = typeof tables.intake.$inferSelect;
export type IntakeInsert = typeof tables.intake.$inferInsert;
export type IntakeItemRow = typeof tables.intake_item.$inferSelect;
export type IntakeItemInsert = typeof tables.intake_item.$inferInsert;
export type EstimateRow = typeof tables.estimate.$inferSelect;
export type EstimateInsert = typeof tables.estimate.$inferInsert;
export type EstimatePointRow = typeof tables.estimate_point.$inferSelect;
export type EstimatePointInsert = typeof tables.estimate_point.$inferInsert;
export type FavoriteFolderRow = typeof tables.favorite_folder.$inferSelect;
export type FavoriteFolderInsert = typeof tables.favorite_folder.$inferInsert;
export type FavoriteRow = typeof tables.favorite.$inferSelect;
export type FavoriteInsert = typeof tables.favorite.$inferInsert;
export type RecentVisitRow = typeof tables.recent_visit.$inferSelect;
export type RecentVisitInsert = typeof tables.recent_visit.$inferInsert;
export type StickyRow = typeof tables.sticky.$inferSelect;
export type StickyInsert = typeof tables.sticky.$inferInsert;
export type QuickLinkRow = typeof tables.quick_link.$inferSelect;
export type QuickLinkInsert = typeof tables.quick_link.$inferInsert;
export type WorkspaceSettingsRow = typeof tables.workspace_settings.$inferSelect;
export type WorkspaceSettingsInsert = typeof tables.workspace_settings.$inferInsert;
export type WorkItemVersionRow = typeof tables.work_item_version.$inferSelect;
export type WorkItemVersionInsert = typeof tables.work_item_version.$inferInsert;
export type ExportJobRow = typeof tables.export_job.$inferSelect;
export type ExportJobInsert = typeof tables.export_job.$inferInsert;
export type WebhookRow = typeof tables.webhook.$inferSelect;
export type WebhookInsert = typeof tables.webhook.$inferInsert;
export type WebhookDeliveryRow = typeof tables.webhook_delivery.$inferSelect;
export type WebhookDeliveryInsert = typeof tables.webhook_delivery.$inferInsert;
export type AutomationLeaseRow = typeof tables.automation_lease.$inferSelect;
export type AutomationLeaseInsert = typeof tables.automation_lease.$inferInsert;

// ---------------------------------------------------------------------------
// View models and input types, re-exported type-only so client code can import
// every engine type from "@/lib/tessera/types" without touching the modules
// that load the database. Type re-exports are erased at compile time.
// ---------------------------------------------------------------------------
export type {
  Project,
  ProjectCounts,
  ListProjectsInputType,
  ProjectFeaturesInputType,
  CreateProjectInputType,
  UpdateProjectInputType,
} from "./projects";
export type { State, CreateStateInputType, UpdateStateInputType, ReorderStateInputType, DeleteStateInputType } from "./states";
export type { Label, CreateLabelInputType, UpdateLabelInputType, ReorderLabelInputType } from "./labels";
export type {
  WorkItem,
  WorkItemDetail,
  WorkItemIntake,
  ListResult,
  WorkItemListResult,
  ListScope,
  ListWorkItemsInputType,
  CreateWorkItemInputType,
  UpdateWorkItemInputType,
  UpdateWorkItemDescriptionInputType,
  MoveWorkItemInputType,
  CopyWorkItemInputType,
  MoveWorkItemToProjectInputType,
} from "./work-items";
export type { Group, GroupableItem, GroupOptions } from "./filters";
// P3: Cycle and CycleDetail carry `open_count: number` (open members a transfer would move);
// Cycle.progress (CycleProgressSummary) is `{ total, completed, cancelled }`.
export type {
  Cycle,
  CycleDetail,
  CycleProgressSummary,
  CycleProgressMode,
  ListCyclesInputType,
  CreateCycleInputType,
  UpdateCycleInputType,
  TransferCycleWorkItemsInputType,
} from "./cycles";
export type {
  Module,
  ModuleDetail,
  ModuleProgress,
  ListModulesInputType,
  CreateModuleInputType,
  UpdateModuleInputType,
} from "./modules";
export type { Link, LinkParentType, AddLinkInputType, UpdateLinkInputType } from "./links";
export type { View, ListViewsInputType, CreateViewInputType, UpdateViewInputType } from "./views";
export type { ViewSettings, DisplayPatch, DisplayPatchInput, DisplayPropertyKey } from "./view-settings";
export type { Counts, CountsScope } from "./counts";
export type { SearchHit, SearchType } from "./search";
export type { Change, ChangesResult, ActivityLogEntry } from "./changes";
export type { ActivityVerb } from "./activity";
export type { ToolName, ToolInput, ToolOutput } from "./tools/registry";
