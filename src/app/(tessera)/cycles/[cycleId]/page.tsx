import { io } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { getCycle, IdSchema, isTrackerError, readTessera } from "@/lib/tessera/server";

type Props = { params: Promise<{ cycleId: string }> };

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
 * `/cycles/[cycleId]` (docs/contracts/ui.md "Integration (E4)"): the target of
 * a `cycle:<id>` editor link, which knows the cycle but not its project. It
 * redirects to `/projects/<project_id>/cycles/<id>`; a malformed or unknown id
 * renders the Tessera not-found screen. The tab is transient, like `/browse/`.
 */
export default function CycleAliasPage({ params }: Props) {
  return <CycleAlias params={params} />;
}

async function CycleAlias({ params }: Props) {
  const { cycleId } = await params;
  await io();
  if (!IdSchema.safeParse(cycleId).success) notFound();
  let projectId: string;
  try {
    projectId = await readTessera((ctx) => getCycle(ctx, cycleId).project_id);
  } catch (err) {
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) notFound();
    throw err;
  }
  // redirect() throws, so it stays outside the try.
  return redirect(`/projects/${projectId}/cycles/${cycleId}`);
}
