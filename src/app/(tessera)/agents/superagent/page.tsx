import { Suspense } from "react";
import { io } from "next/cache";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { parseRequestId, parseScope, type ProjectOption } from "@/components/superagent/superagent-format";
import { SuperagentScreen } from "@/components/superagent/SuperagentScreen";
import { loadSuperagent } from "@/lib/superagent/server";
import { getWorkspaceSettings, listProjects, readTessera } from "@/lib/tessera/server";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * `/agents/superagent` (decision 145; docs/contracts/ui.md "Superagent
 * control"): the control screen of the runner on this Mac. A static segment,
 * so it wins over `agents/[actorId]`. The search params (`scope`, `request`)
 * are awaited under Suspense, then `io()` before the reads: the runner calls
 * and Tessera's own settings load in parallel.
 */
export default function SuperagentPage({ searchParams }: Props) {
  return (
    <Suspense fallback={<SuperagentSkeleton />}>
      <SuperagentData searchParams={searchParams} />
    </Suspense>
  );
}

async function SuperagentData({ searchParams }: Props) {
  const params = await searchParams;
  await io();
  const scope = parseScope(params.scope);
  const requestId = parseRequestId(params.request);
  const [runner, own] = await Promise.all([
    loadSuperagent({ scope, requestId }),
    readTessera((ctx) => ({
      agents: getWorkspaceSettings(ctx).agents,
      // Live projects first, then archived ones: a mapping to an archived project stays (`setAgentSettings` allows it), so the form must know them.
      projects: [
        ...listProjects(ctx, {}).map((project): ProjectOption => ({ id: project.id, name: project.name, identifier: project.identifier, archived: false })),
        ...listProjects(ctx, { archived: true }).map((project): ProjectOption => ({ id: project.id, name: project.name, identifier: project.identifier, archived: true })),
      ],
    })),
  ]);
  return <SuperagentScreen runner={runner} agents={own.agents} projects={own.projects} scope={scope} requestId={requestId} />;
}

function SuperagentSkeleton() {
  return (
    <VStack gap={3} padding={4} aria-busy="true" aria-label="Loading superagent">
      <Skeleton height="var(--size-element-md)" width="30%" />
      <Skeleton height="var(--size-element-lg)" index={1} />
      <Skeleton height="var(--size-element-lg)" index={2} />
      <Skeleton height="var(--size-element-lg)" index={3} />
    </VStack>
  );
}
