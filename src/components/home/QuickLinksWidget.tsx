"use client";

/**
 * Quick links (docs/drafts/p9-plan.md U1): chips in a wrap, reordered with
 * Move left / Move right. Removing a link is not destructive.
 */
import { useState, useTransition } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@/components/shell/dialogs";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Icon } from "@astryxdesign/core/Icon";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { Link } from "@astryxdesign/core/Link";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { addQuickLinkAction, moveQuickLinkAction, removeQuickLinkAction, updateQuickLinkAction } from "@/app/actions/quick-links";
import { LinkSimpleIcon, PlusIcon } from "@/themes/catppuccin/icons";
import { isExternalQuickLink, isQuickLinkUrl, quickLinkLabel, type QuickLinkView } from "./home-format";

export type QuickLinksWidgetProps = { links: QuickLinkView[] };

type Draft = { id: string | null; url: string; title: string };

const EMPTY_DRAFT: Draft = { id: null, url: "", title: "" };

export function QuickLinksWidget({ links }: QuickLinksWidgetProps) {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [, startTransition] = useTransition();

  const fail = (message: string) => toast({ type: "error", body: message });

  const move = (index: number, direction: -1 | 1) => {
    const link = links[index];
    const neighbour = links[index + direction];
    if (!link || !neighbour) return;
    const input = direction < 0 ? { quick_link_id: link.id, before_id: neighbour.id } : { quick_link_id: link.id, after_id: neighbour.id };
    startTransition(async () => {
      const result = await moveQuickLinkAction(input);
      if (!result.ok) fail(`Could not move the link. ${result.message}`);
    });
  };

  const remove = (link: QuickLinkView) => {
    startTransition(async () => {
      const result = await removeQuickLinkAction({ quick_link_id: link.id });
      if (!result.ok) fail(`Could not remove the link. ${result.message}`);
    });
  };

  return (
    <VStack gap={3}>
      <HStack gap={2} vAlign="center" hAlign="between" wrap="wrap">
        <Heading level={4} accessibilityLevel={2}>
          Quick links
        </Heading>
        <Button variant="secondary" size="sm" label="Add link" icon={<PlusIcon />} onClick={() => setDraft(EMPTY_DRAFT)} />
      </HStack>
      {links.length === 0 ? null : (
        <HStack gap={2} wrap="wrap" className="tessera-home-links">
          {links.map((link, index) => (
            <HStack key={link.id} gap={1} vAlign="center" className="tessera-quick-link">
              <Icon icon={LinkSimpleIcon} size="sm" color="secondary" />
              <Link href={link.url} isExternalLink={isExternalQuickLink(link.url)} maxLines={1}>
                {quickLinkLabel(link)}
              </Link>
              <MoreMenu
                label={`Actions for ${quickLinkLabel(link)}`}
                size="sm"
                items={[
                  { id: "edit", label: "Edit", onClick: () => setDraft({ id: link.id, url: link.url, title: link.title }) },
                  { id: "left", label: "Move left", isDisabled: index === 0, onClick: () => move(index, -1) },
                  { id: "right", label: "Move right", isDisabled: index === links.length - 1, onClick: () => move(index, 1) },
                  { id: "remove", label: "Remove", variant: "destructive", onClick: () => remove(link) },
                ]}
              />
            </HStack>
          ))}
        </HStack>
      )}
      <QuickLinkDialog
        draft={draft}
        onOpenChange={(isOpen) => {
          if (!isOpen) setDraft(null);
        }}
        onSubmit={async (next) => {
          const title = next.title.trim();
          const url = next.url.trim();
          const result =
            next.id === null
              ? await addQuickLinkAction(title === "" ? { url } : { url, title })
              : await updateQuickLinkAction({ quick_link_id: next.id, url, title });
          if (!result.ok) {
            fail(`Could not save the link. ${result.message}`);
            return false;
          }
          return true;
        }}
      />
    </VStack>
  );
}

function QuickLinkDialog({
  draft,
  onOpenChange,
  onSubmit,
}: {
  draft: Draft | null;
  onOpenChange: (isOpen: boolean) => void;
  onSubmit: (draft: Draft) => Promise<boolean>;
}) {
  return (
    <Dialog isOpen={draft !== null} onOpenChange={onOpenChange} purpose="form" width={420} aria-label={draft?.id === null ? "Add link" : "Edit link"}>
      {draft ? <QuickLinkForm key={`${draft.id ?? "new"}:${draft.url}`} draft={draft} onOpenChange={onOpenChange} onSubmit={onSubmit} /> : null}
    </Dialog>
  );
}

function QuickLinkForm({
  draft,
  onOpenChange,
  onSubmit,
}: {
  draft: Draft;
  onOpenChange: (isOpen: boolean) => void;
  onSubmit: (draft: Draft) => Promise<boolean>;
}) {
  const [url, setUrl] = useState(draft.url);
  const [title, setTitle] = useState(draft.title);
  const [touched, setTouched] = useState(false);
  const [isSaving, startSave] = useTransition();
  const urlError = url.trim() === "" ? "A URL is required" : isQuickLinkUrl(url) ? null : "Use an http(s) URL or a path starting with /";
  const submit = () => {
    setTouched(true);
    if (urlError || isSaving) return;
    startSave(async () => {
      const saved = await onSubmit({ ...draft, url, title });
      if (saved) onOpenChange(false);
    });
  };
  return (
    <Layout
      header={<DialogHeader title={draft.id === null ? "Add link" : "Edit link"} onOpenChange={onOpenChange} />}
      content={
        <LayoutContent>
          <FormLayout>
            <TextInput
              label="URL"
              value={url}
              onChange={setUrl}
              placeholder="https:// or /path"
              isRequired
              hasAutoFocus
              onEnter={submit}
              status={touched && urlError ? { type: "error", message: urlError } : undefined}
            />
            <TextInput label="Title" value={title} onChange={setTitle} placeholder="Shown instead of the address" isOptional onEnter={submit} />
          </FormLayout>
        </LayoutContent>
      }
      footer={
        <LayoutFooter hasDivider>
          <HStack gap={2} hAlign="end">
            <Button variant="ghost" label="Cancel" onClick={() => onOpenChange(false)} isDisabled={isSaving} />
            <Button variant="primary" label={draft.id === null ? "Add link" : "Save"} onClick={submit} isLoading={isSaving} />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}
