"use client";

/**
 * External links of a work item (docs/contracts/ui.md "LinksList"): the
 * title or the URL's host as the label, opened in a new tab; add and edit
 * through a small dialog with title and URL, remove from the row menu. Writes
 * go through `addLinkAction`, `updateLinkAction` and `removeLinkAction`.
 * On an archived item (`readOnly`) the links still open; add, edit and
 * remove are hidden (the engine would answer ARCHIVED).
 */
import { useState, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@/components/shell/dialogs";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Icon } from "@astryxdesign/core/Icon";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { Link } from "@astryxdesign/core/Link";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { addLinkAction, removeLinkAction, updateLinkAction } from "@/app/actions/detail";
import type { WorkItemLinkRow } from "@/lib/tessera/types";
import { LinkIcon, PlusIcon } from "@/themes/catppuccin/icons";
import { linkDisplayLabel, linkHost } from "./activity-text";
import { useActionRunner } from "./use-detail-actions";

export type LinksListProps = {
  workItemId: string;
  links: WorkItemLinkRow[];
  /** Archived item: links open, nothing changes. */
  readOnly?: boolean;
};

type LinkDraft = { title: string; url: string };

/** Same rule as the engine's LINK_URL: an absolute http(s) URL without whitespace. */
export function isHttpUrl(value: string): boolean {
  if (/\s/.test(value) || !/^https?:\/\//i.test(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

type LinkDialogProps = {
  title: string;
  isOpen: boolean;
  initial: LinkDraft;
  submitLabel: string;
  onOpenChange: (isOpen: boolean) => void;
  onSubmit: (draft: LinkDraft) => void;
};

function LinkDialog({ title, isOpen, initial, submitLabel, onOpenChange, onSubmit }: LinkDialogProps) {
  return (
    // Named explicitly: the Dialog reads its DialogHeader title only when the <dialog> attaches, and the form below mounts later.
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={480} aria-label={title}>
      {/* Mounted only while open so every session starts from the given values. */}
      {isOpen ? <LinkForm title={title} initial={initial} submitLabel={submitLabel} onOpenChange={onOpenChange} onSubmit={onSubmit} /> : null}
    </Dialog>
  );
}

function LinkForm({ title, initial, submitLabel, onOpenChange, onSubmit }: Omit<LinkDialogProps, "isOpen">) {
  const [draft, setDraft] = useState<LinkDraft>(initial);
  const [touched, setTouched] = useState(false);
  const url = draft.url.trim();
  const urlError = url === "" ? "A URL is required" : !isHttpUrl(url) ? "Enter an absolute http(s) URL" : null;
  const submit = () => {
    setTouched(true);
    if (urlError) return;
    onSubmit({ title: draft.title.trim(), url });
  };
  return (
    <Layout
      header={<DialogHeader title={title} onOpenChange={onOpenChange} />}
      content={
        <LayoutContent>
          <FormLayout>
            <TextInput
              label="URL"
              value={draft.url}
              onChange={(value) => setDraft((previous) => ({ ...previous, url: value }))}
              placeholder="https://"
              isRequired
              hasAutoFocus
              onEnter={submit}
              status={touched && urlError ? { type: "error", message: urlError } : undefined}
            />
            <TextInput
              label="Title"
              value={draft.title}
              onChange={(value) => setDraft((previous) => ({ ...previous, title: value }))}
              placeholder="Shown instead of the address"
              isOptional
              onEnter={submit}
            />
          </FormLayout>
        </LayoutContent>
      }
      footer={
        <LayoutFooter hasDivider>
          <HStack gap={2} hAlign="end">
            <Button variant="ghost" label="Cancel" onClick={() => onOpenChange(false)} />
            <Button variant="primary" label={submitLabel} onClick={submit} />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}

function LinkRow({ link, readOnly, onEdit, onRemove }: { link: WorkItemLinkRow; readOnly: boolean; onEdit: () => void; onRemove: () => void }) {
  const label = linkDisplayLabel(link);
  const host = linkHost(link.url);
  return (
    <HStack gap={2} vAlign="center" className="tessera-detail-row" as="li">
      <Icon icon={LinkIcon} size="sm" color="secondary" />
      <HStack gap={2} vAlign="center" className="tessera-detail-row-name">
        <Link href={link.url} target="_blank" rel="noreferrer" isExternalLink maxLines={1}>
          {label}
        </Link>
        {host && label !== host ? (
          <Text type="supporting" color="secondary" className="tessera-detail-link-host" maxLines={1} hasTruncateTooltip={false}>
            {host}
          </Text>
        ) : null}
      </HStack>
      {readOnly ? null : (
        <MoreMenu
          label={`Link options for ${label}`}
          size="sm"
          items={[
            { id: "edit", label: "Edit", onClick: onEdit },
            { id: "remove", label: "Remove", variant: "destructive", onClick: onRemove },
          ]}
        />
      )}
    </HStack>
  );
}

export function LinksList({ workItemId, links, readOnly = false }: LinksListProps) {
  const { run } = useActionRunner();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<WorkItemLinkRow | null>(null);

  const add = (draft: LinkDraft) => {
    run(
      () => addLinkAction({ work_item_id: workItemId, url: draft.url, ...(draft.title ? { title: draft.title } : {}) }),
      () => setAdding(false),
      "Could not add the link",
    );
  };

  const save = (link: WorkItemLinkRow, draft: LinkDraft) => {
    run(
      () => updateLinkAction({ link_id: link.id, title: draft.title, url: draft.url }),
      () => setEditing(null),
      "Could not save the link",
    );
  };

  const remove = (link: WorkItemLinkRow) => {
    run(() => removeLinkAction({ link_id: link.id }), undefined, "Could not remove the link");
  };

  let body: ReactNode = null;
  if (links.length > 0) {
    body = (
      <VStack gap={0} as="ul" aria-label="Links">
        {links.map((link) => (
          <LinkRow key={link.id} link={link} readOnly={readOnly} onEdit={() => setEditing(link)} onRemove={() => remove(link)} />
        ))}
      </VStack>
    );
  }

  return (
    <VStack gap={2} className="tessera-detail-links">
      <HStack gap={2} vAlign="center" hAlign="between">
        <Text type="label" color="secondary">
          Links{links.length > 0 ? ` (${links.length})` : ""}
        </Text>
        {readOnly ? null : <Button variant="ghost" size="sm" icon={<PlusIcon />} label="Add link" onClick={() => setAdding(true)} />}
      </HStack>
      {body}
      <LinkDialog title="Add link" isOpen={adding} initial={{ title: "", url: "" }} submitLabel="Add" onOpenChange={setAdding} onSubmit={add} />
      <LinkDialog
        title="Edit link"
        isOpen={editing !== null}
        initial={editing ? { title: editing.title, url: editing.url } : { title: "", url: "" }}
        submitLabel="Save"
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onSubmit={(draft) => {
          if (editing) save(editing, draft);
        }}
      />
    </VStack>
  );
}
