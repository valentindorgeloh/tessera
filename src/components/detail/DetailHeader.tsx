"use client";

/**
 * Detail header (docs/contracts/ui.md "DetailHeader"): breadcrumbs (project,
 * "Work items" on the full page, parent key, current key), then copy ID,
 * copy link, the overflow menu (make a copy, archive or restore, delete),
 * the mode switcher (side panel, modal, full page) and close for the peek
 * and modal hosts. The URL copied is the full page route of the item.
 */
import { BreadcrumbItem, Breadcrumbs } from "@astryxdesign/core/Breadcrumbs";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import type { DropdownMenuOption } from "@astryxdesign/core/DropdownMenu";
import { useClipboard } from "@astryxdesign/core/hooks";
import { HStack } from "@astryxdesign/core/Stack";
import { useProject } from "@/components/work-items/project-provider";
import type { WorkItem, WorkItemDetail } from "@/lib/tessera/types";
import { ArchiveIcon, ArrowSquareOutIcon, ArrowsOutIcon, CheckIcon, CopyIcon, LinkIcon, RestoreIcon, SidebarIcon, XIcon, resolveLogoIcon } from "@/themes/catppuccin/icons";
import type { DetailHost } from "./types";

export type DetailHeaderProps = {
  item: WorkItemDetail;
  parent: Pick<WorkItem, "id" | "key" | "name"> | null;
  host: DetailHost;
  onClose?: () => void;
  onHostChange?: (host: DetailHost) => void;
  onOpenItem: (id: string) => void;
  /** Overflow actions: make a copy, archive or restore (P3), delete. */
  onCopyItem?: () => void;
  onDelete?: () => void;
  /** Archive entry; shown disabled with `archiveBlockedReason` as its description while the item cannot be archived. */
  onArchive?: () => void;
  /** Restore entry, for an archived item. */
  onRestore?: () => void;
  archiveBlockedReason?: string;
};

/** Full page route of an item; the origin is added at copy time. */
export function workItemPath(item: Pick<WorkItem, "id" | "project_id">): string {
  return `/projects/${item.project_id}/work-items/${item.id}`;
}

const MODES: readonly { host: DetailHost; label: string; icon: typeof SidebarIcon }[] = [
  { host: "peek", label: "Side panel", icon: SidebarIcon },
  { host: "modal", label: "Modal", icon: ArrowsOutIcon },
  { host: "page", label: "Full page", icon: ArrowSquareOutIcon },
];

export function DetailHeader({
  item,
  parent,
  host,
  onClose,
  onHostChange,
  onOpenItem,
  onCopyItem,
  onDelete,
  onArchive,
  onRestore,
  archiveBlockedReason,
}: DetailHeaderProps) {
  const { bundle } = useProject();
  const { project } = bundle;
  const copyId = useClipboard({ announce: "Copied" });
  const copyUrl = useClipboard({ announce: "Copied" });
  const LogoIcon = resolveLogoIcon(project.logo?.icon);

  const menuItems: DropdownMenuOption[] = [
    ...(onCopyItem ? [{ id: "copy", label: "Make a copy", onClick: onCopyItem }] : []),
    ...(onRestore ? [{ id: "restore", label: "Restore", icon: RestoreIcon, onClick: onRestore }] : []),
    ...(onArchive
      ? [{ id: "archive", label: "Archive", icon: ArchiveIcon, isDisabled: archiveBlockedReason !== undefined, description: archiveBlockedReason, onClick: onArchive }]
      : []),
    ...(onDelete ? [{ id: "delete", label: "Delete…", variant: "destructive" as const, onClick: onDelete }] : []),
  ];

  const copyLink = () => {
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    void copyUrl.copy(`${origin}${workItemPath(item)}`);
  };

  return (
    <HStack gap={2} vAlign="center" hAlign="between" className="tessera-detail-header">
      <Breadcrumbs variant="supporting" label="Work item location" className="tessera-detail-crumbs">
        <BreadcrumbItem href={`/projects/${project.id}/work-items`} startIcon={<Icon icon={LogoIcon} size="sm" />}>
          {project.name}
        </BreadcrumbItem>
        {/* The full page (in or outside the project frame) is the item's only trail: Project › Work items › [parent] › KEY. */}
        {host === "page" ? <BreadcrumbItem href={`/projects/${project.id}/work-items`}>Work items</BreadcrumbItem> : null}
        {parent ? <BreadcrumbItem onClick={() => onOpenItem(parent.id)}>{parent.key}</BreadcrumbItem> : null}
        <BreadcrumbItem isCurrent>{item.key}</BreadcrumbItem>
      </Breadcrumbs>
      <HStack gap={0.5} vAlign="center">
        <IconButton
          variant="ghost"
          size="sm"
          label={copyId.isCopied ? "Copied" : "Copy ID"}
          tooltip={copyId.isCopied ? "Copied" : `Copy ${item.key}`}
          icon={copyId.isCopied ? <CheckIcon /> : <CopyIcon />}
          onClick={() => void copyId.copy(item.key)}
        />
        <IconButton
          variant="ghost"
          size="sm"
          label={copyUrl.isCopied ? "Copied" : "Copy link"}
          tooltip={copyUrl.isCopied ? "Copied" : "Copy link"}
          icon={copyUrl.isCopied ? <CheckIcon /> : <LinkIcon />}
          onClick={copyLink}
        />
        {menuItems.length > 0 ? <MoreMenu label="More actions" size="sm" items={menuItems} /> : null}
        {onHostChange
          ? MODES.map((mode) => (
              <IconButton
                key={mode.host}
                variant="ghost"
                size="sm"
                label={mode.label}
                tooltip={mode.label}
                icon={<mode.icon />}
                aria-pressed={mode.host === host}
                className={mode.host === host ? "tessera-detail-mode-active" : undefined}
                onClick={() => {
                  if (mode.host !== host) onHostChange(mode.host);
                }}
              />
            ))
          : null}
        {onClose && host !== "page" ? <IconButton variant="ghost" size="sm" label="Close" tooltip="Close (Esc)" icon={<XIcon />} onClick={onClose} /> : null}
      </HStack>
    </HStack>
  );
}
