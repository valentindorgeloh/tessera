/**
 * Shared loader for the two page screens (docs/drafts/p6-plan.md "Routes and
 * data loading"). Runs inside `readTessera`. Wiki pages have no labels.
 *
 * ASSUMPTION: the plan's `Actor` is `ActorRow`, which is what `listActors`
 * returns. There is no separate Actor view type.
 */
import { getPage, listActors, listLabels, listProjects, type TesseraContext } from "@/lib/tessera/server";
import type { PageSpaceOption } from "@/components/pages/page-tree";
import type { ActorRow, Label, PageDetail } from "@/lib/tessera/types";

export type PageBundle = {
  page: PageDetail;
  /** Project labels, or null for a wiki page. */
  labels: Label[] | null;
  actors: ActorRow[];
};

export type { PageSpaceOption };

export function loadPageBundle(ctx: TesseraContext, pageId: string): PageBundle {
  const page = getPage(ctx, pageId);
  return {
    page,
    labels: page.project_id === null ? null : listLabels(ctx, page.project_id),
    actors: listActors(ctx),
  };
}

/** Active projects that have Pages on, for the move dialog's space selector. */
export function pageSpaces(ctx: TesseraContext): PageSpaceOption[] {
  return listProjects(ctx)
    .filter((project) => project.pages_enabled && project.archived_at === null)
    .map((project) => ({ id: project.id, name: project.name }));
}
