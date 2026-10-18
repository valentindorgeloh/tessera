/**
 * Server-side reads shared by the cycles list and the cycle detail
 * (docs/contracts/ui.md "Routes and data loading"). Runs inside the page's
 * one `readTessera` call; never imported by client code.
 */
import type { CycleDetailData, ItemCandidate } from "@/components/planning/types";
import { getCycle, getCycleProgress, listWorkItems, type TesseraContext } from "@/lib/tessera/server";
import type { Project } from "@/lib/tessera/types";

/** Candidates for "Add existing work items": at most 500, most recently updated first. */
const CANDIDATE_LIMIT = 500;

/** Cycle points follow an active system of type points. Categories and time stay off the chart. */
export function hasActiveEstimate(project: Pick<Project, "estimate_type">): boolean {
  return project.estimate_type === "points";
}

/**
 * Open work items of the project (the engine refuses closed items in a
 * cycle), mapped to dialog rows. The client drops members and items held by
 * a completed or archived cycle.
 */
export function loadCycleCandidates(ctx: TesseraContext, projectId: string): ItemCandidate[] {
  const result = listWorkItems(ctx, {
    scope: { type: "project", project_id: projectId },
    filters: { state_group: ["backlog", "unstarted", "started"] },
    display: { order_by: "-updated_at" },
    limit: CANDIDATE_LIMIT,
  });
  return result.items.map((item) => ({ id: item.id, key: item.key, name: item.name, state_id: item.state_id, cycle_id: item.cycle_id }));
}

/** The detail data of one cycle; candidates only while the cycle takes items (not completed, not archived). */
export function loadCycleDetail(ctx: TesseraContext, project: Project, cycleId: string, withCandidates: boolean): CycleDetailData {
  const cycle = getCycle(ctx, cycleId);
  const pointsProgress = hasActiveEstimate(project) ? getCycleProgress(ctx, cycleId, { mode: "points" }) : null;
  const takesItems = cycle.archived_at === null && cycle.status !== "completed";
  const candidates = withCandidates && takesItems && cycle.project_id === project.id ? loadCycleCandidates(ctx, project.id) : [];
  return { cycle, pointsProgress, candidates, today: ctx.today() };
}
