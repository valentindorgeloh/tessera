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
import { copyWorkItemAction } from "@/app/actions/detail";
import { archiveWorkItemAction, deleteWorkItemAction, unarchiveWorkItemAction } from "@/app/actions/work-items";
import { ARCHIVE_OPEN_ITEM_REASON, canArchiveWorkItem } from "@/components/planning/archive-rules";
import { registerCommandContext } from "@/components/shell/command-context";
import { registerEntityLabel } from "@/components/shell/entity-labels";
import { forgetRecentsUnder } from "@/components/shell/recents-store";
import { useProject } from "@/components/work-items/project-provider";
import type { WorkItemDetail as WorkItemDetailModel } from "@/lib/tessera/types";
import { PencilIcon, RestoreIcon } from "@/themes/catppuccin/icons";
import { ActivityFeed } from "./ActivityFeed";
import { DescriptionEditor } from "./DescriptionEditor";
import { DetailHeader, workItemPath } from "./DetailHeader";
import { LinksList } from "./LinksList";
import { PropertyRailFields, type PropertyName } from "./PropertyRail";
import { SubItems } from "./SubItems";
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
    <HStack gap={1} vAlign="start" className="tessera-detail-title-row">
      <Heading level={host === "page" ? 1 : 2} className={readOnly ? "tessera-detail-title tessera-detail-title--readonly" : "tessera-detail-title"} onClick={start}>
        {item.name}
      </Heading>
      {readOnly ? null : (
        <IconButton variant="ghost" size="sm" label="Edit title" icon={<Icon icon={PencilIcon} size="sm" />} onClick={start} className="tessera-detail-title-edit" />
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
  const readOnly = item.archived_at !== null;
  const listPath = `/projects/${item.project_id}/work-items`;
  const { statesById } = useProject();
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
        "item.estimate": () => void toast({ type: "info", body: "Arrives in P8" }),
        // shift+s: the subscription works now; the notifications it leads to arrive in P7.
        "item.subscribe": () => {
          const subscribed = toggleSubscribe();
          toast({ type: "info", body: subscribed ? "Subscribed. Notifications arrive in P7" : "Unsubscribed" });
        },
        "item.delete": () => setConfirmDelete(true),
        "item.copyId": () => void copy(itemKey),
        "item.copyTitle": () => void copy(itemName),
        "item.copyUrl": () => void copy(`${window.location.origin}${url}`),
      },
      labels: { "item.subscribe": isSubscribed ? "Unsubscribe" : "Subscribe" },
    });
  }, [assignMe, copy, isSubscribed, itemId, itemKey, itemName, label, projectId, toast, toggleSubscribe]);

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
        onDelete={() => setConfirmDelete(true)}
        onArchive={readOnly ? undefined : archiveItem}
        archiveBlockedReason={readOnly || canArchive ? undefined : ARCHIVE_OPEN_ITEM_REASON}
        onRestore={readOnly ? restoreItem : undefined}
      />
      {/* Grid areas (detail.css): title, rail and main stack in one column; the page host from 960px puts the rail in a right column. */}
      <VStack gap={0} className="tessera-detail-body" as="section" aria-label={label}>
        <VStack gap={3} className="tessera-detail-heading">
          {readOnly ? (
            <Banner
              status="info"
              title="This work item is archived"
              description="Restore it to edit it."
              endContent={<Button variant="secondary" size="sm" label="Restore" icon={<RestoreIcon />} isLoading={isArchiving} onClick={restoreItem} />}
            />
          ) : null}
          <DetailTitle item={item} host={host} readOnly={readOnly} actions={actions} />
        </VStack>
        <VStack gap={0} className="tessera-detail-rail" as="aside" aria-label="Properties">
          <PropertyRailFields actions={actions} parent={parent} subItems={children} compact={host === "peek"} />
        </VStack>
        <VStack gap={6} className="tessera-detail-main">
          <DescriptionEditor workItemId={item.id} text={item.description_md} version={item.description_version} readOnly={readOnly} compact={host === "peek"} onOpenItem={onOpenItem} />
          <SubItems parent={item} readOnly={readOnly} onOpenItem={onOpenItem}>
            {children}
          </SubItems>
          <LinksList workItemId={item.id} links={item.links} readOnly={readOnly} />
          <ActivityFeed entries={activity} />
        </VStack>
      </VStack>
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
