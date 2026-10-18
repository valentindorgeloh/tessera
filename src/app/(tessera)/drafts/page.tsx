import { Suspense } from "react";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { loadProjectBundle } from "@/app/(tessera)/work-items/load-detail";
import { DraftsScreen } from "@/components/drafts/DraftsScreen";
import type { ProjectBundle } from "@/components/work-items/types";
import { IdSchema } from "@/lib/tessera/schemas";
import { getDraft, isTrackerError, listDrafts, listProjects, readTessera } from "@/lib/tessera/server";
import type { DraftView } from "@/lib/tessera/types";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** `/drafts`. `?draft=new` or `?draft=<id>&project=<id>` opens the dialog; the project bundle loads only when a project is chosen. */
export default function DraftsPage({ searchParams }: Props) {
  return (
    <Suspense fallback={<DraftsSkeleton />}>
      <DraftsData searchParams={searchParams} />
    </Suspense>
  );
}

async function DraftsData({ searchParams }: Props) {
  const params = await searchParams;
  const draftParam = typeof params.draft === "string" ? params.draft : null;
  const projectParam = typeof params.project === "string" ? params.project : null;
  await io();
  if (projectParam && !IdSchema.safeParse(projectParam).success) notFound();
  if (draftParam && draftParam !== "new" && !IdSchema.safeParse(draftParam).success) notFound();

  let data: { drafts: DraftView[]; projects: { id: string; name: string; identifier: string }[]; draft: DraftView | null; bundle: ProjectBundle | null };
  try {
    data = await readTessera((ctx) => {
      const drafts = listDrafts(ctx, {}).items;
      const projects = listProjects(ctx, {}).map((project) => ({ id: project.id, name: project.name, identifier: project.identifier }));
      const draft = draftParam && draftParam !== "new" ? getDraft(ctx, draftParam) : null;
      const projectId = projectParam ?? draft?.project_id ?? null;
      const bundle = projectId ? loadProjectBundle(ctx, projectId) : null;
      return { drafts, projects, draft, bundle };
    });
  } catch (err) {
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) notFound();
    throw err;
  }

  return <DraftsScreen drafts={data.drafts} projects={data.projects} draftParam={draftParam} draft={data.draft} bundle={data.bundle} />;
}

function DraftsSkeleton() {
  return (
    <VStack gap={3} padding={4} aria-busy="true" aria-label="Loading drafts">
      <Skeleton height="var(--size-element-md)" width="30%" />
      <Skeleton height="var(--size-element-lg)" index={1} />
      <Skeleton height="var(--size-element-lg)" index={2} />
    </VStack>
  );
}
