"use client";

/**
 * Client host of the full detail pages (docs/contracts/ui.md "Routes and
 * modes"): `/projects/[projectId]/work-items/[workItemId]` inside the project
 * frame and `/work-items/[workItemId]` outside it. It turns the detail's
 * callbacks into navigations: another item opens as a full page of the same
 * scope, and switching to the side panel or the modal saves that mode and
 * lands on the project's list with `?peek=<id>`.
 */
import { useRouter } from "next/navigation";
import { WorkItemDetail, type DetailHost, type WorkItemDetailData } from "@/components/detail";
import { peekHref } from "@/components/detail/peek-url";
import { savePeekPrefs } from "@/components/detail/peek-prefs";
import { useProject } from "@/components/work-items/project-provider";

export type DetailPageProps = {
  data: WorkItemDetailData;
  /** `project`: inside the project frame; `global`: the frame-less route (no project tabs). */
  scope: "project" | "global";
};

export function DetailPage({ data, scope }: DetailPageProps) {
  const router = useRouter();
  const { bundle } = useProject();
  const listPath = `/projects/${bundle.project.id}/work-items`;

  const onOpenItem = (id: string) => {
    router.push(scope === "project" ? `${listPath}/${id}` : `/work-items/${id}`);
  };

  const onHostChange = (host: DetailHost) => {
    if (host === "page") return;
    savePeekPrefs({ mode: host === "modal" ? "modal" : "side" });
    router.push(peekHref(listPath, null, data.item.id));
  };

  // The detail header carries the trail (Project › Work items › KEY) on both scopes, so the global page adds none of its own.
  return <WorkItemDetail data={data} host="page" onOpenItem={onOpenItem} onHostChange={onHostChange} />;
}
