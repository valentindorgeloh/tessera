/**
 * Shared planning data shapes (docs/contracts/ui.md "Shared planning pieces"):
 * what the cycle and module detail pages hand to their client screens, and
 * the rows of the "Add existing work items" dialog. Client-safe: type imports
 * from `@/lib/tessera/types` only.
 */
import type { CycleDetail, CycleProgress, ModuleDetail, WorkItem } from "@/lib/tessera/types";

/** A row of the "Add existing work items" dialog, mapped server-side from listWorkItems. */
export type ItemCandidate = Pick<WorkItem, "id" | "key" | "name" | "state_id" | "cycle_id">;

export type CycleDetailData = {
  /** getCycle: status, open_count, progress (issues mode). */
  cycle: CycleDetail;
  /** getCycleProgress(points) when the project has an active estimate, else null. */
  pointsProgress: CycleProgress | null;
  /** [] for completed or archived cycles. */
  candidates: ItemCandidate[];
  /** ctx.today(). */
  today: string;
};

export type ModuleDetailData = { module: ModuleDetail; candidates: ItemCandidate[]; today: string };

export type ProgressTarget = { type: "cycle"; cycle_id: string } | { type: "module"; module_id: string };
