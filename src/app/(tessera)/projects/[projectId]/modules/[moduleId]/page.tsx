import { Suspense } from "react";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { lookupScoped } from "@/app/(tessera)/projects/[projectId]/scope-lookup";
import { ListSkeleton, ScopedWorkItems } from "@/app/(tessera)/projects/[projectId]/work-items/scoped-list";
import { FeatureOffState } from "@/components/planning/FeatureOffState";
import { ModuleDetailScreen } from "@/components/planning/ModuleDetailScreen";
import type { ItemCandidate, ModuleDetailData } from "@/components/planning/types";
import { IdSchema } from "@/lib/tessera/schemas";
import { currentDigestSeq, getModule, getProject, getStoredDigest, isTrackerError, listWorkItems, readTessera, type TesseraContext } from "@/lib/tessera/server";
import type { GroupBy } from "@/lib/tessera/types";

type Props = {
  params: Promise<{ projectId: string; moduleId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** "Add existing work items" offers at most this many of the project's most recently updated items. */
const CANDIDATE_LIMIT = 500;

/** The module scope never groups by module (every row is in this one). */
const HIDDEN_GROUP_FIELDS: readonly GroupBy[] = ["module"];

/**
 * One module (docs/contracts/ui.md "Routes and data loading"): the project
 * (its `modules_enabled` toggle), the module with members, links and
 * progress, the "Add existing" candidates (skipped for an archived module),
 * today's date and any stored digest in one read; the module's work items
 * stream in below the header through E4's `ScopedWorkItems`. A module of another project, or an
 * unknown, deleted or malformed id, is not found, whether modules are on or
 * off: the module is looked up before the feature toggle (../../scope-lookup.ts),
 * so the shell never records a dead path as a recent.
 */
export default function ModulePage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<ModuleSkeleton />}>
      <ModuleData params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ModuleData({ params, searchParams }: Props) {
  const [{ projectId, moduleId }, query] = await Promise.all([params, searchParams]);
  await io();
  if (!IdSchema.safeParse(projectId).success || !IdSchema.safeParse(moduleId).success) notFound();
  let data: Awaited<ReturnType<typeof loadModule>>;
  try {
    data = await loadModule(projectId, moduleId);
  } catch (err) {
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) notFound();
    throw err;
  }
  if (data.kind === "missing") notFound();
  if (data.kind === "feature_off") return <FeatureOffState feature="modules" projectId={projectId} />;
  const { detail, digest } = data.value;
  const isArchived = detail.module.archived_at !== null;
  return (
    <ModuleDetailScreen projectId={projectId} data={detail} digest={digest}>
      <Suspense fallback={<ListSkeleton />}>
        <ScopedWorkItems
          projectId={projectId}
          scope={{ type: "module", module_id: moduleId }}
          settingsScope={{ scope_type: "module", scope_id: moduleId }}
          query={query}
          scopeDefaults={{ module_ids: [moduleId] }}
          canCreate={!isArchived}
          hiddenGroupFields={HIDDEN_GROUP_FIELDS}
        />
      </Suspense>
    </ModuleDetailScreen>
  );
}

/** The project's most recently updated items without the module's own members (the dialog expects them dropped). */
function loadCandidates(ctx: TesseraContext, projectId: string, memberIds: readonly string[]): ItemCandidate[] {
  const members = new Set(memberIds);
  const result = listWorkItems(ctx, { scope: { type: "project", project_id: projectId }, display: { order_by: "-updated_at" }, limit: CANDIDATE_LIMIT });
  return result.items.filter((item) => !members.has(item.id)).map(({ id, key, name, state_id, cycle_id }) => ({ id, key, name, state_id, cycle_id }));
}

/** The module is read first; `lookupScoped` then tells a missing module from a project with modules turned off. */
function loadModule(projectId: string, moduleId: string) {
  return readTessera((ctx) =>
    lookupScoped(getProject(ctx, projectId), {
      isEnabled: (project) => project.modules_enabled,
      load: (): { detail: ModuleDetailData; digest: ReturnType<typeof getStoredDigest> } => {
        const loaded = getModule(ctx, moduleId);
        const isOpen = loaded.archived_at === null && loaded.project_id === projectId;
        const stored = getStoredDigest(ctx, "module", moduleId);
        const seq = currentDigestSeq(ctx, "module", moduleId);
        return {
          detail: { module: loaded, candidates: isOpen ? loadCandidates(ctx, projectId, loaded.work_item_ids) : [], today: ctx.today() },
          digest: stored === null ? null : { ...stored, is_stale: seq > stored.input_seq },
        };
      },
      projectIdOf: (loaded) => loaded.detail.module.project_id,
    }),
  );
}

function ModuleSkeleton() {
  return (
    <VStack gap={3} padding={5}>
      <HStack gap={2} hAlign="between">
        <Skeleton width={240} height={28} />
        <Skeleton width={200} height={28} index={1} />
      </HStack>
      <Skeleton width={160} height={20} index={2} />
      <Skeleton height={36} index={3} />
      <Skeleton height={36} index={4} />
      <Skeleton height={36} index={5} />
    </VStack>
  );
}
