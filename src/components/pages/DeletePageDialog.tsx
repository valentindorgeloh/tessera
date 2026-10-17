"use client";

/**
 * Confirms deleting an archived page (docs/drafts/p6-plan.md "DeletePageDialog").
 * Children become top-level and stay archived. The page then leaves both of
 * its recent paths, and the screen returns to the archived list.
 */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@astryxdesign/core/Toast";
import { deletePageAction } from "@/app/actions/pages";
import { AlertDialog } from "@/components/shell/dialogs";
import { forgetRecentsUnder } from "@/components/shell/recents-store";
import type { PageSummary } from "@/lib/tessera/types";
import { pageRecentPaths, pagesListHref } from "./page-tree";

export type DeletePageDialogProps = {
  page: Pick<PageSummary, "id" | "name" | "project_id">;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

export function DeletePageDialog({ page, isOpen, onOpenChange }: DeletePageDialogProps) {
  const router = useRouter();
  const toast = useToast();
  const [isDeleting, startDelete] = useTransition();

  const confirm = () => {
    startDelete(async () => {
      const result = await deletePageAction({ page_id: page.id });
      if (!result.ok) {
        toast({ type: "error", body: `Could not delete ${page.name}. ${result.message}` });
        return;
      }
      for (const path of pageRecentPaths(page)) forgetRecentsUnder(path);
      onOpenChange(false);
      toast({ type: "info", body: `Deleted ${page.name}` });
      router.push(`${pagesListHref(page.project_id)}?tab=archived`);
    });
  };

  return (
    <AlertDialog
      isOpen={isOpen}
      onOpenChange={(open) => !isDeleting && onOpenChange(open)}
      title="Delete page"
      description={`${page.name} is deleted. Its sub-pages move to the top level.`}
      actionLabel="Delete"
      actionVariant="destructive"
      isActionLoading={isDeleting}
      onAction={confirm}
    />
  );
}
