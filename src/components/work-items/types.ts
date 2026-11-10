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
  OrderBy,
  Priority,
  RichFilters,
  EstimateView,
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
  /** Server local date at load (decision 6); `formatShortDate` reads it. */
  today: string;
  /**
   * The workspace's first weekday (0 Sunday … 6 Saturday) at load. The calendar and the date
   * pickers use it for server HTML and the first paint; the settings store takes over once published.
   */
  week_start?: number;
  /** The active estimate system, or null while Estimates are off or none exists. */
  estimate: EstimateView | null;
  /** Open intake items, for the project tab badge. Zero while Intake is off. */
  intake_open: number;
  /** Live projects, for copy and move. */
  projects: readonly { id: string; name: string; identifier: string }[];
  /**
   * Repository the superagent works in for this project (decision 150), or null when it is not
   * mapped. Only the project layout and `loadProjectBundle` fill it; other bundles leave it out
   * and the detail then has no "Send to superagent" row.
   */
  superagent_repo?: string | null;
};

/** Input of a drag or keyboard move; mirrors MoveWorkItemInput minus the id. */
export type MoveInput = {
  id: string;
  group_by?: GroupBy | null;
  value?: string | null;
  from_value?: string | null;
  before_id?: string;
  after_id?: string;
  sub_group_by?: GroupBy;
  sub_value?: string | null;
  sub_from_value?: string | null;
};

/** Field-scoped patch for inline edits; same shape as the update_work_item tool input. */
export type UpdateWorkItemPatch = Omit<UpdateWorkItemInputType, "id">;

export type QuickAddGroup = { field: GroupBy | null; value: string | null };

/**
 * The view_settings row a list reads and saves (decision 23): the project list
 * uses `{ "project", projectId }`, a cycle `{ "cycle", cycleId }`, a module
 * `{ "module", moduleId }`. Re-exported by the scoped list (scoped-list.tsx).
 */
export type SettingsScope = {
  scope_type: "project" | "cycle" | "module" | "workspace" | "profile";
  scope_id: string;
};

/** Memberships new items of a scoped list join: the cycle, the module(s). */
export type ScopeDefaults = { cycle_id?: string; module_ids?: string[]; state_id?: string; priority?: Priority; label_ids?: string[]; assignee_ids?: string[] };

/** Props every layout component (list, board, table, calendar, gantt) receives. */
export type LayoutProps = {
  result: WorkItemListResult;
  display: Display;
  bundle: ProjectBundle;
  onMove: (input: MoveInput) => void;
  onUpdate: (id: string, patch: UpdateWorkItemPatch) => void;
  onOpen: (id: string) => void;
  /** Absent when the list cannot create items (a completed or archived cycle, an archived module). */
  onQuickAdd?: (group: QuickAddGroup, name: string) => void;
  /** Whether a group or column shows its quick-add row; absent = always. */
  canQuickAdd?: (group: QuickAddGroup) => boolean;
  /** Archived project: no create, no drag, read-only controls; default false. */
  readOnly?: boolean;
  /** Workspace lists add a Project column. Ignored by the list and the board. */
  showProject?: boolean;
  /** Row checkboxes. Absent on the board and on a read-only or locked list. */
  selection?: {
    selected: ReadonlySet<string>;
    onToggle: (id: string, shift: boolean) => void;
    onToggleIds: (ids: readonly string[], on: boolean) => void;
  };
  /** Load the next page of a group (decision 112). */
  onLoadMore?: (groupId: string, subGroupId?: string) => void;
  /** Load the next page of an ungrouped list. */
  onLoadMoreUngrouped?: () => void;
  /** Which group key (`id` or `id/sub`) is fetching. */
  isLoadingMore?: (key: string) => boolean;
  /** Table header sort: set `display.order_by` (URL and saved settings); the server re-orders the whole list. */
  onOrderChange?: (orderBy: OrderBy) => void;
  /**
   * Present while a filter, a search or an Advanced tree is active: the list, board and table then show the
   * no-results state (with a "Clear filters" button calling this) instead of the first-run one when nothing matches.
   */
  onClearFilters?: () => void;
};

/** URL state carried in the `q` search param (base64url JSON). */
export type UrlState = {
  filters?: Filters;
  display?: Partial<Display>;
  /** Absent keeps a view's saved tree. Null clears it for this listing. */
  rich_filters?: RichFilters | null;
};

/** Scope of a project, cycle or module list (matches `list_work_items` scope). */
export type WorkItemsScope =
  | { type: "project"; project_id: string }
  | { type: "cycle"; cycle_id: string }
  | { type: "module"; module_id: string };
