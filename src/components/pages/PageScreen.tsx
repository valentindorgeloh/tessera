"use client";

/**
 * One page (docs/drafts/p6-plan.md "PageScreen"). Breadcrumbs, the title, the
 * meta row and the body. Locked and archived pages are read-only. shift+l
 * locks, shift+a toggles access, shift+r archives or restores, and mod+.
 * copies the link.
 *
 * ASSUMPTION: the shell shortcut table has no page chords yet (lane H owns
 * shortcuts.ts). These four are registered with Astryx `useHotkeys` on this
 * screen, which is the same hook the shell's dispatcher is built beside.
 * They stay quiet while a field is focused.
 */
import { useEffect, useState, useTransition } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { BreadcrumbItem, Breadcrumbs } from "@astryxdesign/core/Breadcrumbs";
import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { useClipboard, useHotkeys } from "@astryxdesign/core/hooks";
import { useToast } from "@astryxdesign/core/Toast";
import { archivePageAction, lockPageAction, unarchivePageAction, unlockPageAction, updatePageAction } from "@/app/actions/pages";
import { registerEntityLabel } from "@/components/shell/entity-labels";
import { FavoriteButton } from "@/components/shell/FavoriteButton";
import { PanelBar, PanelHeader, PanelPage } from "@/components/shell/PanelHeader";
import type { ActorRow, Label, PageDetail } from "@/lib/tessera/types";
import { LockControl } from "@/components/shared/LockControl";
import { useOptimisticLock } from "@/components/shared/use-optimistic-lock";
import { DeletePageDialog } from "./DeletePageDialog";
import { PageBodyEditor } from "./PageBodyEditor";
import { PageMeta } from "./PageMeta";
import { PageRowMenu } from "./PageRowMenu";
import { PageTitle } from "./PageTitle";
import { pageHref, pagesListHref, type PageSpaceOption } from "./page-tree";

export type PageScreenProps = {
  page: PageDetail;
  labels: Label[] | null;
  actors: readonly ActorRow[];
  spaces: readonly PageSpaceOption[];
  space: { kind: "wiki" } | { kind: "project"; name: string; archived: boolean };
};

export function PageScreen({ page, labels, actors, spaces, space }: PageScreenProps) {
  const toast = useToast();
  const clipboard = useClipboard({ announce: "Copied" });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const fail = (verb: string, message: string) => toast({ type: "error", body: `Could not ${verb} ${page.name}. ${message}` });
  // Displayed lock state: the server value, flipped at once while a lock or unlock runs.
  const [isLocked, setLocked] = useOptimisticLock(page.is_locked, fail);
  const archived = page.archived_at !== null;
  const projectArchived = space.kind === "project" && space.archived;
  const contentReadOnly = isLocked || archived || projectArchived;
  const listHref = space.kind === "wiki" ? "/wiki" : pagesListHref(page.project_id);

  useEffect(() => {
    registerEntityLabel(page.id, page.name);
  }, [page.id, page.name]);


  const copyLink = () => {
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    void clipboard.copy(`${origin}${pageHref(page)}`);
  };

  const toggleLock = () => {
    if (archived || projectArchived) return;
    if (isLocked) setLocked(false, () => unlockPageAction({ page_id: page.id }));
    else setLocked(true, () => lockPageAction({ page_id: page.id }));
  };

  const toggleAccess = () => {
    if (archived || projectArchived) return;
    startTransition(async () => {
      const result = await updatePageAction({ page_id: page.id, access: page.access === "public" ? "private" : "public" });
      if (!result.ok) fail("change access of", result.message);
    });
  };

  const toggleArchive = () => {
    if (projectArchived) return;
    startTransition(async () => {
      const result = archived ? await unarchivePageAction({ page_id: page.id }) : await archivePageAction({ page_id: page.id });
      if (!result.ok) {
        fail(archived ? "restore" : "archive", result.message);
        return;
      }
      toast({ type: "info", body: archived ? `Restored ${page.name}` : `Archived ${page.name}` });
    });
  };

  const rename = (name: string) => {
    if (name.length > 255) {
      toast({ type: "error", body: "Use at most 255 characters." });
      return;
    }
    startTransition(async () => {
      const result = await updatePageAction({ page_id: page.id, name });
      if (!result.ok) fail("rename", result.message);
    });
  };

  const setLabels = async (labelIds: string[]): Promise<boolean> => {
    const result = await updatePageAction({ page_id: page.id, label_ids: labelIds });
    if (!result.ok) {
      fail("label", result.message);
      return false;
    }
    return true;
  };

  useHotkeys([
    { keys: "shift+l", onPress: toggleLock, isDisabled: archived || projectArchived },
    { keys: "shift+a", onPress: toggleAccess, isDisabled: archived || projectArchived },
    { keys: "shift+r", onPress: toggleArchive, isDisabled: projectArchived },
    { keys: "mod+.", onPress: copyLink },
  ]);

  const mentionActors = actors.filter((actor) => actor.deleted_at === null).map((actor) => ({ id: actor.id, name: actor.name }));

  return (
    <PanelPage
      width="reading"
      header={
        <PanelHeader label={page.name}>
          <PanelBar
            canWrap
            start={
              <Breadcrumbs variant="supporting" label="Page location" className="tessera-page-crumbs">
                <BreadcrumbItem href={listHref}>{space.kind === "wiki" ? "Wiki" : `${space.name} · Pages`}</BreadcrumbItem>
                {page.ancestors.map((ancestor) => (
                  <BreadcrumbItem key={ancestor.id} href={pageHref({ id: ancestor.id, project_id: page.project_id })}>
                    {ancestor.name}
                  </BreadcrumbItem>
                ))}
                <BreadcrumbItem isCurrent>{page.name}</BreadcrumbItem>
              </Breadcrumbs>
            }
            end={
              <HStack gap={1} vAlign="center">
                <FavoriteButton entityType="page" entityId={page.id} />
                <LockControl
                  isLocked={isLocked}
                  onToggle={toggleLock}
                  size="sm"
                  variant="ghost"
                  label={isLocked ? "Unlock page" : "Lock page"}
                  tooltip={isLocked ? "Unlock page" : "Lock page (shift+l)"}
                  isDisabled={archived || projectArchived}
                />
                <PageRowMenu key={page.id} page={page} spaces={spaces} spaceName={space.kind === "project" ? space.name : undefined} includeOpen={false} isDisabled={projectArchived} />
              </HStack>
            }
          />
        </PanelHeader>
      }
    >
      <VStack gap={4} paddingInline={4} paddingBlockStart={5} paddingBlockEnd={10} className="tessera-page">
        {archived ? (
          <Banner
            status="warning"
            title="This page is archived"
            endContent={
              <HStack gap={1}>
                <Button variant="secondary" size="sm" label="Restore" onClick={toggleArchive} isDisabled={projectArchived} />
                <Button variant="secondary" size="sm" label="Delete…" onClick={() => setDeleteId(page.id)} isDisabled={page.is_locked || projectArchived} />
              </HStack>
            }
          />
        ) : null}
        {!archived && isLocked ? (
          <Banner
            status="info"
            title="This page is locked"
            endContent={<Button variant="secondary" size="sm" label="Unlock" onClick={toggleLock} isDisabled={projectArchived} />}
          />
        ) : null}
        <PageTitle key={page.id} name={page.name} readOnly={contentReadOnly} onRename={rename} />
        <PageMeta
          key={page.id}
          page={page}
          labels={labels}
          actors={actors}
          labelsReadOnly={contentReadOnly}
          accessReadOnly={archived || projectArchived}
          onToggleAccess={toggleAccess}
          onLabels={setLabels}
        />
        <PageBodyEditor
          key={page.id}
          pageId={page.id}
          text={page.description_md}
          version={page.description_version}
          readOnly={contentReadOnly}
          projectId={page.project_id}
          mentionActors={mentionActors}
        />
      </VStack>
      <DeletePageDialog page={page} isOpen={deleteId === page.id} onOpenChange={(open) => setDeleteId(open ? page.id : null)} />
    </PanelPage>
  );
}
