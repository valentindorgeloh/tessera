/**
 * Shared UI types for the work-items screens (docs/contracts/ui.md).
 * Client-safe: imports only from "@/lib/tessera/types".
 */
import type {
  ActorRow,
  Cycle,
  Display,
  Filters,
  GroupBy,
  Label,
  Module,
  Project,
  State,
  UpdateWorkItemInputType,
  WorkItemListResult,
} from "@/lib/tessera/types";

/** Everything a project screen needs to render property controls without client-side fetches. */
export type ProjectBundle = {
  project: Project;
  states: State[];
  labels: Label[];
  /** Non-archived cycles. */
  cycles: Cycle[];
  /** Non-archived modules. */
  modules: Module[];
  actors: ActorRow[];
  /** latestSeq at load time; seeds the change poller. */
  cursor: number;
};

/** Input of a drag or keyboard move; mirrors MoveWorkItemInput minus the id. */
export type MoveInput = {
  id: string;
  group_by?: GroupBy | null;
  value?: string | null;
  from_value?: string | null;
  before_id?: string;
  after_id?: string;
};

/** Field-scoped patch for inline edits; same shape as the update_work_item tool input. */
export type UpdateWorkItemPatch = Omit<UpdateWorkItemInputType, "id">;

export type QuickAddGroup = { field: GroupBy | null; value: string | null };

/** Props every layout component (list, board, table, calendar, gantt) receives. */
export type LayoutProps = {
  result: WorkItemListResult;
  display: Display;
  bundle: ProjectBundle;
  onMove: (input: MoveInput) => void;
  onUpdate: (id: string, patch: UpdateWorkItemPatch) => void;
  onOpen: (id: string) => void;
  onQuickAdd: (group: QuickAddGroup, name: string) => void;
};

/** URL state carried in the `q` search param (base64url JSON). */
export type UrlState = {
  filters?: Filters;
  display?: Partial<Display>;
};
