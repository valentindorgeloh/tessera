"use client";

/**
 * Work item detail (docs/contracts/ui.md "Detail components (D2)"): one
 * component for the peek card, the modal and the full page. The pinned
 * header bar, then the title, the property rail (a column behind a hairline
 * from 960px on the full page, stacked under the title in the modal and,
 * compact, in the peek), description, sub-items, links and the activity
 * timeline. Registers the entity label (recents, Power K) and the command
 * context for Power K and the item shortcuts; both go away on unmount. A
 * deleted item leaves the recents; an archived one stays there, since its
 * page still opens. Archive and restore (P3, docs/contracts/ui.md "Archives
 * (E3)") sit in the header's More menu; an archived item shows an info
 * Banner with Restore above the title and stays read-only. Must mount inside
 * ProjectProvider.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertDialog } from "@/components/shell/dialogs";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { useClipboard } from "@astryxdesign/core/hooks";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { VersionHistoryDialog } from "@/components/history/VersionHistoryDialog";
import { ProjectTransferDialog } from "@/components/detail/ProjectTransferDialog";
import { copyWorkItemAction } from "@/app/actions/detail";
import { archiveWorkItemAction, deleteWorkItemAction, unarchiveWorkItemAction } from "@/app/actions/work-items";
import { ARCHIVE_OPEN_ITEM_REASON, canArchiveWorkItem } from "@/components/planning/archive-rules";
import { registerCommandContext } from "@/components/shell/command-context";
import { registerEntityLabel } from "@/components/shell/entity-labels";
import { forgetRecentsUnder } from "@/components/shell/recents-store";
import { sendToSuperagentState, sentToSuperagentText } from "@/components/superagent/send-to-superagent";
import { useProject } from "@/components/work-items/project-provider";
import type { WorkItemDetail as WorkItemDetailModel } from "@/lib/tessera/types";
import { PencilIcon, RestoreIcon } from "@/themes/catppuccin/icons";
import { DescriptionEditor } from "./DescriptionEditor";
import { DetailHeader, workItemPath } from "./DetailHeader";
import { LinksList } from "./LinksList";
import { MentionedIn } from "./MentionedIn";
import { PropertyRailFields, type PropertyName } from "./PropertyRail";
import { ReactionBar } from "./ReactionBar";
import { RelationsList } from "./RelationsList";
import { SubItems } from "./SubItems";
// The `.tsx` extension is required here: `timeline.ts` sits beside this file, and a
// case-insensitive volume resolves `./Timeline` to that module before `Timeline.tsx`.
// @ts-expect-error TS5097 — extension import, see the comment above.
import { Timeline } from "./Timeline.tsx";
import type { DetailHost, WorkItemDetailProps } from "./types";
import { useDetailActions, type DetailActions } from "./use-detail-actions";

type TitleProps = {
  item: WorkItemDetailModel;
  host: DetailHost;
  readOnly: boolean;
  actions: DetailActions;
};

/**
 * The name as a heading (it keeps its heading role, so the page has its h1 and
 * the peek its h2, both at the same size, detail.css); an "Edit title" button
 * next to it, or a click on the text, turns it into an input that saves on
 * blur or Enter.
 */
function DetailTitle({ item, host, readOnly, actions }: TitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.name);

  const start = () => {
    if (readOnly) return;
    setDraft(item.name);
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed === "" || trimmed === item.name) return;
    actions.update({ name: trimmed });
  };
  if (editing) {
    return (
      <TextInput
        label="Title"
        isLabelHidden
        size="lg"
        value={draft}
        onChange={setDraft}
        onBlur={commit}
        onEnter={commit}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setDraft(item.name);
            setEditing(false);
          }
        }}
        hasAutoFocus
        className="tessera-detail-title-input"
      />
    );
  }
  return (
    <HStack gap={2} vAlign="start" className="tessera-detail-title-row">
      <Heading level={host === "page" ? 1 : 2} className={readOnly ? "tessera-detail-title tessera-detail-title--readonly" : "tessera-detail-title"} onClick={start}>
        {item.name}
      </Heading>
      {readOnly ? null : (
        <IconButton variant="ghost" size="sm" label="Edit title" icon={<Icon icon={PencilIcon} size="sm" />} onClick={start} className="tessera-detail-title-edit tessera-hit tessera-hit-x" />
      )}
    </HStack>
  );
}

/** Focuses and clicks the first button of a `data-property` wrapper (the P2a ghost selectors open on click); false when the property is not shown. */
function openProperty(root: HTMLElement | null, name: PropertyName): boolean {
  const button = root?.querySelector<HTMLButtonElement>(`[data-property="${name}"] button`);
  if (!button) return false;
  button.focus();
  button.click();
  return true;
}

export function WorkItemDetail({ data, host, onClose, onHostChange, onOpenItem }: WorkItemDetailProps) {
  const { parent, children, activity, currentActorId } = data;
  const router = useRouter();
  const toast = useToast();
  const actions = useDetailActions(data.item, currentActorId);
  // Render from the optimistic view so a rename or a property change shows before the refresh lands.
  const item = actions.view;
  const clipboard = useClipboard({ announce: "Copied" });
  const rootRef = useRef<HTMLDivElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [transfer, setTransfer] = useState<"copy" | "move" | null>(null);
  const { statesById, bundle } = useProject();
  const mentionActors = bundle.actors.filter((actor) => actor.deleted_at === null).map((actor) => ({ id: actor.id, name: actor.name }));
  // An archived project makes its items read-only as an archived item does (F3.4); the item's own Banner and Restore stay for archived items only.
  const itemArchived = item.archived_at !== null;
  const projectArchived = bundle.project.archived_at !== null;
  const readOnly = itemArchived || projectArchived;
  const listPath = `/projects/${item.project_id}/work-items`;
  const canArchive = canArchiveWorkItem(statesById.get(item.state_id)?.state_group);

  const copyItem = () => {
    actions.run(
      () => copyWorkItemAction({ work_item_id: item.id }),
      (copy) => {
        toast({ type: "info", body: `Copied as ${copy.key}` });
        onOpenItem(copy.id);
      },
      "Could not copy the work item",
    );
  };

  // "Send to superagent" (decision 145): the runner treats the superagent's assignment as the request, so a send is an assignment, through the detail's optimistic assignee path (a quick second edit builds on it).
  const send = sendToSuperagentState({ repo: bundle.superagent_repo, actors: bundle.actors, assigneeIds: item.assignee_ids, readOnly });
  const sendToSuperagent = () => {
    if (send.kind !== "ready") return;
    actions.setAssigneesReporting(send.actorIds, "Could not send to the superagent", () => toast({ type: "info", body: sentToSuperagentText(send.repo) }));
  };

  // Archive and restore share one pending flag, so the Banner's Restore shows its spinner and cannot fire twice.
  const [isArchiving, startArchiving] = useTransition();
  const archiveItem = () => {
    startArchiving(async () => {
      const result = await archiveWorkItemAction({ work_item_id: item.id });
      if (result.ok) toast({ type: "info", body: `Archived ${item.key}` });
      else actions.fail(`Could not archive the work item: ${result.message}`);
    });
  };
  const restoreItem = () => {
    if (isArchiving) return;
    startArchiving(async () => {
      const result = await unarchiveWorkItemAction({ work_item_id: item.id });
      if (result.ok) toast({ type: "info", body: `Restored ${item.key}` });
      else actions.fail(`Could not restore the work item: ${result.message}`);
    });
  };

  const deleteItem = () => {
    actions.run(
      () => deleteWorkItemAction({ work_item_id: item.id }),
      () => {
        setConfirmDelete(false);
        forgetRecentsUnder(workItemPath(item));
        forgetRecentsUnder(`/work-items/${item.id}`);
        if (host === "page") router.push(listPath);
        else onClose?.();
      },
      "Could not delete the work item",
    );
  };

  // Recents label and command context for the open item; the label store is never cleared by design.
  const label = `${item.key} ${item.name}`;
  const { id: itemId, key: itemKey, name: itemName, project_id: projectId } = item;
  const { toggleSubscribe, assignMe, isSubscribed } = actions;
  const { copy } = clipboard;
  useEffect(() => {
    registerEntityLabel(itemId, label);
    const url = workItemPath({ id: itemId, project_id: projectId });
    const root = rootRef.current;
    const open = (name: PropertyName, missing = "Not available for this work item") => () => {
      if (!openProperty(root, name)) toast({ type: "info", body: missing });
    };
    return registerCommandContext({
      item: { id: itemId, key: itemKey, title: itemName, projectId, url },
      actions: {
        "item.state": open("state"),
        "item.priority": open("priority"),
        "item.assign": open("assignees"),
        "item.assignMe": assignMe,
        "item.labels": open("labels"),
        "item.cycle": open("cycle", "Cycles are turned off for this project"),
        "item.modules": open("modules", "Modules are turned off for this project"),
        "item.estimate": () => {
          if (!bundle.project.estimates_enabled || bundle.estimate === null) {
            toast({ type: "info", body: "Turn on estimates in project settings" });
            return;
          }
          if (!openProperty(root, "estimate")) toast({ type: "info", body: "Turn on estimates in project settings" });
        },
        // shift+s: a subscriber gets this item's changes in the inbox (decision 54: later comments, assignments and mentions subscribe again).
        "item.subscribe": () => {
          const subscribed = toggleSubscribe();
          toast({ type: "info", body: subscribed ? "Subscribed. Changes to this work item now reach your inbox." : "Unsubscribed" });
        },
        "item.delete": () => setConfirmDelete(true),
        "item.history": () => setHistoryOpen(true),
        "item.copyId": () => void copy(itemKey),
        "item.copyTitle": () => void copy(itemName),
        "item.copyUrl": () => void copy(`${window.location.origin}${url}`),
      },
      labels: { "item.subscribe": isSubscribed ? "Unsubscribe" : "Subscribe" },
    });
  }, [assignMe, bundle.estimate, bundle.project.estimates_enabled, copy, isSubscribed, itemId, itemKey, itemName, label, projectId, toast, toggleSubscribe]);

  return (
    <VStack gap={0} className={`tessera-detail tessera-detail--${host}`} ref={rootRef}>
      <DetailHeader
        item={item}
        parent={parent}
        host={host}
        onClose={onClose}
        onHostChange={onHostChange}
        onOpenItem={onOpenItem}
        onCopyItem={readOnly ? undefined : copyItem}
        onCopyToProject={!readOnly && item.intake?.status !== "pending" ? () => setTransfer("copy") : undefined}
        onMoveToProject={!readOnly && item.intake?.status !== "pending" ? () => setTransfer("move") : undefined}
        onDelete={() => setConfirmDelete(true)}
        onArchive={readOnly ? undefined : archiveItem}
        archiveBlockedReason={readOnly || canArchive ? undefined : ARCHIVE_OPEN_ITEM_REASON}
        onRestore={itemArchived && !projectArchived ? restoreItem : undefined}
        onVersionHistory={() => setHistoryOpen(true)}
        onSendToSuperagent={send.kind === "hidden" ? undefined : sendToSuperagent}
        sendToSuperagentBlockedReason={send.kind === "blocked" ? send.reason : undefined}
      />
      {/* Grid areas (detail.css): title, rail and main stack in one column; the page host from 960px puts the rail in a right column. */}
      <VStack gap={0} className="tessera-detail-body" as="section" aria-label={label}>
        <VStack gap={3} className="tessera-detail-heading">
          {itemArchived ? (
            // The engine refuses unarchive while the project is archived (loadWritableProject throws ARCHIVED), so no Restore then.
            <Banner
              status="info"
              title="This work item is archived"
              description={projectArchived ? "Restore the project to edit it." : "Restore it to edit it."}
              endContent={projectArchived ? undefined : <Button variant="secondary" size="sm" label="Restore" icon={<RestoreIcon />} isLoading={isArchiving} onClick={restoreItem} />}
            />
          ) : null}
          <DetailTitle item={item} host={host} readOnly={readOnly} actions={actions} />
        </VStack>
        <VStack gap={0} className="tessera-detail-rail" as="aside" aria-label="Properties">
          <PropertyRailFields actions={actions} parent={parent} subItems={children} compact={host === "peek"} />
        </VStack>
        <VStack gap={6} className="tessera-detail-main">
          {/* The reactions sit right under the description (decision 57), the relations after the sub-items (decision 55; Plane's widget order). */}
          <VStack gap={2}>
            <DescriptionEditor workItemId={item.id} text={item.description_md} version={item.description_version} readOnly={readOnly} compact={host === "peek"} onOpenItem={onOpenItem} />
            <ReactionBar target="work_item" targetId={item.id} reactions={data.reactions ?? []} currentActorId={currentActorId} readOnly={readOnly} label="Reactions to the description" />
          </VStack>
          <SubItems parent={item} readOnly={readOnly} onOpenItem={onOpenItem}>
            {children}
          </SubItems>
          <RelationsList workItemId={item.id} projectId={item.project_id} relations={data.relations ?? []} readOnly={readOnly} onOpenItem={onOpenItem} />
          <MentionedIn backlinks={data.backlinks ?? []} />
          <LinksList workItemId={item.id} links={item.links} readOnly={readOnly} />
          <Timeline
            workItemId={item.id}
            projectId={item.project_id}
            comments={data.comments ?? []}
            activity={activity}
            readOnly={readOnly}
            currentActorId={currentActorId}
            mentionActors={mentionActors}
            onOpenItem={onOpenItem}
          />
        </VStack>
      </VStack>
      {transfer ? (
        <ProjectTransferDialog
          isOpen
          onOpenChange={(open) => !open && setTransfer(null)}
          mode={transfer}
          workItemId={item.id}
          projectId={item.project_id}
          projects={bundle.projects}
        />
      ) : null}
      <VersionHistoryDialog
        isOpen={historyOpen}
        onOpenChange={setHistoryOpen}
        entity={{ type: "work_item", id: item.id, title: item.key, descriptionVersion: item.description_version, currentText: item.description_md, readOnly }}
      />
      <AlertDialog
        isOpen={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${item.key}?`}
        description="The work item and its sub-items are deleted. The key is not reused."
        actionLabel="Delete"
        actionVariant="destructive"
        onAction={deleteItem}
      />
    </VStack>
  );
}
