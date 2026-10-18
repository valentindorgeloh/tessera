"use client";

/**
 * Detail header (docs/contracts/ui.md "DetailHeader"): one 44px panel bar,
 * pinned while the detail scrolls. Breadcrumbs on the start (project, "Work
 * items" on the full page, parent key, current key); on the end copy link,
 * the overflow menu (make a copy, copy ID, restore or archive (P3), delete),
 * the mode menu (side panel, modal, full page) and close for the peek and
 * modal hosts. The URL copied is the full page route of the item.
 */
import { useRef } from "react";
import { BreadcrumbItem, Breadcrumbs } from "@astryxdesign/core/Breadcrumbs";
import { DropdownMenu, DropdownMenuRadioGroup, DropdownMenuRadioItem, type DropdownMenuOption } from "@astryxdesign/core/DropdownMenu";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { useClipboard } from "@astryxdesign/core/hooks";
import { PanelBar } from "@/components/shell/PanelHeader";
import { useProject } from "@/components/work-items/project-provider";
import type { WorkItem, WorkItemDetail } from "@/lib/tessera/types";
import { ArchiveIcon, ArrowSquareOutIcon, ArrowsOutIcon, CheckIcon, CopyIcon, HashIcon, HistoryIcon, LinkIcon, MoveToProjectIcon, RestoreIcon, SidebarIcon, TrashIcon, XIcon, resolveLogoIcon } from "@/themes/catppuccin/icons";
import type { DetailHost } from "./types";

export type DetailHeaderProps = {
  item: WorkItemDetail;
  parent: Pick<WorkItem, "id" | "key" | "name"> | null;
  host: DetailHost;
  onClose?: () => void;
  onHostChange?: (host: DetailHost) => void;
  onOpenItem: (id: string) => void;
  /** Overflow actions: make a copy, copy or move to another project, archive or restore (P3), delete. */
  onCopyItem?: () => void;
  onCopyToProject?: () => void;
  onMoveToProject?: () => void;
  onDelete?: () => void;
  /** Archive entry; shown disabled with `archiveBlockedReason` as its description while the item cannot be archived. */
  onArchive?: () => void;
  /** Restore entry, for an archived item. */
  onRestore?: () => void;
  archiveBlockedReason?: string;
  /** Opens version history. */
  onVersionHistory?: () => void;
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

function isHost(value: string): value is DetailHost {
  return MODES.some((mode) => mode.host === value);
}

/**
 * Where the item opens: one menu of the three modes, the current one checked;
 * the trigger shows its icon. A choice focuses the trigger before the host
 * moves the detail, so the host's refocus puts focus back on it afterwards.
 */
function ModeMenu({ host, onHostChange }: { host: DetailHost; onHostChange: (host: DetailHost) => void }) {
  const current = MODES.find((mode) => mode.host === host) ?? MODES[0];
  const trigger = useRef<HTMLElement | null>(null);
  return (
    <DropdownMenu
      alignment="end"
      hasChevron={false}
      menuWidth={200}
      renderTrigger={(triggerProps) => (
        <IconButton
          {...triggerProps}
          ref={(element: HTMLElement | null) => {
            triggerProps.ref(element);
            trigger.current = element;
          }}
          variant="ghost"
          size="sm"
          label="Open as"
          tooltip={`Open as: ${current.label}`}
          icon={<Icon icon={current.icon} />}
        />
      )}
    >
      <DropdownMenuRadioGroup
        label="Open as"
        value={host}
        onChange={(value) => {
          if (!isHost(value) || value === host) return;
          trigger.current?.focus();
          onHostChange(value);
        }}
      >
        {MODES.map((mode) => (
          <DropdownMenuRadioItem key={mode.host} value={mode.host} label={mode.label} icon={mode.icon} />
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenu>
  );
}

export function DetailHeader({
  item,
  parent,
  host,
  onClose,
  onHostChange,
  onOpenItem,
  onCopyItem,
  onCopyToProject,
  onMoveToProject,
  onDelete,
  onArchive,
  onRestore,
  archiveBlockedReason,
  onVersionHistory,
}: DetailHeaderProps) {
  const { bundle } = useProject();
  const { project } = bundle;
  const copyId = useClipboard({ announce: "Copied" });
  const copyUrl = useClipboard({ announce: "Copied" });
  const LogoIcon = resolveLogoIcon(project.logo?.icon);

  const copyLink = () => {
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    void copyUrl.copy(`${origin}${workItemPath(item)}`);
  };

  // Make a copy, Copy ID, then Restore (archived) or Archive (disabled with the reason while blocked), Delete last.
  const menuItems: DropdownMenuOption[] = [
    ...(onCopyItem ? [{ id: "copy", label: "Make a copy", icon: CopyIcon, onClick: onCopyItem }] : []),
    ...(onCopyToProject ? [{ id: "copy-project", label: "Copy to project…", icon: CopyIcon, onClick: onCopyToProject }] : []),
    ...(onMoveToProject ? [{ id: "move-project", label: "Move to project…", icon: MoveToProjectIcon, onClick: onMoveToProject }] : []),
    { id: "copy-id", label: `Copy ID (${item.key})`, icon: HashIcon, onClick: () => void copyId.copy(item.key) },
    ...(onVersionHistory ? [{ id: "history", label: "Version history", icon: HistoryIcon, onClick: onVersionHistory }] : []),
    ...(onRestore ? [{ id: "restore", label: "Restore", icon: RestoreIcon, onClick: onRestore }] : []),
    ...(onArchive
      ? [{ id: "archive", label: "Archive", icon: ArchiveIcon, isDisabled: archiveBlockedReason !== undefined, description: archiveBlockedReason, onClick: onArchive }]
      : []),
    ...(onDelete ? [{ id: "delete", label: "Delete…", icon: TrashIcon, variant: "destructive" as const, onClick: onDelete }] : []),
  ];

  return (
    <PanelBar
      size="subheader"
      className="tessera-detail-header"
      start={
        <Breadcrumbs variant="supporting" label="Work item location" className="tessera-detail-crumbs">
          <BreadcrumbItem href={`/projects/${project.id}/work-items`} startIcon={<Icon icon={LogoIcon} size="sm" />}>
            {project.name}
          </BreadcrumbItem>
          {/* The full page (in or outside the project frame) is the item's only trail: Project › Work items › [parent] › KEY. */}
          {host === "page" ? <BreadcrumbItem href={`/projects/${project.id}/work-items`}>Work items</BreadcrumbItem> : null}
          {parent ? <BreadcrumbItem onClick={() => onOpenItem(parent.id)}>{parent.key}</BreadcrumbItem> : null}
          <BreadcrumbItem isCurrent>{item.key}</BreadcrumbItem>
        </Breadcrumbs>
      }
      end={
        <>
          <IconButton
            variant="ghost"
            size="sm"
            label={copyUrl.isCopied ? "Copied" : "Copy link"}
            tooltip={copyUrl.isCopied ? "Copied" : "Copy link"}
            icon={copyUrl.isCopied ? <CheckIcon /> : <LinkIcon />}
            onClick={copyLink}
          />
          <MoreMenu label="More actions" size="sm" items={menuItems} />
          {onHostChange ? <ModeMenu host={host} onHostChange={onHostChange} /> : null}
          {onClose && host !== "page" ? <IconButton variant="ghost" size="sm" label="Close" tooltip="Close (Esc)" icon={<XIcon />} onClick={onClose} /> : null}
        </>
      }
    />
  );
}
