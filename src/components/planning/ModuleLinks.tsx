"use client";

/**
 * External links of a module (docs/contracts/ui.md "Modules (E2)"): a `List`
 * of Astryx `Link isExternalLink` rows (the link adds its own new-tab icon,
 * `target="_blank"`, `rel` and the new-tab announcement), each with an
 * Edit… / Remove menu; "Add link" opens a small form dialog (URL required and
 * absolute http(s), title optional). On an archived module (`readOnly`) the
 * links still open; add, edit and remove are hidden (the engine would answer
 * ARCHIVED). Failures show an error Toast with the engine's message.
 */
import { useState, useTransition } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@/components/shell/dialogs";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { Link as AstryxLink } from "@astryxdesign/core/Link";
import { List, ListItem } from "@astryxdesign/core/List";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { addModuleLinkAction, removeModuleLinkAction, updateModuleLinkAction } from "@/app/actions/modules";
import type { Link } from "@/lib/tessera/types";
import { PencilIcon, PlusIcon, TrashIcon } from "@/themes/catppuccin/icons";
import { isHttpUrl } from "./module-format";

export type ModuleLinksProps = {
  moduleId: string;
  links: Link[];
  /** Archived module: links open, nothing changes. */
  readOnly: boolean;
};

type LinkDraft = { title: string; url: string };

type Outcome = { ok: true } | { ok: false; message: string };

type LinkDialogProps = {
  title: string;
  isOpen: boolean;
  initial: LinkDraft;
  submitLabel: string;
  onOpenChange: (open: boolean) => void;
  /** Resolves true when the write succeeded, which closes the dialog. */
  onSubmit: (draft: LinkDraft) => Promise<boolean>;
};

function LinkDialog({ isOpen, onOpenChange, ...props }: LinkDialogProps) {
  return (
    // Named explicitly: the Dialog reads its DialogHeader title only when the <dialog> attaches, and the form below mounts later.
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={480} aria-label={props.title}>
      {/* Mounted only while open so every session starts from the given values. */}
      {isOpen ? <LinkForm onOpenChange={onOpenChange} {...props} /> : null}
    </Dialog>
  );
}

function LinkForm({ title, initial, submitLabel, onOpenChange, onSubmit }: Omit<LinkDialogProps, "isOpen">) {
  const [draft, setDraft] = useState<LinkDraft>(initial);
  const [touched, setTouched] = useState(false);
  const [isPending, startTransition] = useTransition();
  const url = draft.url.trim();
  const urlError = url === "" ? "A URL is required" : !isHttpUrl(url) ? "Enter an address that starts with http:// or https://" : null;
  const submit = () => {
    setTouched(true);
    if (urlError || isPending) return;
    startTransition(async () => {
      if (await onSubmit({ title: draft.title.trim(), url })) onOpenChange(false);
    });
  };
  const close = () => {
    if (!isPending) onOpenChange(false);
  };
  return (
    <Layout
      header={<DialogHeader title={title} onOpenChange={close} hasDivider />}
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
        <LayoutFooter>
          <HStack gap={3} hAlign="end">
            <Button variant="ghost" label="Cancel" onClick={close} isDisabled={isPending} />
            <Button variant="primary" label={submitLabel} onClick={submit} isLoading={isPending} />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}

function linkLabel(link: Pick<Link, "title" | "url">): string {
  return link.title || link.url;
}

export function ModuleLinks({ moduleId, links, readOnly }: ModuleLinksProps) {
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [isAdding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Link | null>(null);

  /** Runs a link write; a failure toasts the engine's message and keeps the dialog open. */
  const write = async (call: () => Promise<Outcome>, failed: string): Promise<boolean> => {
    const result = await call();
    if (!result.ok) toast({ type: "error", body: `${failed}: ${result.message}` });
    return result.ok;
  };

  const add = (draft: LinkDraft) => write(() => addModuleLinkAction({ module_id: moduleId, url: draft.url, ...(draft.title ? { title: draft.title } : {}) }), "Could not add the link");

  const save = (link: Link, draft: LinkDraft) => write(() => updateModuleLinkAction({ link_id: link.id, url: draft.url, title: draft.title }), "Could not save the link");

  const remove = (link: Link) => {
    startTransition(async () => {
      await write(() => removeModuleLinkAction({ link_id: link.id }), "Could not remove the link");
    });
  };

  return (
    <VStack gap={2} className="tessera-modules-links">
      <HStack gap={2} vAlign="center" hAlign="between">
        <Text type="label" color="secondary">
          Links{links.length > 0 ? ` (${links.length})` : ""}
        </Text>
        {readOnly ? null : <Button variant="ghost" size="sm" icon={<PlusIcon />} label="Add link" onClick={() => setAdding(true)} />}
      </HStack>
      {links.length === 0 ? (
        <Text type="supporting" color="secondary">
          No links yet
        </Text>
      ) : (
        <List density="compact" aria-label="Module links">
          {links.map((link) => (
            <ListItem
              key={link.id}
              label={
                <AstryxLink href={link.url} isExternalLink maxLines={1}>
                  {linkLabel(link)}
                </AstryxLink>
              }
              endContent={
                readOnly ? undefined : (
                  <MoreMenu
                    label={`Options for ${linkLabel(link)}`}
                    size="sm"
                    alignment="end"
                    items={[
                      { id: "edit", label: "Edit…", icon: <PencilIcon />, onClick: () => setEditing(link) },
                      { id: "remove", label: "Remove", icon: <TrashIcon />, variant: "destructive", onClick: () => remove(link) },
                    ]}
                  />
                )
              }
            />
          ))}
        </List>
      )}
      <LinkDialog title="Add link" isOpen={isAdding} initial={{ title: "", url: "" }} submitLabel="Add link" onOpenChange={setAdding} onSubmit={add} />
      <LinkDialog
        title="Edit link"
        isOpen={editing !== null}
        initial={editing ? { title: editing.title, url: editing.url } : { title: "", url: "" }}
        submitLabel="Save"
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onSubmit={(draft) => (editing ? save(editing, draft) : Promise.resolve(false))}
      />
    </VStack>
  );
}
