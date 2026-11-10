import type { ReactNode } from "react";
import { io } from "next/cache";
import { ProjectFrame } from "@/components/work-items/ProjectFrame";
import { ProjectProvider } from "@/components/work-items/project-provider";
import type { ProjectBundle } from "@/components/work-items/types";
import { agentRepoFor, countOpenIntake, getActiveEstimate, getProject, getWorkspaceSettings, isTrackerError, latestSeq, listActors, listCycles, listLabels, listModules, listProjects, listStates, readTessera } from "@/lib/tessera/server";

type Props = { children: ReactNode; params: Promise<{ projectId: string }> };

/**
 * Project routes (docs/contracts/ui.md "Project routes"): loads the project
 * bundle once per navigation and hands it to every screen below through
 * `ProjectProvider`; the frame draws the header and tabs.
 *
 * `instant = false`: the layout blocks on the project lookup, which streams
 * in under the frame's boundary in `(tessera)/layout.tsx` (no boundary of its
 * own: a navigation from outside the project would commit a frame skeleton
 * and React would hold the content for 300 ms). With the default validation, Next's
 * instant-navigation check still reports the shell's `usePathname()` holes
 * on every route whose page calls `notFound()` (the not-found boundary
 * replaces the page before the validator sees it render); opting the segment
 * out keeps those routes free of dev-only errors.
 */
export const instant = false;

export default function ProjectLayout({ children, params }: Props) {
  return <ProjectShell params={params}>{children}</ProjectShell>;
}

async function ProjectShell({ children, params }: Props) {
  const { projectId } = await params;
  await io();
  let bundle: ProjectBundle;
  try {
    bundle = await readTessera((ctx) => {
      const project = getProject(ctx, projectId);
      const workspace = getWorkspaceSettings(ctx);
      return {
        project,
        states: listStates(ctx, projectId),
        labels: listLabels(ctx, projectId),
        cycles: listCycles(ctx, projectId, {}),
        modules: listModules(ctx, projectId, {}),
        actors: listActors(ctx),
        cursor: latestSeq(ctx),
        today: ctx.today(),
        week_start: workspace.week_start,
        estimate: project.estimates_enabled ? getActiveEstimate(ctx, project.id) : null,
        intake_open: countOpenIntake(ctx, project.id),
        projects: listProjects(ctx, {}).map((row) => ({ id: row.id, name: row.name, identifier: row.identifier })),
        // The repository the superagent works in for this project (decision 151), for "Send to superagent" in the detail.
        superagent_repo: agentRepoFor(workspace.agents, project.id),
      };
    });
  } catch (err) {
    // An unknown or malformed id is a missing page, not a crash. The layout steps aside and renders
    // the page alone: every page below looks the project up as well and calls `notFound()`, which
    // lands in ./not-found.tsx without the frame. Throwing here instead would keep the page segment
    // from rendering, which Next's instant-navigation validator reports as an error in development.
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) return children;
    throw err;
  }
  return (
    <ProjectProvider bundle={bundle}>
      <ProjectFrame>{children}</ProjectFrame>
    </ProjectProvider>
  );
}
