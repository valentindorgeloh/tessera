import { io } from "next/cache";
import { notFound } from "next/navigation";
import { CycleDetailScreen } from "@/components/planning/CycleDetailScreen";
import { FeatureOffState } from "@/components/planning/FeatureOffState";
import { IdSchema } from "@/lib/tessera/schemas";
import { currentDigestSeq, getProject, getStoredDigest, isTrackerError, readTessera } from "@/lib/tessera/server";
import { ScopedWorkItems } from "@/app/(tessera)/projects/[projectId]/work-items/scoped-list";
import { loadCycleDetail } from "@/app/(tessera)/projects/[projectId]/cycles/cycle-data";
import { lookupScoped } from "@/app/(tessera)/projects/[projectId]/scope-lookup";

type Props = {
  params: Promise<{ projectId: string; cycleId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Grouping by cycle means nothing inside one cycle. */
const HIDDEN_GROUP_FIELDS = ["cycle"] as const;

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
 * One cycle (docs/contracts/ui.md "Routes and data loading"): the cycle with
 * its progress (points too with an active estimate), the "Add existing"
 * candidates and any stored digest in one read, then the scoped work items
 * list below the header (no boundary of its own: a fallback committed there
 * would bring the 300 ms hold back for the list, the page's main content). The cycle is looked up before the feature
 * toggle (../../scope-lookup.ts): an unknown, deleted or foreign cycle is not
 * found whether cycles are on or off, so the shell never records it as a
 * recent; only a real cycle of a project with cycles turned off shows the
 * feature-off state.
 */
export default function CyclePage({ params, searchParams }: Props) {
  return <CycleData params={params} searchParams={searchParams} />;
}

async function CycleData({ params, searchParams }: Props) {
  const [{ projectId, cycleId }, query] = await Promise.all([params, searchParams]);
  await io();
  if (!IdSchema.safeParse(projectId).success || !IdSchema.safeParse(cycleId).success) notFound();
  let data: Awaited<ReturnType<typeof loadCycle>>;
  try {
    data = await loadCycle(projectId, cycleId);
  } catch (err) {
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) notFound();
    throw err;
  }
  if (data.kind === "missing") notFound();
  if (data.kind === "feature_off") return <FeatureOffState feature="cycles" projectId={projectId} />;
  const { detail, digest } = data.value;
  const takesItems = detail.cycle.archived_at === null && detail.cycle.status !== "completed";
  return (
    <CycleDetailScreen projectId={projectId} data={detail} digest={digest}>
      <ScopedWorkItems
        projectId={projectId}
        scope={{ type: "cycle", cycle_id: cycleId }}
        settingsScope={{ scope_type: "cycle", scope_id: cycleId }}
        query={query}
        scopeDefaults={{ cycle_id: cycleId }}
        canCreate={takesItems}
        hiddenGroupFields={HIDDEN_GROUP_FIELDS}
      />
    </CycleDetailScreen>
  );
}

function loadCycle(projectId: string, cycleId: string) {
  return readTessera((ctx) =>
    lookupScoped(getProject(ctx, projectId), {
      isEnabled: (project) => project.cycles_enabled,
      load: (project) => {
        const detail = loadCycleDetail(ctx, project, cycleId, true);
        const stored = getStoredDigest(ctx, "cycle", cycleId);
        const seq = currentDigestSeq(ctx, "cycle", cycleId);
        return { detail, digest: stored === null ? null : { ...stored, is_stale: seq > stored.input_seq } };
      },
      projectIdOf: (loaded) => loaded.detail.cycle.project_id,
    }),
  );
}
