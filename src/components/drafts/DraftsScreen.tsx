"use client";

/**
 * Workspace drafts. Opening a row or New draft sets `?draft=`. Delete asks
 * first. The dialog sits beside this list.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { useToast } from "@astryxdesign/core/Toast";
import { deleteDraftAction } from "@/app/actions/drafts";
import { AlertDialog } from "@/components/shell/dialogs";
import { PanelBar, PanelHeader, PanelTitle } from "@/components/shell/PanelHeader";
import { RelativeTime } from "@/components/detail/RelativeTime";
import { failureText } from "@/components/planning/archive-rules";
import { ProjectProvider } from "@/components/work-items/project-provider";
import type { ProjectBundle } from "@/components/work-items/types";
import type { DraftView } from "@/lib/tessera/types";
import { DraftIcon, PlusIcon, TrashIcon } from "@/themes/catppuccin/icons";
import { DraftDialog } from "./DraftDialog";

type ProjectOption = { id: string; name: string; identifier: string };

export type DraftsScreenProps = {
  drafts: readonly DraftView[];
  projects: readonly ProjectOption[];
  /** `new`, a draft id, or null when the dialog is closed. */
  draftParam: string | null;
  draft: DraftView | null;
  bundle: ProjectBundle | null;
};

export function DraftsScreen({ drafts, projects, draftParam, draft, bundle }: DraftsScreenProps) {
  const router = useRouter();
  const toast = useToast();
  const [deleting, setDeleting] = useState<DraftView | null>(null);
  const open = draftParam !== null;

  const close = () => router.push("/drafts");

  const remove = async () => {
    if (!deleting) return;
    const result = await deleteDraftAction({ draft_id: deleting.id });
    setDeleting(null);
    if (!result.ok) toast({ type: "error", body: failureText("Could not delete the draft", result.message) });
    else if (draftParam === deleting.id) close();
  };

  const dialog = open ? <DraftDialog isOpen onOpenChange={(next) => !next && close()} draft={draft} projects={projects} /> : null;

  return (
    <>
      <Layout
        height="fill"
        className="tessera-drafts"
        header={
          <PanelHeader label="Drafts">
            <PanelBar start={<PanelTitle>Drafts</PanelTitle>} end={<Button variant="primary" size="sm" label="New draft" icon={<PlusIcon />} onClick={() => router.push("/drafts?draft=new")} />} />
          </PanelHeader>
        }
        content={
          <LayoutContent padding={0} isScrollable label="Drafts">
            {drafts.length === 0 ? (
              <EmptyState title="No drafts" description="Drafts you save from the create dialog show up here." icon={<DraftIcon />} />
            ) : (
              <List hasDividers density="balanced" aria-label="Drafts">
                {drafts.map((item) => (
                  <ListItem
                    key={item.id}
                    onClick={() => router.push(item.project_id ? `/drafts?draft=${item.id}&project=${item.project_id}` : `/drafts?draft=${item.id}`)}
                    startContent={<DraftIcon />}
                    label={item.name.trim() === "" ? "Untitled draft" : item.name}
                    description={
                      <>
                        {item.project ? item.project.name : "No project"} · edited <RelativeTime value={item.updated_at} hasTooltip={false} />
                      </>
                    }
                    endContent={
                      <MoreMenu
                        label={`Actions for ${item.name || "untitled draft"}`}
                        size="sm"
                        items={[
                          { id: "edit", label: "Edit", onClick: () => router.push(item.project_id ? `/drafts?draft=${item.id}&project=${item.project_id}` : `/drafts?draft=${item.id}`) },
                          {
                            id: "move",
                            label: "Move to project",
                            onClick: () => router.push(item.project_id ? `/drafts?draft=${item.id}&project=${item.project_id}` : `/drafts?draft=${item.id}`),
                          },
                          { id: "delete", label: "Delete", icon: TrashIcon, onClick: () => setDeleting(item) },
                        ]}
                      />
                    }
                  />
                ))}
              </List>
            )}
          </LayoutContent>
        }
      />
      {bundle ? <ProjectProvider bundle={bundle}>{dialog}</ProjectProvider> : dialog}
      <AlertDialog
        isOpen={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title="Delete this draft?"
        description="The draft is removed. It does not become a work item."
        actionLabel="Delete"
        actionVariant="destructive"
        onAction={() => void remove()}
      />
    </>
  );
}
