/**
 * Detail components (docs/contracts/ui.md "Detail components (D2)"). The
 * hosts (lane D3) render `WorkItemDetail` with `WorkItemDetailProps`; the
 * rest is exported for screens that need one piece on its own.
 */
export { WorkItemDetail } from "./WorkItemDetail";
export { DescriptionEditor, type DescriptionEditorProps } from "./DescriptionEditor";
export { DetailHeader, workItemPath, type DetailHeaderProps } from "./DetailHeader";
export { PropertyRail, PropertyRailFields, type PropertyName, type PropertyRailFieldsProps, type PropertyRailProps } from "./PropertyRail";
export { ParentPicker, type ParentPickerProps } from "./ParentPicker";
export { SubItems, type SubItemsProps } from "./SubItems";
export { LinksList, type LinksListProps } from "./LinksList";
export { ActivityFeed, ACTIVITY_PREVIEW_COUNT, type ActivityFeedProps } from "./ActivityFeed";
export { describeActivity, formatIsoDate, linkDisplayLabel, linkHost, newestFirst } from "./activity-text";
export { matchWorkItemRef, parentTriggerLabel, toCandidates, type WorkItemCandidate } from "./search-hits";
export { RelativeTime, useHydrated, type RelativeTimeProps } from "./RelativeTime";
export { useDetailActions, useActionRunner, type DetailActions } from "./use-detail-actions";
export { applyPatch, changedFields, isNoopPatch, sameIds, storedIsoDate, toggleId, type DetailFields, type DetailPatch, type OptimisticPatch } from "./patch";
export type { DetailHost, WorkItemDetailData, WorkItemDetailProps } from "./types";
