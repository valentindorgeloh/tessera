/**
 * Detail panel data and host types (docs/contracts/ui.md "Detail components (D2)").
 * Client-safe: type-only imports from "@/lib/tessera/types". Lane D3's server
 * helper `loadWorkItemDetail(ctx, id)` fills `WorkItemDetailData`; the
 * components here code against the shape.
 */
import type { ActivityLogEntry, WorkItem, WorkItemDetail } from "@/lib/tessera/types";

export type WorkItemDetailData = {
  /** WorkItem & { subscriber_ids, links: WorkItemLinkRow[] }. */
  item: WorkItemDetail;
  /** getWorkItem(ctx, item.parent_id), or null for a top-level item. */
  parent: Pick<WorkItem, "id" | "key" | "name"> | null;
  /** listChildren(ctx, id) in sequence order. */
  children: WorkItem[];
  /** listActivity(ctx, { work_item_id: id }), newest first. */
  activity: ActivityLogEntry[];
  /** USER_ACTOR_ID, filled server-side ("assign me", the subscribe toggle). */
  currentActorId: string;
  /** latestSeq at load. */
  cursor: number;
};

export type DetailHost = "peek" | "modal" | "page";

export type WorkItemDetailProps = {
  data: WorkItemDetailData;
  host: DetailHost;
  /** Peek and modal. */
  onClose?: () => void;
  /** The mode switcher in the header. */
  onHostChange?: (host: DetailHost) => void;
  /** Parent, sub-item and `#` link: the host decides (peek replaces ?peek, page pushes). */
  onOpenItem: (id: string) => void;
};
