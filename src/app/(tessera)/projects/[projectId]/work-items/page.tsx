import { Suspense } from "react";
import { ListSkeleton, ScopedWorkItems } from "./scoped-list";

type Props = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Work items of a project (docs/contracts/ui.md "Work items screen"). The
 * scoped list (./scoped-list.tsx) does the reading: defaults <- saved view
 * settings <- the URL's `q` state, and `?peek=<id>` opens that item next to
 * the list. The cycle and module detail screens render the same list with
 * their own scope.
 */
export default function WorkItemsPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <WorkItemsData params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function WorkItemsData({ params, searchParams }: Props) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  return (
    <ScopedWorkItems
      projectId={projectId}
      scope={{ type: "project", project_id: projectId }}
      settingsScope={{ scope_type: "project", scope_id: projectId }}
      query={query}
    />
  );
}
