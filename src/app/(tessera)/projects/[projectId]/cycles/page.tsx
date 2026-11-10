import { io } from "next/cache";
import { notFound } from "next/navigation";
import { CyclesScreen } from "@/components/planning/CyclesScreen";
import { FeatureOffState } from "@/components/planning/FeatureOffState";
import type { CycleDetailData } from "@/components/planning/types";
import { IdSchema } from "@/lib/tessera/schemas";
import { getProject, isTrackerError, listCycles, readTessera } from "@/lib/tessera/server";
import { loadCycleDetail } from "@/app/(tessera)/projects/[projectId]/cycles/cycle-data";

type Props = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * `instant = false`: this page keeps no Suspense boundary of its own and
 * blocks (decision 156). A client navigation keeps the old page on screen
 * until this one is ready, so React never commits a skeleton and holds the
 * content for 300 ms, and a full load sends the page in the first HTML flush
 * instead of a streamed segment. The opt-out allows the blocking route and
 * turns off dev validation of instant navigation for this segment
 * (`02-route-segment-config/instant.md`).
 */
export const instant = false;

/**
 * Cycles of a project (docs/contracts/ui.md "Routes and data loading"): the
 * non-archived cycles in engine order and, for the current one, its full
 * progress (points too with an active estimate) for the summary card. A
 * project with cycles turned off shows the feature-off state instead.
 * `?create=1` opens the create dialog.
 */
export default function CyclesPage({ params, searchParams }: Props) {
  return <CyclesData params={params} searchParams={searchParams} />;
}

async function CyclesData({ params, searchParams }: Props) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const createOnOpen = query.create === "1";
  await io();
  if (!IdSchema.safeParse(projectId).success) notFound();
  let data: Awaited<ReturnType<typeof loadCycles>>;
  try {
    data = await loadCycles(projectId);
  } catch (err) {
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) notFound();
    throw err;
  }
  if (data === null) return <FeatureOffState feature="cycles" projectId={projectId} />;
  return <CyclesScreen projectId={projectId} cycles={data.cycles} active={data.active} today={data.today} createOnOpen={createOnOpen} />;
}

function loadCycles(projectId: string) {
  return readTessera((ctx) => {
    const project = getProject(ctx, projectId);
    if (!project.cycles_enabled) return null;
    const cycles = listCycles(ctx, projectId, {});
    const current = cycles.find((cycle) => cycle.status === "current");
    const active: CycleDetailData | null = current ? loadCycleDetail(ctx, project, current.id, false) : null;
    return { cycles, active, today: ctx.today() };
  });
}
