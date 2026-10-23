"use client";

/**
 * Quick links (docs/drafts/p9-plan.md U1): card rows in a wrap (icon tile, title,
 * host or path; the menu shows on hover or focus). A card drags to a
 * new slot with the pointer (decision 105); the chip menu keeps Move left /
 * Move right as the keyboard path (decision 14). Removing a link is not
 * destructive.
 */
import { useOptimistic, useState, useTransition, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Dialog, DialogHeader } from "@/components/shell/dialogs";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Icon } from "@astryxdesign/core/Icon";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { Link } from "@astryxdesign/core/Link";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { usePointerDrag, type DragDropEvent } from "@/components/dnd/use-pointer-drag";
import { placementFor, reorderBy, stepIndex } from "@/components/stickies/reorder-math";
import { addQuickLinkAction, moveQuickLinkAction, removeQuickLinkAction, updateQuickLinkAction } from "@/app/actions/quick-links";
import { LinkSimpleIcon, PlusIcon } from "@/themes/catppuccin/icons";
import { isExternalQuickLink, isQuickLinkUrl, quickLinkLabel, quickLinkSupporting, type QuickLinkView } from "./home-format";

export type QuickLinksWidgetProps = { links: QuickLinkView[] };

type Draft = { id: string | null; url: string; title: string };

const EMPTY_DRAFT: Draft = { id: null, url: "", title: "" };
const CHIP_CONTAINER = "quick-links";
/** A chip drags from anywhere except its menu button (a click on the link still opens it). */
const DRAG_IGNORE = 'button, input, [role="menu"], [role="menuitem"], [role="dialog"]';

export function QuickLinksWidget({ links }: QuickLinksWidgetProps) {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [, startTransition] = useTransition();

  const fail = (message: string) => toast({ type: "error", body: message });

  const [shown, applyMove] = useOptimistic(links, (current, move: { id: string; index: number }) => reorderBy(current, (link) => link.id, move.id, move.index));
  const ids = shown.map((link) => link.id);

  const moveTo = (id: string, index: number) => {
    const placement = placementFor(ids, id, index);
    if (placement === null) return;
    startTransition(async () => {
      applyMove({ id, index });
      const result = await moveQuickLinkAction({ quick_link_id: id, ...placement });
      if (!result.ok) fail(`Could not move the link. ${result.message}`);
    });
  };

  const step = (id: string, direction: -1 | 1) => {
    const to = stepIndex(ids, id, direction);
    if (to !== null) moveTo(id, to);
  };

  const { drag, registerContainer, registerItem, registerOverlay, itemHandlers } = usePointerDrag({
    onDrop: (event: DragDropEvent) => moveTo(event.id, event.index),
    itemsOf: () => ids,
    axis: "grid",
    ignoreSelector: DRAG_IGNORE,
  });
  const dragged = drag === null ? undefined : shown.find((link) => link.id === drag.id);

  // The landing slot is a dashed placeholder among the chips that stay; the dragged chip is hidden in place.
  const chips: ReactNode[] = [];
  const target = drag?.target ?? null;
  let stayIndex = 0;
  let placed = false;
  const placeholder = drag === null ? null : <Card key="placeholder" variant="muted" padding={0} width={drag.width} height={drag.height} className="tessera-board-placeholder" />;
  shown.forEach((link, index) => {
    const isDragged = drag?.id === link.id;
    if (!isDragged && !placed && target !== null && stayIndex === target.index) {
      chips.push(placeholder);
      placed = true;
    }
    chips.push(
      <HStack
        key={link.id}
        ref={registerItem(link.id)}
        {...itemHandlers(link.id, CHIP_CONTAINER)}
        onDragStart={(event) => event.preventDefault()}
        gap={3}
        vAlign="center"
        className={isDragged ? "tessera-quick-link tessera-quick-link--dragging" : "tessera-quick-link"}
      >
        <HStack hAlign="center" vAlign="center" className="tessera-quick-link-tile" aria-hidden="true">
          <Icon icon={LinkSimpleIcon} size="sm" color="secondary" />
        </HStack>
        <VStack gap={0} className="tessera-quick-link-text">
          <Link
            href={link.url}
            isExternalLink={isExternalQuickLink(link.url)}
            color="primary"
            weight="medium"
            maxLines={1}
            className="tessera-quick-link-title"
          >
            {quickLinkLabel(link)}
          </Link>
          <Text type="supporting" color="secondary" maxLines={1}>
            {quickLinkSupporting(link)}
          </Text>
        </VStack>
        <HStack className="tessera-quick-link-menu">
          <MoreMenu
            label={`Actions for ${quickLinkLabel(link)}`}
            size="sm"
            items={[
              { id: "edit", label: "Edit", onClick: () => setDraft({ id: link.id, url: link.url, title: link.title }) },
              { id: "left", label: "Move left", isDisabled: index === 0, onClick: () => step(link.id, -1) },
              { id: "right", label: "Move right", isDisabled: index === shown.length - 1, onClick: () => step(link.id, 1) },
              { id: "remove", label: "Remove", variant: "destructive", onClick: () => remove(link) },
            ]}
          />
        </HStack>
      </HStack>,
    );
    if (!isDragged) stayIndex++;
  });
  if (target !== null && !placed) chips.push(placeholder);

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
      {shown.length === 0 ? null : (
        <HStack ref={registerContainer(CHIP_CONTAINER)} gap={2} wrap="wrap" className="tessera-home-links">
          {chips}
        </HStack>
      )}
      {drag && dragged ? (
        <HStack ref={registerOverlay} gap={3} vAlign="center" className="tessera-quick-link tessera-drag-overlay" aria-hidden="true">
          <HStack hAlign="center" vAlign="center" className="tessera-quick-link-tile">
            <Icon icon={LinkSimpleIcon} size="sm" color="secondary" />
          </HStack>
          <VStack gap={0} className="tessera-quick-link-text">
            <Text weight="medium" maxLines={1}>
              {quickLinkLabel(dragged)}
            </Text>
            <Text type="supporting" color="secondary" maxLines={1}>
              {quickLinkSupporting(dragged)}
            </Text>
          </VStack>
        </HStack>
      ) : null}
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
