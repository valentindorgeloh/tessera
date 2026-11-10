import { ScopedWorkItems } from "./scoped-list";

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
 * Work items of a project (docs/contracts/ui.md "Work items screen"). The
 * scoped list (./scoped-list.tsx) does the reading: defaults <- saved view
 * settings <- the URL's `q` state, and `?peek=<id>` opens that item next to
 * the list. The cycle and module detail screens render the same list with
 * their own scope.
 */
export default function WorkItemsPage({ params, searchParams }: Props) {
  return <WorkItemsData params={params} searchParams={searchParams} />;
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
