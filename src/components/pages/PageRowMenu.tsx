"use client";

/**
 * The page "…" menu (docs/drafts/p6-plan.md "PageRowMenu"), one control for a
 * tree row and the page header. It owns the move dialog and the delete
 * confirmation. An archived project disables the whole menu.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DropdownMenuOption } from "@astryxdesign/core/DropdownMenu";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { useClipboard } from "@astryxdesign/core/hooks";
import { useToast } from "@astryxdesign/core/Toast";
import {
  archivePageAction,
  createPageAction,
  duplicatePageAction,
  lockPageAction,
  movePageAction,
  unarchivePageAction,
  unlockPageAction,
  updatePageAction,
} from "@/app/actions/pages";
import { useFavoriteToggle } from "@/components/shell/FavoriteButton";
import type { PageSummary } from "@/lib/tessera/types";
import {
  ArchiveIcon,
  CopyIcon,
  EyeSlashIcon,
  GlobeIcon,
  LinkIcon,
  LockIcon,
  MoveDownIcon,
  MoveUpIcon,
  PageIcon,
  PlusIcon,
  RestoreIcon,
  TransferIcon,
  TrashIcon,
  UnlockIcon,
  resolveLogoIcon,
} from "@/themes/catppuccin/icons";
import { DeletePageDialog } from "./DeletePageDialog";
import { MovePageDialog } from "./MovePageDialog";
import { pageMenuEntries, type PageMenuAction } from "./page-menu-items";
import { pageHref, type PageSpaceOption } from "./page-tree";

export type PageRowMenuProps = {
  page: PageSummary;
  spaces: readonly PageSpaceOption[];
  /** Project name, when the page is not in `spaces`. */
  spaceName?: string;
  /** Header menu omits Open. */
  includeOpen?: boolean;
  previousId?: string;
  nextId?: string;
  /** An archived project takes no page actions. */
  isDisabled?: boolean;
};

const ICONS: Record<PageMenuAction, typeof PageIcon> = {
  open: PageIcon,
  "add-subpage": PlusIcon,
  duplicate: CopyIcon,
  "move-up": MoveUpIcon,
  "move-down": MoveDownIcon,
  move: TransferIcon,
  lock: LockIcon,
  unlock: UnlockIcon,
  "make-private": EyeSlashIcon,
  "make-public": GlobeIcon,
  "copy-link": LinkIcon,
  archive: ArchiveIcon,
  restore: RestoreIcon,
  delete: TrashIcon,
};

function failure(verb: string, name: string, message: string): string {
  return `Could not ${verb} ${name}. ${message}`;
}

export function PageRowMenu({ page, spaces, spaceName, includeOpen = true, previousId, nextId, isDisabled = false }: PageRowMenuProps) {
  const router = useRouter();
  const toast = useToast();
  const clipboard = useClipboard({ announce: "Copied" });
  const [isMoveOpen, setMoveOpen] = useState(false);
  const [isDeleteOpen, setDeleteOpen] = useState(false);
  const [, startTransition] = useTransition();
  const favorite = useFavoriteToggle("page", page.id);

  const fail = (verb: string, message: string) => toast({ type: "error", body: failure(verb, page.name, message) });

  const copyLink = () => {
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    void clipboard.copy(`${origin}${pageHref(page)}`);
  };

  const handlers: Record<PageMenuAction, () => void> = {
    open: () => router.push(pageHref(page)),
    "add-subpage": () =>
      startTransition(async () => {
        const result = await createPageAction({
          project_id: page.project_id,
          parent_id: page.id,
          name: "Untitled",
          access: page.access,
        });
        if (!result.ok) {
          fail("add a sub-page to", result.message);
          return;
        }
        router.push(pageHref(result.data));
      }),
    duplicate: () =>
      startTransition(async () => {
        const result = await duplicatePageAction({ page_id: page.id });
        if (!result.ok) {
          fail("duplicate", result.message);
          return;
        }
        toast({ type: "info", body: `Duplicated as ${result.data.name}` });
        router.push(pageHref(result.data));
      }),
    "move-up": () =>
      startTransition(async () => {
        if (previousId === undefined) return;
        const result = await movePageAction({ page_id: page.id, before_id: previousId });
        if (!result.ok) fail("move", result.message);
      }),
    "move-down": () =>
      startTransition(async () => {
        if (nextId === undefined) return;
        const result = await movePageAction({ page_id: page.id, after_id: nextId });
        if (!result.ok) fail("move", result.message);
      }),
    move: () => setMoveOpen(true),
    lock: () =>
      startTransition(async () => {
        const result = await lockPageAction({ page_id: page.id });
        if (!result.ok) fail("lock", result.message);
      }),
    unlock: () =>
      startTransition(async () => {
        const result = await unlockPageAction({ page_id: page.id });
        if (!result.ok) fail("unlock", result.message);
      }),
    "make-private": () =>
      startTransition(async () => {
        const result = await updatePageAction({ page_id: page.id, access: "private" });
        if (!result.ok) fail("make private", result.message);
      }),
    "make-public": () =>
      startTransition(async () => {
        const result = await updatePageAction({ page_id: page.id, access: "public" });
        if (!result.ok) fail("make public", result.message);
      }),
    "copy-link": copyLink,
    archive: () =>
      startTransition(async () => {
        const result = await archivePageAction({ page_id: page.id });
        if (!result.ok) {
          fail("archive", result.message);
          return;
        }
        toast({ type: "info", body: `Archived ${page.name}` });
      }),
    restore: () =>
      startTransition(async () => {
        const result = await unarchivePageAction({ page_id: page.id });
        if (!result.ok) {
          fail("restore", result.message);
          return;
        }
        toast({ type: "info", body: `Restored ${page.name}` });
      }),
    delete: () => setDeleteOpen(true),
  };

  const items: DropdownMenuOption[] = [
    { id: "favorite", label: favorite.label, icon: resolveLogoIcon("Star"), onClick: favorite.toggle },
  ];
  for (const row of pageMenuEntries({ page, includeOpen, canMoveUp: previousId !== undefined, canMoveDown: nextId !== undefined })) {
    if (row.dividerBefore) items.push({ type: "divider" });
    const Icon = ICONS[row.id];
    items.push({
      id: row.id,
      label: row.label,
      icon: <Icon />,
      isDisabled: row.isDisabled,
      description: row.description,
      variant: row.variant,
      href: row.id === "open" ? pageHref(page) : undefined,
      onClick: row.id === "open" ? undefined : () => handlers[row.id](),
    });
  }

  return (
    <>
      <MoreMenu label="Page actions" size="sm" variant="ghost" items={items} placement="below" alignment="end" isDisabled={isDisabled} />
      <MovePageDialog page={page} spaces={spaces} spaceName={spaceName} isOpen={isMoveOpen} onOpenChange={setMoveOpen} />
      <DeletePageDialog page={page} isOpen={isDeleteOpen} onOpenChange={setDeleteOpen} />
    </>
  );
}
